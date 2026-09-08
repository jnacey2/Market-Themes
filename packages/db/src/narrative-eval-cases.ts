import { getTrackedNarrativeDefinitions } from "./narratives";
import { createDatabaseClient } from "./persistence";
import type { AnalysisDocument, NarrativeDefinition, SourceClass } from "./types";

/**
 * Evaluation cases exported from real stored documents.
 *
 * Two strata are produced:
 * - "review": documents whose classifier matches were approved or rejected by a
 *   reviewer. Approved slugs become positive labels; rejected slugs become
 *   negatives. These measure precision on what the classifier already found.
 * - "unlabeled": a random sample of eligible documents the classifier matched
 *   to nothing. They must be hand-labeled (`expectedMatchedSlugs` starts null).
 *   Once labeled, they are the only stratum that can measure recall, because
 *   review decisions never see documents the classifier skipped.
 */

export type EvalCaseLabelSource = "review" | "unlabeled" | "manual";

export type ExportedEvalCase = {
  id: string;
  labelSource: EvalCaseLabelSource;
  /** Null until a human fills the label in. */
  expectedMatchedSlugs: string[] | null;
  /** Slugs the production classifier matched (non-rejected) at export time. */
  classifierMatchedSlugs: string[];
  /** Slugs a reviewer explicitly rejected for this document. */
  rejectedSlugs: string[];
  document: AnalysisDocument;
  note?: string;
};

export type EvalCaseFile = {
  version: 1;
  exportedAt: string;
  model: string | null;
  promptVersion: string | null;
  definitions: NarrativeDefinition[];
  cases: ExportedEvalCase[];
};

export type ExportEvalCasesOptions = {
  /** Cap on reviewed documents per definition slug. */
  reviewedPerDefinition?: number;
  /** Number of unmatched documents to sample for recall labeling. */
  unlabeledSample?: number;
  /** Only documents published within this many days. */
  lookbackDays?: number;
  /** Truncate document text to this many characters. */
  maxTextChars?: number;
  /** Restrict to these source classes. */
  sourceClasses?: SourceClass[];
  /** Restrict observations to this model / prompt version when provided. */
  model?: string;
  promptVersion?: string;
};

const DEFAULTS = {
  reviewedPerDefinition: 6,
  unlabeledSample: 40,
  lookbackDays: 120,
  maxTextChars: 12_000
};

export async function exportNarrativeEvalCases(
  options: ExportEvalCasesOptions = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<EvalCaseFile> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to export evaluation cases.");
  }

  const reviewedPerDefinition =
    options.reviewedPerDefinition ?? DEFAULTS.reviewedPerDefinition;
  const unlabeledSample = options.unlabeledSample ?? DEFAULTS.unlabeledSample;
  const lookbackDays = options.lookbackDays ?? DEFAULTS.lookbackDays;
  const maxTextChars = options.maxTextChars ?? DEFAULTS.maxTextChars;

  const definitions = await getTrackedNarrativeDefinitions(databaseUrl);
  const slugById = new Map(definitions.map((definition) => [definition.id, definition.slug]));
  const definitionIds = definitions.map((definition) => definition.id);

  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const reviewed = await client.query<ObservationRow>(
      `with ranked as (
         select no.document_id, no.narrative_definition_id, no.review_status,
                no.matched,
                row_number() over (
                  partition by no.narrative_definition_id, no.review_status
                  order by no.reviewed_at desc nulls last, no.observed_at desc
                ) as rank
         from narrative_observations no
         join documents d on d.id = no.document_id
         where no.narrative_definition_id = any($1::text[])
           and no.review_status in ('approved', 'rejected')
           and no.matched
           and d.published_at >= now() - ($2::int * interval '1 day')
           and ($4::text is null or no.model = $4)
           and ($5::text is null or no.prompt_version = $5)
       )
       select document_id, narrative_definition_id, review_status, matched
       from ranked
       where rank <= $3`,
      [
        definitionIds,
        lookbackDays,
        reviewedPerDefinition,
        options.model ?? null,
        options.promptVersion ?? null
      ]
    );

    const reviewedDocumentIds = [...new Set(reviewed.rows.map((row) => row.document_id))];

    // Every non-rejected classifier match for the reviewed documents, so the
    // exported case reflects the full production verdict rather than only the
    // observation that happened to be reviewed.
    const classifierMatches = reviewedDocumentIds.length
      ? await client.query<ObservationRow>(
          `select document_id, narrative_definition_id, review_status, matched
           from narrative_observations
           where document_id = any($1::text[])
             and narrative_definition_id = any($2::text[])
             and matched
             and ($3::text is null or model = $3)
             and ($4::text is null or prompt_version = $4)`,
          [
            reviewedDocumentIds,
            definitionIds,
            options.model ?? null,
            options.promptVersion ?? null
          ]
        )
      : { rows: [] as ObservationRow[] };

    const unmatched = await client.query<{ id: string }>(
      `select d.id
       from documents d
       join document_texts dt on dt.document_id = d.id
       where coalesce(d.retention_policy, 'full_text') = 'full_text'
         and d.published_at >= now() - ($1::int * interval '1 day')
         and ($4::text[] is null or d.source_class = any($4::text[]))
         and exists (
           select 1 from narrative_observations no
           where no.document_id = d.id
             and no.narrative_definition_id = any($2::text[])
         )
         and not exists (
           select 1 from narrative_observations no
           where no.document_id = d.id
             and no.narrative_definition_id = any($2::text[])
             and no.matched
         )
       order by random()
       limit $3`,
      [
        lookbackDays,
        definitionIds,
        unlabeledSample,
        options.sourceClasses ?? null
      ]
    );

    const documentIds = [
      ...new Set([...reviewedDocumentIds, ...unmatched.rows.map((row) => row.id)])
    ];
    const documents = await loadDocuments(client, documentIds, maxTextChars);

    const approvedByDocument = new Map<string, Set<string>>();
    const rejectedByDocument = new Map<string, Set<string>>();
    for (const row of reviewed.rows) {
      const slug = slugById.get(row.narrative_definition_id);
      if (!slug) continue;
      const bucket = row.review_status === "approved" ? approvedByDocument : rejectedByDocument;
      if (!bucket.has(row.document_id)) bucket.set(row.document_id, new Set());
      bucket.get(row.document_id)!.add(slug);
    }

    const classifierByDocument = new Map<string, Set<string>>();
    for (const row of classifierMatches.rows) {
      if (row.review_status === "rejected") continue;
      const slug = slugById.get(row.narrative_definition_id);
      if (!slug) continue;
      if (!classifierByDocument.has(row.document_id)) {
        classifierByDocument.set(row.document_id, new Set());
      }
      classifierByDocument.get(row.document_id)!.add(slug);
    }

    const cases: ExportedEvalCase[] = [];

    for (const documentId of reviewedDocumentIds) {
      const document = documents.get(documentId);
      if (!document) continue;
      const approved = [...(approvedByDocument.get(documentId) ?? [])].sort();
      const rejected = [...(rejectedByDocument.get(documentId) ?? [])].sort();
      cases.push({
        id: `review:${documentId}`,
        labelSource: "review",
        expectedMatchedSlugs: approved,
        classifierMatchedSlugs: [...(classifierByDocument.get(documentId) ?? [])].sort(),
        rejectedSlugs: rejected,
        document,
        note:
          "Approved slugs are positives; rejected slugs are negatives. Unreviewed definitions are assumed absent."
      });
    }

    for (const row of unmatched.rows) {
      const document = documents.get(row.id);
      if (!document) continue;
      cases.push({
        id: `recall:${row.id}`,
        labelSource: "unlabeled",
        expectedMatchedSlugs: null,
        classifierMatchedSlugs: [],
        rejectedSlugs: [],
        document,
        note:
          "Classifier matched nothing. Fill expectedMatchedSlugs with every tracked slug this text supports (or [] if none)."
      });
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      model: options.model ?? null,
      promptVersion: options.promptVersion ?? null,
      definitions,
      cases
    };
  } finally {
    await client.end();
  }
}

type ObservationRow = {
  document_id: string;
  narrative_definition_id: string;
  review_status: string;
  matched: boolean;
};

async function loadDocuments(
  client: ReturnType<typeof createDatabaseClient>,
  documentIds: string[],
  maxTextChars: number
) {
  const documents = new Map<string, AnalysisDocument>();
  if (documentIds.length === 0) return documents;

  const result = await client.query<{
    id: string;
    source_id: string;
    source_class: SourceClass;
    title: string;
    publisher: string;
    url: string;
    published_at: string;
    tickers: string[];
    summary: string;
    metadata: Record<string, unknown>;
    content: string;
    text_hash: string;
  }>(
    `select d.id, d.source_id, d.source_class, d.title, d.publisher, d.url,
            d.published_at::text, d.tickers, d.summary, d.metadata,
            left(dt.content, $2::int) as content, dt.content_hash as text_hash
     from documents d
     join document_texts dt on dt.document_id = d.id
     where d.id = any($1::text[])`,
    [documentIds, maxTextChars]
  );

  for (const row of result.rows) {
    documents.set(row.id, {
      id: row.id,
      sourceId: row.source_id,
      sourceClass: row.source_class,
      title: row.title,
      publisher: row.publisher,
      url: row.url,
      publishedAt: row.published_at,
      tickers: row.tickers,
      summary: row.summary,
      metadata: row.metadata,
      text: row.content,
      textHash: row.text_hash
    });
  }

  return documents;
}
