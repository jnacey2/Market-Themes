import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AnalysisDocument,
  AnalysisRunStatus,
  AnalysisRunSummary,
  AnalysisSignalSummary,
  AnalysisStatus,
  ExtractedSignalInput,
  IngestionStatus,
  PersistableDocument,
  PersistDocumentsResult,
  SourceClass
} from "./types";

const { Client } = pg;

type DbClient = pg.Client;

const DEFAULT_CHUNK_SIZE = 8_000;
const DEFAULT_CHUNK_OVERLAP = 500;

type SelectAnalysisDocumentsOptions = {
  analysisType: string;
  model: string;
  promptVersion: string;
  limit?: number;
  lookbackDays?: number;
};

type AnalysisRunOptions = {
  analysisType: string;
  model: string;
  promptVersion: string;
  metadata?: Record<string, unknown>;
};

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined
  });
}

export async function persistDocuments(
  documents: PersistableDocument[],
  databaseUrl = process.env.DATABASE_URL
): Promise<PersistDocumentsResult> {
  if (documents.length === 0) {
    return {
      insertedDocuments: 0,
      skippedDocuments: 0,
      insertedChunks: 0
    };
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    let insertedDocuments = 0;
    let skippedDocuments = 0;
    let insertedChunks = 0;

    for (const document of documents) {
      await upsertSource(client, document);
      const contentHash = document.contentHash ?? hashContent(document.body);
      const documentId = await resolveDocumentId(client, document.id, contentHash);

      if (!documentId) {
        skippedDocuments += 1;
        continue;
      }

      const insertResult = await client.query<{ id: string }>(
        `insert into documents (
          id,
          source_id,
          source_class,
          title,
          publisher,
          url,
          published_at,
          tickers,
          summary,
          retrieval_method,
          metadata,
          content_hash
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (content_hash) do nothing
        returning id`,
        [
          documentId,
          document.sourceId,
          document.sourceClass,
          document.title,
          document.publisher,
          document.url,
          document.publishedAt,
          document.tickers,
          document.summary,
          document.retrievalMethod,
          JSON.stringify(document.metadata ?? {}),
          contentHash
        ]
      );

      if (insertResult.rowCount === 0) {
        skippedDocuments += 1;
        continue;
      }

      insertedDocuments += 1;
      await upsertDocumentText(client, documentId, document.body, "ingestion");
      const chunks = chunkText(document.body);

      for (const [index, content] of chunks.entries()) {
        await client.query(
          `insert into document_chunks (
            id,
            document_id,
            chunk_index,
            content
          ) values ($1, $2, $3, $4)
          on conflict (document_id, chunk_index) do nothing`,
          [`${documentId}:chunk:${index}`, documentId, index, content]
        );
        insertedChunks += 1;
      }
    }

    return {
      insertedDocuments,
      skippedDocuments,
      insertedChunks
    };
  } finally {
    await client.end();
  }
}

export async function selectDocumentsForAnalysis(
  options: SelectAnalysisDocumentsOptions,
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const limit = options.limit ?? 20;
    const lookbackDays = options.lookbackDays ?? null;
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
      content: string | null;
    }>(
      `select
        d.id,
        d.source_id,
        d.source_class,
        d.title,
        d.publisher,
        d.url,
        d.published_at::text,
        d.tickers,
        d.summary,
        d.metadata,
        coalesce(
          dt.content,
          string_agg(dc.content, E'\n\n' order by dc.chunk_index)
        ) as content
       from documents d
       left join document_texts dt on dt.document_id = d.id
       left join document_chunks dc on dc.document_id = d.id
       left join document_analysis_runs ar
        on ar.document_id = d.id
        and ar.analysis_type = $1
        and ar.model = $2
        and ar.prompt_version = $3
       where d.source_id in ('sec-filings', 'fmp-transcripts')
        and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
        and coalesce(ar.status, '') not in ('completed', 'running')
        and coalesce(ar.attempt_count, 0) < 2
       group by d.id, dt.content, ar.status, ar.attempt_count
       having coalesce(
          dt.content,
          string_agg(dc.content, E'\n\n' order by dc.chunk_index)
        ) is not null
       order by d.published_at desc, d.created_at desc
       limit $5`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        lookbackDays,
        limit
      ]
    );

    const documents: AnalysisDocument[] = [];

    for (const row of result.rows) {
      const text = row.content?.trim() ?? "";

      if (!text) {
        continue;
      }

      await upsertDocumentText(client, row.id, text, "reconstructed_chunks");

      documents.push({
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
        text,
        textHash: hashContent(text)
      });
    }

    return documents;
  } finally {
    await client.end();
  }
}

export async function startDocumentAnalysisRun(
  documentId: string,
  options: AnalysisRunOptions,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const runId = analysisRunId(
      documentId,
      options.analysisType,
      options.model,
      options.promptVersion
    );
    await client.query(
      `insert into document_analysis_runs (
        id,
        document_id,
        analysis_type,
        model,
        prompt_version,
        status,
        attempt_count,
        error_message,
        started_at,
        completed_at,
        metadata,
        updated_at
      ) values ($1, $2, $3, $4, $5, 'running', 1, null, now(), null, $6, now())
      on conflict (document_id, analysis_type, model, prompt_version) do update set
        status = 'running',
        attempt_count = document_analysis_runs.attempt_count + 1,
        error_message = null,
        started_at = now(),
        completed_at = null,
        metadata = excluded.metadata,
        updated_at = now()`,
      [
        runId,
        documentId,
        options.analysisType,
        options.model,
        options.promptVersion,
        JSON.stringify(options.metadata ?? {})
      ]
    );

    return runId;
  } finally {
    await client.end();
  }
}

export async function completeDocumentAnalysisRun(
  runId: string,
  signals: ExtractedSignalInput[],
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await client.query("begin");

    let insertedSignals = 0;
    const touchedThemeIds = new Set<string>();

    for (const signal of signals) {
      await client.query(
        `insert into themes (
          id,
          label,
          description,
          status
        ) values ($1, $2, $3, 'emerging')
        on conflict (id) do update set
          label = excluded.label,
          description = case
            when themes.description = '' then excluded.description
            else themes.description
          end`,
        [signal.themeId, signal.canonicalThemeLabel, signal.themeDescription]
      );
      touchedThemeIds.add(signal.themeId);

      const insertSignal = await client.query(
        `insert into signals (
          id,
          document_id,
          theme_id,
          raw_theme_label,
          canonical_theme_label,
          stance,
          risk_tone,
          bullish_tone,
          confidence,
          evidence_snippet,
          interpretation,
          affected_entities,
          section_label,
          speaker,
          prompt_version,
          model,
          metadata,
          score_contribution
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18
        )
        on conflict (document_id, prompt_version, theme_id, evidence_snippet)
        do nothing`,
        [
          signal.id,
          signal.documentId,
          signal.themeId,
          signal.rawThemeLabel,
          signal.canonicalThemeLabel,
          signal.stance,
          signal.riskTone,
          signal.bullishTone,
          signal.confidence,
          signal.evidenceSnippet,
          signal.interpretation,
          signal.affectedEntities,
          signal.sectionLabel ?? null,
          signal.speaker ?? null,
          signal.promptVersion,
          signal.model,
          JSON.stringify(signal.metadata ?? {}),
          signal.scoreContribution
        ]
      );

      if ((insertSignal.rowCount ?? 0) > 0) {
        insertedSignals += 1;
      }
    }

    await client.query(
      `update document_analysis_runs
       set status = 'completed',
        completed_at = now(),
        error_message = null,
        updated_at = now()
       where id = $1`,
      [runId]
    );

    await client.query("commit");

    return {
      insertedSignals,
      themesTouched: touchedThemeIds.size
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function failDocumentAnalysisRun(
  runId: string,
  error: unknown,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await client.query(
      `update document_analysis_runs
       set status = 'failed',
        error_message = $2,
        completed_at = now(),
        updated_at = now()
       where id = $1`,
      [runId, error instanceof Error ? error.message : String(error)]
    );
  } finally {
    await client.end();
  }
}

export async function getAnalysisStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisStatus> {
  if (!databaseUrl) {
    return emptyAnalysisStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      signal_count: string;
      theme_count: string;
      completed_runs: string;
      failed_runs: string;
    }>(
      `select
        (select count(*)::text from signals) as signal_count,
        (select count(*)::text from themes) as theme_count,
        (select count(*)::text from document_analysis_runs where status = 'completed') as completed_runs,
        (select count(*)::text from document_analysis_runs where status = 'failed') as failed_runs`
    );

    const recentSignals = await client.query<AnalysisSignalSummary>(
      `select
        s.id,
        s.theme_id as "themeId",
        t.label as "themeLabel",
        s.raw_theme_label as "rawThemeLabel",
        s.canonical_theme_label as "canonicalThemeLabel",
        s.stance,
        s.risk_tone::float as "riskTone",
        s.bullish_tone::float as "bullishTone",
        s.confidence::float as confidence,
        s.evidence_snippet as "evidenceSnippet",
        s.interpretation,
        s.affected_entities as "affectedEntities",
        s.section_label as "sectionLabel",
        s.speaker,
        s.prompt_version as "promptVersion",
        s.model,
        s.extracted_at::text as "extractedAt",
        d.id as "documentId",
        d.title as "documentTitle",
        d.publisher,
        d.url,
        d.published_at::text as "publishedAt",
        d.source_class as "sourceClass"
       from signals s
       join documents d on d.id = s.document_id
       join themes t on t.id = s.theme_id
       order by s.extracted_at desc
       limit 25`
    );

    const recentRuns = await client.query<AnalysisRunSummary>(
      `select
        ar.id,
        ar.document_id as "documentId",
        d.title as "documentTitle",
        d.source_class as "sourceClass",
        ar.model,
        ar.prompt_version as "promptVersion",
        ar.status,
        ar.attempt_count as "attemptCount",
        ar.error_message as "errorMessage",
        ar.started_at::text as "startedAt",
        ar.completed_at::text as "completedAt",
        ar.updated_at::text as "updatedAt"
       from document_analysis_runs ar
       join documents d on d.id = ar.document_id
       order by ar.updated_at desc
       limit 25`
    );

    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      signalCount: Number(row?.signal_count ?? 0),
      themeCount: Number(row?.theme_count ?? 0),
      completedRuns: Number(row?.completed_runs ?? 0),
      failedRuns: Number(row?.failed_runs ?? 0),
      recentSignals: recentSignals.rows,
      recentRuns: recentRuns.rows.map((run) => ({
        ...run,
        status: run.status as AnalysisRunStatus
      }))
    };
  } catch {
    return emptyAnalysisStatus(true);
  } finally {
    await client.end();
  }
}

export async function getIngestionStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<IngestionStatus> {
  if (!databaseUrl) {
    return emptyStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      total_documents: string;
      sec_documents: string;
      fmp_transcript_documents: string;
      latest_sec_document_at: string | null;
      latest_fmp_transcript_at: string | null;
      latest_created_at: string | null;
    }>(
      `select
        count(*)::text as total_documents,
        count(*) filter (where source_id = 'sec-filings')::text as sec_documents,
        count(*) filter (where source_id = 'fmp-transcripts')::text as fmp_transcript_documents,
        max(published_at) filter (where source_id = 'sec-filings')::text as latest_sec_document_at,
        max(published_at) filter (where source_id = 'fmp-transcripts')::text as latest_fmp_transcript_at,
        max(created_at)::text as latest_created_at
      from documents`
    );

    const sourceCounts = await client.query<{
      source_class: SourceClass;
      count: string;
    }>(
      `select source_class, count(*)::text as count
       from documents
       group by source_class
       order by source_class`
    );

    const secCategoryCounts = await client.query<{
      category: string;
      count: string;
    }>(
      `select coalesce(metadata->>'filingCategory', 'uncategorized') as category,
        count(*)::text as count
       from documents
       where source_id = 'sec-filings'
       group by category
       order by category`
    );

    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      totalDocuments: Number(row?.total_documents ?? 0),
      secDocuments: Number(row?.sec_documents ?? 0),
      fmpTranscriptDocuments: Number(row?.fmp_transcript_documents ?? 0),
      latestSecDocumentAt: row?.latest_sec_document_at ?? null,
      latestFmpTranscriptAt: row?.latest_fmp_transcript_at ?? null,
      latestCreatedAt: row?.latest_created_at ?? null,
      sourceCounts: sourceCounts.rows.map((countRow) => ({
        sourceClass: countRow.source_class,
        count: Number(countRow.count)
      })),
      secCategoryCounts: secCategoryCounts.rows.map((countRow) => ({
        category: countRow.category,
        count: Number(countRow.count)
      }))
    };
  } catch {
    return emptyStatus(true);
  } finally {
    await client.end();
  }
}

export function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function upsertDocumentText(
  client: DbClient,
  documentId: string,
  text: string,
  textSource: "ingestion" | "reconstructed_chunks"
) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return;
  }

  await client.query(
    `insert into document_texts (
      document_id,
      content,
      content_hash,
      retention_policy,
      text_source,
      updated_at
    ) values ($1, $2, $3, 'full_text', $4, now())
    on conflict (document_id) do update set
      content = excluded.content,
      content_hash = excluded.content_hash,
      text_source = case
        when document_texts.text_source = 'ingestion' then document_texts.text_source
        else excluded.text_source
      end,
      updated_at = now()`,
    [documentId, normalized, hashContent(normalized), textSource]
  );
}

function analysisRunId(
  documentId: string,
  analysisType: string,
  model: string,
  promptVersion: string
) {
  return `analysis:${hashContent(`${documentId}:${analysisType}:${model}:${promptVersion}`).slice(0, 24)}`;
}

async function resolveDocumentId(
  client: DbClient,
  preferredId: string,
  contentHash: string
) {
  const existing = await client.query<{ id: string; content_hash: string }>(
    `select id, content_hash
     from documents
     where id = $1 or content_hash = $2
     limit 1`,
    [preferredId, contentHash]
  );

  const row = existing.rows[0];

  if (!row) {
    return preferredId;
  }

  if (row.content_hash === contentHash) {
    return null;
  }

  return `${preferredId}:rev:${contentHash.slice(0, 8)}`;
}

function emptyStatus(databaseConfigured: boolean): IngestionStatus {
  return {
    databaseConfigured,
    totalDocuments: 0,
    secDocuments: 0,
    fmpTranscriptDocuments: 0,
    latestSecDocumentAt: null,
    latestFmpTranscriptAt: null,
    latestCreatedAt: null,
    sourceCounts: [],
    secCategoryCounts: []
  };
}

async function upsertSource(client: DbClient, document: PersistableDocument) {
  await client.query(
    `insert into sources (
      id,
      name,
      source_class,
      access_method,
      terms_notes,
      enabled
    ) values ($1, $2, $3, $4, $5, true)
    on conflict (id) do update set
      name = excluded.name,
      source_class = excluded.source_class,
      access_method = excluded.access_method,
      terms_notes = excluded.terms_notes,
      enabled = true`,
    [
      document.sourceId,
      sourceName(document.sourceId),
      document.sourceClass,
      document.retrievalMethod,
      document.sourceId === "sec-filings"
        ? "Official SEC endpoints and filing document downloads."
        : document.sourceId === "fmp-transcripts"
          ? "Financial Modeling Prep earnings call transcript API."
        : null
    ]
  );
}

function sourceName(sourceId: string) {
  if (sourceId === "sec-filings") {
    return "SEC Filings";
  }

  if (sourceId === "fmp-transcripts") {
    return "FMP Transcripts";
  }

  return sourceId;
}

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + chunkSize, normalized.length);
    chunks.push(normalized.slice(cursor, end));

    if (end === normalized.length) {
      break;
    }

    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}

function normalizeText(text: string) {
  return text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function emptyAnalysisStatus(databaseConfigured: boolean): AnalysisStatus {
  return {
    databaseConfigured,
    signalCount: 0,
    themeCount: 0,
    completedRuns: 0,
    failedRuns: 0,
    recentSignals: [],
    recentRuns: []
  };
}
