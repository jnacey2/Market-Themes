import { createHash, randomUUID } from "node:crypto";
import { createDatabaseClient } from "./persistence";
import type {
  AnalysisDocument,
  CandidatePromotionPolicy,
  CandidatePromotionValidation,
  CandidatePromotionValidationInput,
  NarrativeBacklogSummary,
  NarrativeCandidateContext,
  NarrativeCandidateEvidence,
  NarrativeCandidateInput,
  NarrativeCandidateKind,
  NarrativeCandidateQueue,
  NarrativeCandidateStatus,
  NarrativeCandidateSummary,
  SourceClass,
  ToneDirection
} from "./types";

export const DEFAULT_CANDIDATE_MIN_DOCUMENTS = 2;
export const DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS = 2;
export const DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS = 30;

type DiscoverySelectionOptions = {
  analysisType: string;
  model: string;
  promptVersion: string;
  limit: number;
  lookbackDays?: number;
  maxAttempts?: number;
  excludedDocumentIds?: string[];
  executionMode?: string;
  anthropicBatchId?: string;
};

export type ClaimedNarrativeDiscoveryDocument = AnalysisDocument & {
  analysisRunId: string;
  attemptToken: string;
};

type CandidateRow = {
  id: string;
  cluster_key: string;
  name: string;
  proposition: string;
  category: string;
  inclusion_guidance: string;
  exclusion_guidance: string;
  status: NarrativeCandidateStatus;
  kind: NarrativeCandidateKind;
  event_label: string | null;
  promotion_validation: CandidatePromotionValidation | Record<string, never>;
  merged_into_candidate_id: string | null;
  promoted_definition_id: string | null;
  promoted_definition_status: string | null;
  model: string;
  prompt_version: string;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

type CandidateEvidenceRow = {
  id: string;
  candidate_id: string;
  document_id: string;
  title: string;
  publisher: string;
  publisher_id: string;
  publisher_owner: string;
  source_class: SourceClass;
  published_at: string;
  url: string;
  evidence_snippet: string;
  interpretation: string;
  stance: ToneDirection;
  risk_tone: number;
  bullish_tone: number;
  affected_entities: string[];
  match_score: number;
  near_duplicate_key: string | null;
};

type PromotionEvidenceRow = CandidateEvidenceRow & {
  document_metadata: Record<string, unknown>;
  evidence_metadata: Record<string, unknown>;
  current_text_hash: string;
  current_text: string;
  evidence_prompt_version: string;
  evidence_model: string;
  tickers: string[];
};

export async function selectDocumentsForNarrativeDiscovery(
  options: DiscoverySelectionOptions,
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
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
      `with eligible as (
         select d.id, d.source_id, d.source_class, d.title, d.publisher, d.url,
                d.published_at, d.created_at, d.tickers, d.summary, d.metadata,
                dt.content, dt.content_hash as text_hash,
                row_number() over (
                  partition by d.source_class
                  order by d.published_at desc, d.created_at desc, d.id
                ) as source_rank
         from documents d
         join document_texts dt on dt.document_id = d.id
         left join document_analysis_runs ar
           on ar.document_id = d.id
          and ar.analysis_type = $1
          and ar.model = $2
          and ar.prompt_version = $3
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and length(btrim(dt.content)) > 0
           and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
           and (
             ar.id is null
             or (
               ar.metadata ? 'textHash'
               and ar.metadata->>'textHash' is distinct from dt.content_hash
             )
             or (
               coalesce(ar.status, '') not in ('completed', 'running')
               and coalesce(ar.attempt_count, 0) < $6
             )
           )
           and not (d.id = any($7::text[]))
       )
       select id, source_id, source_class, title, publisher, url,
              published_at::text, tickers, summary, metadata, content, text_hash
       from eligible
       order by source_rank, published_at desc, source_class, id
       limit $5`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        options.lookbackDays ?? null,
        options.limit,
        options.maxAttempts ?? 5,
        options.excludedDocumentIds ?? []
      ]
    );

    return result.rows
      .filter((row) => row.content.trim().length > 0)
      .map((row) => ({
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
      }));
  } finally {
    await client.end();
  }
}

export async function claimDocumentsForNarrativeDiscovery(
  options: DiscoverySelectionOptions,
  databaseUrl = process.env.DATABASE_URL
): Promise<ClaimedNarrativeDiscoveryDocument[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const candidates = await client.query<{
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
      `with eligible as (
         select d.id, d.source_id, d.source_class, d.title, d.publisher, d.url,
                d.published_at, d.created_at, d.tickers, d.summary, d.metadata,
                dt.content, dt.content_hash as text_hash,
                row_number() over (
                  partition by d.source_class
                  order by d.published_at desc, d.created_at desc, d.id
                ) as source_rank
         from documents d
         join document_texts dt on dt.document_id = d.id
         left join document_analysis_runs ar
           on ar.document_id = d.id
          and ar.analysis_type = $1
          and ar.model = $2
          and ar.prompt_version = $3
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and length(btrim(dt.content)) > 0
           and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
           and (
             ar.id is null
             or (
               ar.metadata ? 'textHash'
               and ar.metadata->>'textHash' is distinct from dt.content_hash
             )
             or (
               coalesce(ar.status, '') not in ('completed', 'running')
               and coalesce(ar.attempt_count, 0) < $6
             )
           )
           and not (d.id = any($7::text[]))
       )
       select id, source_id, source_class, title, publisher, url,
              published_at::text, tickers, summary, metadata, content, text_hash
       from eligible
       order by source_rank, published_at desc, source_class, id
       limit $5`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        options.lookbackDays ?? null,
        options.limit,
        options.maxAttempts ?? 5,
        options.excludedDocumentIds ?? []
      ]
    );
    const claimed: ClaimedNarrativeDiscoveryDocument[] = [];

    for (const row of candidates.rows) {
      const lock = await client.query(
        `select 1 from documents where id = $1 for update skip locked`,
        [row.id]
      );
      if ((lock.rowCount ?? 0) === 0) continue;
      const current = await client.query<{
        status: string;
        attempt_count: number;
        text_hash: string | null;
      }>(
        `select status, attempt_count, metadata->>'textHash' as text_hash
         from document_analysis_runs
         where document_id = $1
           and analysis_type = $2
           and model = $3
           and prompt_version = $4
         for update`,
        [row.id, options.analysisType, options.model, options.promptVersion]
      );
      const sameContent =
        Boolean(current.rows[0]) &&
        (
          !current.rows[0].text_hash ||
          current.rows[0].text_hash === row.text_hash
        );
      if (
        sameContent &&
        (
          ["completed", "running"].includes(current.rows[0]?.status ?? "") ||
          Number(current.rows[0]?.attempt_count ?? 0) >= (options.maxAttempts ?? 5)
        )
      ) {
        continue;
      }

      const runId = discoveryRunId(
        row.id,
        options.analysisType,
        options.model,
        options.promptVersion
      );
      const attemptToken = randomUUID();
      await client.query(
        `insert into document_analysis_runs (
           id, document_id, analysis_type, model, prompt_version,
           status, attempt_count, error_message, started_at, completed_at,
           metadata, updated_at
         ) values (
           $1, $2, $3, $4, $5, 'running', 1, null, now(), null, $6::jsonb, now()
         )
         on conflict (document_id, analysis_type, model, prompt_version)
         do update set
           status = 'running',
           attempt_count = case
             when document_analysis_runs.metadata->>'textHash'
                    is distinct from excluded.metadata->>'textHash'
               then 1
             else document_analysis_runs.attempt_count + 1
           end,
           error_message = null,
           started_at = now(),
           completed_at = null,
           metadata = excluded.metadata,
           updated_at = now()`,
        [
          runId,
          row.id,
          options.analysisType,
          options.model,
          options.promptVersion,
          JSON.stringify({
            sourceId: row.source_id,
            sourceClass: row.source_class,
            textHash: row.text_hash,
            attemptToken,
            ...(options.executionMode
              ? { executionMode: options.executionMode }
              : {}),
            ...(options.anthropicBatchId
              ? { anthropicBatchId: options.anthropicBatchId }
              : {})
          })
        ]
      );
      if (!row.content.trim()) continue;
      claimed.push({
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
        textHash: row.text_hash,
        analysisRunId: runId,
        attemptToken
      });
    }
    await client.query("commit");
    return claimed;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function countNarrativeDiscoveryBacklog(
  options: Omit<DiscoverySelectionOptions, "limit">,
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeBacklogSummary> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ source_class: SourceClass; count: string }>(
      `select d.source_class, count(*)::text as count
       from documents d
       join document_texts dt on dt.document_id = d.id
       left join document_analysis_runs ar
         on ar.document_id = d.id
        and ar.analysis_type = $1
        and ar.model = $2
        and ar.prompt_version = $3
       where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
         and length(btrim(dt.content)) > 0
         and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
         and (
           ar.id is null
           or (
             ar.metadata ? 'textHash'
             and ar.metadata->>'textHash' is distinct from dt.content_hash
           )
           or (
             coalesce(ar.status, '') not in ('completed', 'running')
             and coalesce(ar.attempt_count, 0) < $5
           )
         )
       group by d.source_class
       order by d.source_class`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        options.lookbackDays ?? null,
        options.maxAttempts ?? 5
      ]
    );
    const bySourceClass = result.rows.map((row) => ({
      sourceClass: row.source_class,
      count: Number(row.count)
    }));
    return {
      total: bySourceClass.reduce((sum, row) => sum + row.count, 0),
      bySourceClass
    };
  } finally {
    await client.end();
  }
}

export async function getNarrativeCandidateContexts(
  promptVersion: string,
  limit = 100,
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeCandidateContext[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      cluster_key: string;
      name: string;
      proposition: string;
    }>(
      `select cluster_key, name, proposition
       from narrative_candidates
       where prompt_version = $1 and status = 'pending'
       order by updated_at desc
       limit $2`,
      [promptVersion, limit]
    );
    return result.rows.map((row) => ({
      clusterKey: row.cluster_key,
      name: row.name,
      proposition: row.proposition
    }));
  } finally {
    await client.end();
  }
}

export async function completeNarrativeDiscoveryRun(
  runId: string,
  candidates: NarrativeCandidateInput[],
  options: { databaseUrl?: string; attemptToken?: string } = {}
) {
  const client = createDatabaseClient(options.databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const run = await client.query<{
      status: string;
      attempt_token: string | null;
      document_id: string;
      text_hash: string | null;
      current_text_hash: string;
    }>(
      `select ar.status, ar.metadata->>'attemptToken' as attempt_token,
              ar.document_id, ar.metadata->>'textHash' as text_hash,
              dt.content_hash as current_text_hash
       from document_analysis_runs ar
       join document_texts dt on dt.document_id = ar.document_id
       where ar.id = $1
       for update`,
      [runId]
    );
    if (!run.rows[0]) {
      throw new Error("Narrative discovery run not found.");
    }
    if (run.rows[0].status === "completed") {
      await client.query("commit");
      return {
        candidatesTouched: 0,
        insertedEvidence: 0,
        alreadyCompleted: true
      };
    }
    if (run.rows[0].status !== "running") {
      throw new Error("Narrative discovery run is not active.");
    }
    if (
      options.attemptToken &&
      run.rows[0].attempt_token !== options.attemptToken
    ) {
      throw new Error("Narrative discovery attempt was superseded.");
    }
    if (
      run.rows[0].text_hash &&
      run.rows[0].text_hash !== run.rows[0].current_text_hash
    ) {
      throw new Error("Document text changed during narrative discovery.");
    }

    let insertedEvidence = 0;
    const touchedCandidateIds = new Set<string>();

    for (const candidate of candidates) {
      if (
        candidate.evidence.some(
          (evidence) => evidence.documentId !== run.rows[0].document_id
        )
      ) {
        throw new Error("Narrative candidate evidence does not belong to the discovery run.");
      }
      const persisted = await client.query<{
        id: string;
        status: NarrativeCandidateStatus;
        merged_into_candidate_id: string | null;
      }>(
        `insert into narrative_candidates (
           id, cluster_key, name, proposition, category,
           inclusion_guidance, exclusion_guidance, kind, event_label,
           model, prompt_version, metadata
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
         on conflict (cluster_key, prompt_version) do update set
           model = excluded.model,
           kind = case
             when narrative_candidates.status = 'pending' then excluded.kind
             else narrative_candidates.kind
           end,
           event_label = case
             when narrative_candidates.status = 'pending' then excluded.event_label
             else narrative_candidates.event_label
           end,
           metadata = narrative_candidates.metadata || excluded.metadata,
           updated_at = now()
         returning id, status, merged_into_candidate_id`,
        [
          candidate.id,
          candidate.clusterKey,
          candidate.name,
          candidate.proposition,
          candidate.category,
          candidate.inclusionGuidance,
          candidate.exclusionGuidance,
          candidate.kind ?? "structural",
          candidate.eventLabel ?? null,
          candidate.model,
          candidate.promptVersion,
          JSON.stringify(candidate.metadata ?? {})
        ]
      );
      let candidateId =
        persisted.rows[0].merged_into_candidate_id ?? persisted.rows[0].id;
      let candidateStatus = persisted.rows[0].status;
      let mergedIntoCandidateId = persisted.rows[0].merged_into_candidate_id;
      for (
        let mergeDepth = 0;
        candidateStatus === "merged" && mergedIntoCandidateId && mergeDepth < 20;
        mergeDepth += 1
      ) {
        const mergeTarget = await client.query<{
          id: string;
          status: NarrativeCandidateStatus;
          merged_into_candidate_id: string | null;
        }>(
          `select id, status, merged_into_candidate_id
           from narrative_candidates
           where id = $1`,
          [candidateId]
        );
        if (!mergeTarget.rows[0]) break;
        candidateId = mergeTarget.rows[0].id;
        candidateStatus = mergeTarget.rows[0].status;
        mergedIntoCandidateId = mergeTarget.rows[0].merged_into_candidate_id;
        if (candidateStatus === "merged" && mergedIntoCandidateId) {
          candidateId = mergedIntoCandidateId;
        }
      }
      if (candidateStatus !== "pending") continue;
      touchedCandidateIds.add(candidateId);

      for (const evidence of candidate.evidence) {
        const result = await client.query(
          `insert into narrative_candidate_evidence (
             id, candidate_id, document_id, evidence_snippet, interpretation,
             stance, risk_tone, bullish_tone, affected_entities, match_score,
             model, prompt_version, metadata
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
           )
           on conflict (candidate_id, document_id) do update set
             evidence_snippet = excluded.evidence_snippet,
             interpretation = excluded.interpretation,
             stance = excluded.stance,
             risk_tone = excluded.risk_tone,
             bullish_tone = excluded.bullish_tone,
             affected_entities = excluded.affected_entities,
             match_score = excluded.match_score,
             model = excluded.model,
             prompt_version = excluded.prompt_version,
             metadata = excluded.metadata,
             created_at = now()
           where narrative_candidate_evidence.metadata->>'textHash'
                   is distinct from excluded.metadata->>'textHash'
             and exists (
               select 1
               from narrative_candidates nc
               where nc.id = narrative_candidate_evidence.candidate_id
                 and nc.status = 'pending'
             )`,
          [
            candidateEvidenceId(candidateId, evidence.documentId),
            candidateId,
            evidence.documentId,
            evidence.evidenceSnippet,
            evidence.interpretation,
            evidence.stance,
            evidence.riskTone,
            evidence.bullishTone,
            evidence.affectedEntities,
            evidence.matchScore,
            evidence.model,
            evidence.promptVersion,
            JSON.stringify(evidence.metadata ?? {})
          ]
        );
        insertedEvidence += result.rowCount ?? 0;
      }
    }

    const completed = await client.query(
      `update document_analysis_runs
       set status = 'completed',
           completed_at = now(),
           error_message = null,
           updated_at = now()
       where id = $1
         and status = 'running'
         and ($2::text is null or metadata->>'attemptToken' = $2)`,
      [runId, options.attemptToken ?? null]
    );
    if ((completed.rowCount ?? 0) !== 1) {
      throw new Error("Narrative discovery run could not be completed.");
    }
    await client.query("commit");
    return {
      candidatesTouched: touchedCandidateIds.size,
      insertedEvidence,
      alreadyCompleted: false
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function failNarrativeDiscoveryRun(
  runId: string,
  attemptToken: string,
  error: unknown,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query(
      `update document_analysis_runs
       set status = 'failed',
           error_message = $3,
           completed_at = now(),
           updated_at = now()
       where id = $1
         and status = 'running'
         and metadata->>'attemptToken' = $2`,
      [
        runId,
        attemptToken,
        error instanceof Error ? error.message : String(error)
      ]
    );
    return { failed: (result.rowCount ?? 0) === 1 };
  } finally {
    await client.end();
  }
}

export async function getNarrativeCandidateQueue(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION,
  options: {
    limit?: number;
    minimumDocuments?: number;
    minimumPublisherOwners?: number;
    evidenceWindowDays?: number;
  } = {}
): Promise<NarrativeCandidateQueue> {
  const promptVersion = configuredPromptVersion ?? "narrative_discovery_v1";
  if (!databaseUrl) return emptyCandidateQueue(promptVersion);

  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const counts = await client.query<{ status: NarrativeCandidateStatus; count: string }>(
      `select status, count(*)::text as count
       from narrative_candidates
       where prompt_version = $1
       group by status`,
      [promptVersion]
    );
    const minimumDocuments =
      options.minimumDocuments ?? DEFAULT_CANDIDATE_MIN_DOCUMENTS;
    const minimumPublisherOwners =
      options.minimumPublisherOwners ?? DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS;
    const evidenceWindowDays =
      options.evidenceWindowDays ??
      Number(
        process.env.NARRATIVE_CANDIDATE_EVIDENCE_WINDOW_DAYS ??
          DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS
      );
    const qualifiedCount = await client.query<{ count: string }>(
      `select count(*)::text as count
       from (
         select nc.id
         from narrative_candidates nc
         join narrative_candidate_evidence ce on ce.candidate_id = nc.id
         join documents d on d.id = ce.document_id
         where nc.prompt_version = $1 and nc.status = 'pending'
           and d.published_at >= now() - ($4::text || ' days')::interval
           and d.published_at <= now()
         group by nc.id
         having count(distinct coalesce(
           nullif(d.near_duplicate_key, ''),
           nullif(d.metadata->>'wireStoryId', ''),
           md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
         )) >= $2
            and count(distinct coalesce(
              nullif(lower(btrim(d.publisher_owner)), ''),
              nullif(lower(btrim(d.publisher_id)), ''),
              nullif(lower(btrim(d.publisher)), '')
            )) >= $3
       ) qualified`,
      [
        promptVersion,
        minimumDocuments,
        minimumPublisherOwners,
        evidenceWindowDays
      ]
    );
    const autoEligibleCount = await client.query<{ count: string }>(
      `select count(*)::text as count
       from narrative_candidates
       where prompt_version = $1
         and status = 'pending'
         and promotion_validation->>'status' = 'eligible'`,
      [promptVersion]
    );
    const candidateResult = await client.query<CandidateRow>(
      `with recent_breadth as (
         select ce.candidate_id,
                count(distinct ce.document_id) as document_breadth,
                count(distinct coalesce(
                  nullif(d.near_duplicate_key, ''),
                  nullif(d.metadata->>'wireStoryId', ''),
                  md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
                )) as story_breadth,
                count(distinct coalesce(
                  nullif(lower(btrim(d.publisher_owner)), ''),
                  nullif(lower(btrim(d.publisher_id)), ''),
                  nullif(lower(btrim(d.publisher)), '')
                )) as publisher_owner_breadth
         from narrative_candidate_evidence ce
         join documents d on d.id = ce.document_id
         where d.published_at >= now() - ($2::text || ' days')::interval
           and d.published_at <= now()
         group by ce.candidate_id
       )
       select nc.id, nc.cluster_key, nc.name, nc.proposition, nc.category,
              nc.inclusion_guidance, nc.exclusion_guidance, nc.status,
              nc.kind, nc.event_label, nc.promotion_validation,
              nc.merged_into_candidate_id, nc.promoted_definition_id,
              promoted.status as promoted_definition_status,
              nc.model, nc.prompt_version, nc.review_note, nc.reviewed_at::text,
              nc.created_at::text, nc.updated_at::text
       from narrative_candidates nc
       left join recent_breadth rb on rb.candidate_id = nc.id
       left join narrative_definitions promoted
         on promoted.id = nc.promoted_definition_id
       where nc.prompt_version = $1
         and nc.status in ('pending', 'approved')
       order by
         case nc.status when 'pending' then 0 else 1 end,
         case
           when coalesce(rb.story_breadth, 0) >= $3
            and coalesce(rb.publisher_owner_breadth, 0) >= $4
             then 0
           else 1
         end,
         coalesce(nc.reviewed_at, nc.updated_at) desc
       limit $5`,
      [
        promptVersion,
        evidenceWindowDays,
        minimumDocuments,
        minimumPublisherOwners,
        options.limit ?? 250
      ]
    );
    const candidateIds = candidateResult.rows.map((row) => row.id);
    const evidenceResult = candidateIds.length === 0
      ? { rows: [] as CandidateEvidenceRow[] }
      : await client.query<CandidateEvidenceRow>(
          `select ce.id, ce.candidate_id, ce.document_id,
                  d.title, d.publisher,
                  coalesce(nullif(btrim(d.publisher_id), ''), btrim(d.publisher))
                    as publisher_id,
                  coalesce(
                    nullif(btrim(d.publisher_owner), ''),
                    nullif(btrim(d.publisher_id), ''),
                    btrim(d.publisher)
                  )
                    as publisher_owner,
                  d.source_class, d.published_at::text, d.url,
                  ce.evidence_snippet, ce.interpretation, ce.stance,
                  ce.risk_tone::float, ce.bullish_tone::float,
                  ce.affected_entities, ce.match_score::float,
                  d.near_duplicate_key
           from narrative_candidate_evidence ce
           join documents d on d.id = ce.document_id
           where ce.candidate_id = any($1::text[])
           order by d.published_at desc, ce.match_score desc`,
          [candidateIds]
        );

    const evidenceByCandidate = new Map<string, NarrativeCandidateEvidence[]>();
    for (const row of evidenceResult.rows) {
      const evidence = mapEvidence(row);
      const existing = evidenceByCandidate.get(row.candidate_id) ?? [];
      existing.push(evidence);
      evidenceByCandidate.set(row.candidate_id, existing);
    }

    const candidates = candidateResult.rows.map((row) =>
      mapCandidate(
        row,
        evidenceByCandidate.get(row.id) ?? [],
        minimumDocuments,
        minimumPublisherOwners,
        evidenceWindowDays
      )
    ).sort(
      (left, right) =>
        Number(right.status === "pending") - Number(left.status === "pending") ||
        Number(right.qualified) - Number(left.qualified) ||
        right.publisherOwnerBreadth - left.publisherOwnerBreadth ||
        right.updatedAt.localeCompare(left.updatedAt)
    );
    const countFor = (status: NarrativeCandidateStatus) =>
      Number(counts.rows.find((row) => row.status === status)?.count ?? 0);

    return {
      databaseConfigured: true,
      promptVersion,
      pendingCount: countFor("pending"),
      qualifiedCount: Number(qualifiedCount.rows[0]?.count ?? 0),
      autoEligibleCount: Number(autoEligibleCount.rows[0]?.count ?? 0),
      approvedCount: countFor("approved"),
      rejectedCount: countFor("rejected"),
      mergedCount: countFor("merged"),
      candidates
    };
  } finally {
    await client.end();
  }
}

export async function rejectNarrativeCandidate(
  input: { id: string; note?: string },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ id: string; status: NarrativeCandidateStatus }>(
      `update narrative_candidates
       set status = 'rejected',
           review_note = nullif($2, ''),
           reviewed_at = now(),
           updated_at = now()
       where id = $1 and status = 'pending'
       returning id, status`,
      [input.id, input.note?.trim() ?? ""]
    );
    if (!result.rows[0]) {
      throw new Error("Pending narrative candidate not found.");
    }
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function mergeNarrativeCandidate(
  input: { id: string; targetId: string; note?: string },
  databaseUrl = process.env.DATABASE_URL
) {
  if (input.id === input.targetId) {
    throw new Error("A narrative candidate cannot be merged into itself.");
  }
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const candidates = await client.query<{
      id: string;
      status: NarrativeCandidateStatus;
      prompt_version: string;
    }>(
      `select id, status, prompt_version
       from narrative_candidates
       where id = any($1::text[])
       for update`,
      [[input.id, input.targetId]]
    );
    const source = candidates.rows.find((row) => row.id === input.id);
    const target = candidates.rows.find((row) => row.id === input.targetId);
    if (!source || source.status !== "pending" || !target || target.status !== "pending") {
      throw new Error("Both source and target must be pending narrative candidates.");
    }
    if (source.prompt_version !== target.prompt_version) {
      throw new Error("Narrative candidates from different prompt versions cannot be merged.");
    }

    await client.query(
      `delete from narrative_candidate_evidence source
       where source.candidate_id = $1
         and exists (
           select 1
           from narrative_candidate_evidence target
           where target.candidate_id = $2
             and target.document_id = source.document_id
         )`,
      [input.id, input.targetId]
    );
    await client.query(
      `update narrative_candidate_evidence
       set candidate_id = $2
       where candidate_id = $1`,
      [input.id, input.targetId]
    );
    await client.query(
      `update narrative_candidates
       set merged_into_candidate_id = $2,
           updated_at = now()
       where merged_into_candidate_id = $1`,
      [input.id, input.targetId]
    );
    await client.query(
      `update narrative_candidates
       set status = 'merged',
           merged_into_candidate_id = $2,
           review_note = nullif($3, ''),
           reviewed_at = now(),
           updated_at = now()
       where id = $1`,
      [input.id, input.targetId, input.note?.trim() ?? ""]
    );
    await client.query(
      `update narrative_candidates set updated_at = now() where id = $1`,
      [input.targetId]
    );
    await client.query("commit");
    return { id: input.id, targetId: input.targetId, status: "merged" as const };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export type NarrativeCandidateAutomaticPolicy = CandidatePromotionPolicy;

type NarrativeCandidatePromotionInput = {
  id: string;
  note?: string;
  classificationModel?: string;
  classificationPromptVersion?: string;
  minimumDocuments?: number;
  minimumPublisherOwners?: number;
  evidenceWindowDays?: number;
} & (
  | {
      reviewActorType?: "human";
      reviewMetadata?: Record<string, unknown>;
      automaticPolicy?: never;
      promotionValidation?: CandidatePromotionValidation;
    }
  | {
      reviewActorType: "automatic";
      reviewMetadata?: Record<string, unknown>;
      automaticPolicy: NarrativeCandidateAutomaticPolicy;
      promotionValidation: CandidatePromotionValidation;
    }
);

export type NarrativeCandidateAutoPromotionOptions = {
  discoveryPromptVersion?: string;
  classificationModel?: string;
  classificationPromptVersion?: string;
  minimumMatchScore?: number;
  minimumDocuments?: number;
  minimumPublisherOwners?: number;
  evidenceWindowDays?: number;
  excludedPublisherOwners?: string[];
  limit?: number;
  validateCandidate?: (
    input: CandidatePromotionValidationInput
  ) => Promise<CandidatePromotionValidation>;
};

export async function getCandidatePromotionValidationInput(
  candidateId: string,
  policy: CandidatePromotionPolicy,
  databaseUrl = process.env.DATABASE_URL,
  mode: "automatic" | "manual" = "automatic"
): Promise<CandidatePromotionValidationInput | null> {
  const normalizedPolicy =
    mode === "automatic"
      ? normalizeAutomaticPromotionPolicy(policy)
      : normalizeManualPromotionPolicy(policy);
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const candidateResult = await client.query<CandidateRow>(
      `select id, cluster_key, name, proposition, category,
              inclusion_guidance, exclusion_guidance, status,
              kind, event_label, promotion_validation,
              merged_into_candidate_id, promoted_definition_id,
              model, prompt_version, review_note, reviewed_at::text,
              created_at::text, updated_at::text
       from narrative_candidates
       where id = $1`,
      [candidateId]
    );
    const candidate = candidateResult.rows[0];
    if (!candidate || candidate.status !== "pending") return null;
    const evidenceResult = await client.query<PromotionEvidenceRow>(
      `select ce.id, ce.candidate_id, ce.document_id,
              d.title, d.publisher,
              coalesce(nullif(btrim(d.publisher_id), ''), btrim(d.publisher))
                as publisher_id,
              coalesce(
                nullif(btrim(d.publisher_owner), ''),
                nullif(btrim(d.publisher_id), ''),
                btrim(d.publisher)
              ) as publisher_owner,
              d.source_class, d.published_at::text, d.url,
              ce.evidence_snippet, ce.interpretation, ce.stance,
              ce.risk_tone::float, ce.bullish_tone::float,
              ce.affected_entities, ce.match_score::float,
              d.metadata as document_metadata,
              ce.metadata as evidence_metadata,
              dt.content_hash as current_text_hash,
              dt.content as current_text,
              ce.prompt_version as evidence_prompt_version,
              ce.model as evidence_model,
              d.near_duplicate_key,
              d.tickers
       from narrative_candidate_evidence ce
       join documents d on d.id = ce.document_id
       join document_texts dt on dt.document_id = d.id
       where ce.candidate_id = $1
       order by d.published_at desc, ce.match_score desc`,
      [candidateId]
    );
    const evidence = evidenceResult.rows
      .filter((row) =>
        mode === "automatic"
          ? isAllowedAutomaticPromotionEvidence(
              row,
              candidate,
              normalizedPolicy
            )
          : isAllowedPromotionEvidence(
              row,
              candidate,
              normalizedPolicy,
              false
            )
      )
      .map((row) => ({
        evidenceId: row.id,
        documentId: row.document_id,
        title: row.title,
        publisher: row.publisher,
        publisherOwner: row.publisher_owner,
        sourceClass: row.source_class,
        publishedAt: row.published_at,
        url: row.url,
        tickers: row.tickers,
        nearDuplicateKey: row.near_duplicate_key,
        affectedEntities: row.affected_entities,
        matchScore: Number(row.match_score),
        evidenceSnippet: row.evidence_snippet,
        interpretation: row.interpretation,
        currentText: row.current_text,
        sourceTextHash: row.current_text_hash
      }));
    return {
      candidate: {
        id: candidate.id,
        name: candidate.name,
        proposition: candidate.proposition,
        category: candidate.category,
        inclusionGuidance: candidate.inclusion_guidance,
        exclusionGuidance: candidate.exclusion_guidance
      },
      policy: normalizedPolicy,
      evidence
    };
  } finally {
    await client.end();
  }
}

export async function persistCandidatePromotionValidation(
  candidateId: string,
  validation: CandidatePromotionValidation,
  databaseUrl = process.env.DATABASE_URL
) {
  if (validation.candidateId !== candidateId) {
    throw new Error("Candidate promotion validation id does not match.");
  }
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query(
      `update narrative_candidates
       set promotion_validation = $2::jsonb,
           kind = $3,
           event_label = $4
       where id = $1 and status = 'pending'`,
      [
        candidateId,
        JSON.stringify(validation),
        validation.candidateKind,
        validation.eventLabel
      ]
    );
    return { updated: (result.rowCount ?? 0) === 1 };
  } finally {
    await client.end();
  }
}

export async function autoPromoteNarrativeCandidates(
  options: NarrativeCandidateAutoPromotionOptions = {},
  databaseUrl = process.env.DATABASE_URL
) {
  const discoveryPromptVersion =
    options.discoveryPromptVersion ??
    process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION ??
    "narrative_discovery_v1";
  const classificationModel =
    options.classificationModel ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001";
  const classificationPromptVersion =
    options.classificationPromptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    "narrative_classification_v7";
  const minimumMatchScore =
    Math.max(
      90,
      finiteNumber(
        options.minimumMatchScore ??
          Number(process.env.NARRATIVE_AUTO_PROMOTE_MIN_SCORE ?? 90),
        90
      )
    );
  const minimumDocuments =
    Math.max(
      3,
      finiteInteger(
        options.minimumDocuments ??
          Number(process.env.NARRATIVE_AUTO_PROMOTE_MIN_DOCUMENTS ?? 3),
        3
      )
    );
  const minimumPublisherOwners =
    Math.max(
      3,
      finiteInteger(
        options.minimumPublisherOwners ??
          Number(process.env.NARRATIVE_AUTO_PROMOTE_MIN_PUBLISHER_OWNERS ?? 3),
        3
      )
    );
  const evidenceWindowDays =
    Math.min(
      7,
      Math.max(
        1,
        finiteInteger(
          options.evidenceWindowDays ??
            Number(process.env.NARRATIVE_AUTO_PROMOTE_LOOKBACK_DAYS ?? 7),
          7
        )
      )
    );
  const excludedPublisherOwners = (
    options.excludedPublisherOwners ??
    parseCsv(
      process.env.NARRATIVE_AUTO_REVIEW_EXCLUDED_PUBLISHER_OWNERS ??
        "youtube,youtube-com,youtube.com,youtu.be"
    )
  ).map((value) => value.toLowerCase());
  const limit =
    Math.max(
      1,
      finiteInteger(
        options.limit ??
          Number(process.env.NARRATIVE_AUTO_PROMOTE_MAX_CANDIDATES ?? 5),
        5
      )
    );
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  let candidates: Array<{ id: string }>;
  try {
    const result = await client.query<{ id: string }>(
      `select nc.id
       from narrative_candidates nc
       join narrative_candidate_evidence ce on ce.candidate_id = nc.id
       join documents d on d.id = ce.document_id
       join document_texts dt on dt.document_id = d.id
       where nc.status = 'pending'
         and nc.prompt_version = $1
         and (
           coalesce(nc.promotion_validation->>'status', '') = ''
           or nc.promotion_validation->>'status' = 'eligible'
           or nullif(nc.promotion_validation->>'evaluatedAt', '') is null
           or nc.updated_at >
             (nc.promotion_validation->>'evaluatedAt')::timestamptz
         )
         and ce.prompt_version = nc.prompt_version
         and ce.match_score >= $2
         and ce.metadata->>'textHash' = dt.content_hash
         and d.published_at >= now() - ($3::text || ' days')::interval
         and d.published_at <= now()
         and lower(coalesce(d.metadata->>'content', '')) <> 'preview'
         and not exists (
           select 1
           from unnest($4::text[]) blocked(value)
           where coalesce(
                   nullif(lower(btrim(d.publisher_owner)), ''),
                   nullif(lower(btrim(d.publisher_id)), ''),
                   nullif(lower(btrim(d.publisher)), '')
                 ) = blocked.value
              or lower(btrim(d.publisher)) = blocked.value
              or lower(coalesce(d.metadata->>'platform', '')) = blocked.value
              or lower(d.url) like '%//' || blocked.value || '/%'
              or lower(d.url) like '%.' || blocked.value || '/%'
              or lower(d.url) like '%//' || blocked.value || ':%/%'
              or lower(d.url) like '%.' || blocked.value || ':%/%'
         )
       group by nc.id
       having count(distinct coalesce(
         nullif(d.near_duplicate_key, ''),
         nullif(d.metadata->>'wireStoryId', ''),
         md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
       )) >= $5
          and count(distinct coalesce(
            nullif(lower(btrim(d.publisher_owner)), ''),
            nullif(lower(btrim(d.publisher_id)), ''),
            nullif(lower(btrim(d.publisher)), '')
          )) >= $6
       order by max(d.published_at) desc
       limit $7`,
      [
        discoveryPromptVersion,
        minimumMatchScore,
        evidenceWindowDays,
        excludedPublisherOwners,
        minimumDocuments,
        minimumPublisherOwners,
        limit
      ]
    );
    candidates = result.rows;
  } finally {
    await client.end();
  }

  const automaticPolicy: CandidatePromotionPolicy = {
    minimumMatchScore,
    minimumDocuments,
    minimumPublisherOwners,
    evidenceWindowDays,
    excludedPublisherOwners
  };
  const policy = {
    policyName: "candidate_auto_promotion_v1",
    discoveryPromptVersion,
    classificationModel,
    classificationPromptVersion,
    ...automaticPolicy
  };
  const note =
    `Auto-promoted: score >= ${minimumMatchScore}; corroborated by >= ` +
    `${minimumDocuments} unique stories from >= ${minimumPublisherOwners} ` +
    `publisher groups within ${evidenceWindowDays} days.`;
  const promotedDefinitionIds: string[] = [];
  const failures: Array<{ candidateId: string; error: string }> = [];
  let observationsCreated = 0;
  let candidatesSkippedAlreadyPromoted = 0;
  let candidatesBlocked = 0;
  for (const candidate of candidates) {
    try {
      if (!options.validateCandidate) {
        throw new Error("Automatic candidate promotion validator is not configured.");
      }
      const validationInput = await getCandidatePromotionValidationInput(
        candidate.id,
        automaticPolicy,
        databaseUrl
      );
      if (!validationInput) {
        candidatesSkippedAlreadyPromoted += 1;
        continue;
      }
      const promotionValidation = await options.validateCandidate(
        validationInput
      );
      await persistCandidatePromotionValidation(
        candidate.id,
        promotionValidation,
        databaseUrl
      );
      if (promotionValidation.status !== "eligible") {
        candidatesBlocked += 1;
        continue;
      }
      const promoted = await promoteNarrativeCandidate(
        {
          id: candidate.id,
          note,
          classificationModel,
          classificationPromptVersion,
          minimumDocuments,
          minimumPublisherOwners,
          evidenceWindowDays,
          reviewActorType: "automatic",
          reviewMetadata: policy,
          automaticPolicy,
          promotionValidation
        },
        databaseUrl
      );
      if (promoted.alreadyPromoted) {
        candidatesSkippedAlreadyPromoted += 1;
        continue;
      }
      promotedDefinitionIds.push(promoted.definitionId);
      observationsCreated += promoted.observationsCreated;
    } catch (error) {
      failures.push({
        candidateId: candidate.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return {
    candidatesEvaluated: candidates.length,
    candidatesPromoted: promotedDefinitionIds.length,
    candidatesBlocked,
    observationsCreated,
    candidatesSkippedAlreadyPromoted,
    promotedDefinitionIds,
    failedCandidates: failures
  };
}

export async function promoteNarrativeCandidate(
  input: NarrativeCandidatePromotionInput,
  databaseUrl = process.env.DATABASE_URL
) {
  if (
    (input.reviewActorType === "automatic") !== Boolean(input.automaticPolicy)
  ) {
    throw new Error(
      "Automatic candidate promotion requires its complete safety policy."
    );
  }
  if (
    input.reviewActorType === "automatic" &&
    (
      input.promotionValidation.candidateId !== input.id ||
      !isAutomaticPromotionValidationEligible(input.promotionValidation)
    )
  ) {
    throw new Error("Automatic candidate promotion requires eligible semantic validation.");
  }
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const candidateResult = await client.query<CandidateRow>(
      `select id, cluster_key, name, proposition, category,
              inclusion_guidance, exclusion_guidance, status,
              kind, event_label, promotion_validation,
              merged_into_candidate_id, promoted_definition_id,
              model, prompt_version, review_note, reviewed_at::text,
              created_at::text, updated_at::text
       from narrative_candidates
       where id = $1
       for update`,
      [input.id]
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new Error("Narrative candidate not found.");
    if (candidate.status === "approved" && candidate.promoted_definition_id) {
      await client.query("commit");
      return {
        candidateId: candidate.id,
        definitionId: candidate.promoted_definition_id,
        observationsCreated: 0,
        alreadyPromoted: true
      };
    }
    if (candidate.status !== "pending") {
      throw new Error("Only pending narrative candidates can be promoted.");
    }
    const semanticValidation =
      input.promotionValidation ??
      (isPromotionValidation(candidate.promotion_validation)
        ? candidate.promotion_validation
        : null);
    if (
      semanticValidation &&
      semanticValidation.candidateId !== candidate.id
    ) {
      throw new Error("Candidate promotion validation id does not match.");
    }
    if (
      input.reviewActorType !== "automatic" &&
      semanticValidation &&
      semanticValidation.status !== "eligible" &&
      !input.note?.trim()
    ) {
      throw new Error(
        "Manual promotion requires an explicit override reason for validation blockers."
      );
    }
    const automaticPolicy = input.automaticPolicy
      ? normalizeAutomaticPromotionPolicy(input.automaticPolicy)
      : null;

    const evidenceResult = await client.query<PromotionEvidenceRow>(
      `select ce.id, ce.candidate_id, ce.document_id,
              d.title, d.publisher,
              coalesce(nullif(btrim(d.publisher_id), ''), btrim(d.publisher)) as publisher_id,
              coalesce(
                nullif(btrim(d.publisher_owner), ''),
                nullif(btrim(d.publisher_id), ''),
                btrim(d.publisher)
              )
                as publisher_owner,
              d.source_class, d.published_at::text, d.url,
              ce.evidence_snippet, ce.interpretation, ce.stance,
              ce.risk_tone::float, ce.bullish_tone::float,
              ce.affected_entities, ce.match_score::float,
              d.metadata as document_metadata,
              ce.metadata as evidence_metadata,
              dt.content_hash as current_text_hash,
              dt.content as current_text,
              ce.prompt_version as evidence_prompt_version,
              ce.model as evidence_model,
              d.near_duplicate_key,
              d.tickers
       from narrative_candidate_evidence ce
       join documents d on d.id = ce.document_id
       join document_texts dt on dt.document_id = d.id
       where ce.candidate_id = $1
       order by d.published_at desc
       for share of ce, d, dt`,
      [candidate.id]
    );
    const mechanicallyAllowedRows = automaticPolicy
      ? evidenceResult.rows.filter((row) =>
          isAllowedAutomaticPromotionEvidence(
            row,
            candidate,
            automaticPolicy
          )
        )
      : evidenceResult.rows;
    const validationEvidence = semanticValidation
      ? new Map(
          semanticValidation.evidence.map((item) => [
            item.evidenceId,
            item
          ])
        )
      : null;
    const selectedRows = validationEvidence
      ? mechanicallyAllowedRows.filter((row) => {
          const validated = validationEvidence.get(row.id);
          return (
            validated?.verdict === "support" &&
            validated.sourceTextHash === row.current_text_hash
          );
        })
      : mechanicallyAllowedRows;
    const evidence = selectedRows.map(mapEvidence);
    const evidenceWindowDays =
      automaticPolicy?.evidenceWindowDays ??
      input.evidenceWindowDays ??
      Number(
        process.env.NARRATIVE_CANDIDATE_EVIDENCE_WINDOW_DAYS ??
          DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS
      );
    const qualification = candidateBreadth(
      recentCandidateEvidence(evidence, evidenceWindowDays)
    );
    const minimumDocuments =
      automaticPolicy?.minimumDocuments ??
      input.minimumDocuments ??
      DEFAULT_CANDIDATE_MIN_DOCUMENTS;
    const minimumPublisherOwners =
      automaticPolicy?.minimumPublisherOwners ??
      input.minimumPublisherOwners ??
      DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS;
    if (
      !isNarrativeCandidateQualified(
        qualification,
        minimumDocuments,
        minimumPublisherOwners
      )
    ) {
      throw new Error(
        `Candidate needs at least ${minimumDocuments} unique stories from ${minimumPublisherOwners} publisher groups before promotion.`
      );
    }
    if (!semanticValidation) {
      throw new Error(
        "Candidate promotion requires quotation-level semantic validation."
      );
    }
    if (
      input.reviewActorType === "automatic" &&
      (
        input.promotionValidation.breadth.storyBreadth < minimumDocuments ||
        input.promotionValidation.breadth.publisherOwnerBreadth <
          minimumPublisherOwners ||
        input.promotionValidation.supportedEvidenceIds.length <
          minimumDocuments
      )
    ) {
      throw new Error("Semantic validation does not meet automatic breadth policy.");
    }

    const slug = slugifyNarrativeCandidate(candidate.cluster_key || candidate.name);
    const trackedDefinitions = await client.query<{
      id: string;
      name: string;
      proposition: string;
    }>(
      `select id, name, proposition
       from narrative_definitions
       where status in ('active', 'probationary')`
    );
    const semanticCollision = trackedDefinitions.rows.find((definition) =>
      narrativeDescriptionsOverlap(
        candidate.name,
        candidate.proposition,
        definition.name,
        definition.proposition
      )
    );
    if (semanticCollision) {
      throw new Error(
        `Candidate overlaps tracked narrative "${semanticCollision.name}" (${semanticCollision.id}); merge or refine it instead of creating another definition.`
      );
    }
    const activeCollision = await client.query(
      `select 1
       from narrative_definitions
       where slug = $1
         and status in ('active', 'probationary', 'family')
       limit 1`,
      [slug]
    );
    if ((activeCollision.rowCount ?? 0) > 0) {
      throw new Error(`A tracked narrative already uses the slug "${slug}".`);
    }
    const versionResult = await client.query<{ version: number }>(
      `select coalesce(max(version), 0) + 1 as version
       from narrative_definitions
       where slug = $1`,
      [slug]
    );
    const version = Number(versionResult.rows[0]?.version ?? 1);
    const definitionId = `narrative:def:${slug}:v${version}`;
    const promotionKind =
      semanticValidation?.candidateKind ?? candidate.kind;
    const promotionEventLabel =
      promotionKind === "event"
        ? semanticValidation?.eventLabel ?? candidate.event_label
        : null;
    const eventExpiresAt =
      promotionKind === "event"
        ? addDays(
            evidence.reduce(
              (latest, item) =>
                item.publishedAt > latest ? item.publishedAt : latest,
              evidence[0]?.publishedAt ?? new Date().toISOString()
            ),
            Number(process.env.NARRATIVE_EVENT_TTL_DAYS ?? 14)
          )
        : null;
    await client.query(
      `insert into narrative_definitions (
         id, slug, version, name, proposition, category,
         inclusion_guidance, exclusion_guidance, positive_examples,
         negative_examples, status, kind, event_label, metadata,
         event_expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', 'probationary',
         $10, $11, $12::jsonb, $13::timestamptz
       )`,
      [
        definitionId,
        slug,
        version,
        candidate.name,
        candidate.proposition,
        candidate.category,
        candidate.inclusion_guidance,
        candidate.exclusion_guidance,
        evidence.slice(0, 5).map((item) => item.evidenceSnippet),
        promotionKind,
        promotionEventLabel,
        JSON.stringify({
          origin: "candidate_promotion",
          candidateId: candidate.id,
          promotionValidation: semanticValidation
        }),
        eventExpiresAt
      ]
    );

    const classificationModel =
      input.classificationModel ??
      process.env.ANTHROPIC_MODEL ??
      "claude-haiku-4-5-20251001";
    const classificationPromptVersion =
      input.classificationPromptVersion ??
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
      "narrative_classification_v7";
    const reviewActorType = input.reviewActorType ?? "human";
    const reviewedAt = new Date().toISOString();
    const qualifyingEvidence = selectedRows.map((row) => {
      const validated = semanticValidation?.evidence.find(
        (item) => item.evidenceId === row.id
      );
      return {
        evidenceId: row.id,
        documentId: row.document_id,
        publisherOwner: normalizePublisherOwner(row.publisher_owner),
        matchScore: Number(row.match_score),
        publishedAt: row.published_at,
        url: row.url,
        hostname: canonicalHostname(row.url),
        textHash: row.current_text_hash,
        evidenceSnippetHash: createHash("sha256")
          .update(row.evidence_snippet)
          .digest("hex"),
        storyFingerprint: validated?.storyFingerprint ?? null,
        eventKey: validated?.eventKey ?? null,
        primaryEntityKey: validated?.primaryEntityKey ?? null,
        validationReason: validated?.reason ?? null,
        discoveryModel: row.evidence_model,
        discoveryPromptVersion: row.evidence_prompt_version
      };
    });
    const reviewMetadata = {
      ...(input.reviewMetadata ?? {}),
      ...(automaticPolicy ? { automaticPolicy } : {}),
      promotedDefinitionId: definitionId,
      promotionValidation: semanticValidation,
      qualifyingEvidence
    };
    const reviewProvenance = {
      ...reviewMetadata,
      actorType: reviewActorType,
      reviewedAt
    };
    let observationsCreated = 0;
    for (const item of evidence) {
      const result = await client.query(
        `insert into narrative_observations (
           id, narrative_definition_id, document_id, matched, match_score,
           stance, risk_tone, bullish_tone, evidence_snippet, interpretation,
           affected_entities, model, prompt_version, metadata,
           review_status, reviewed_at, review_note
         ) values (
           $1, $2, $3, true, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13::jsonb, 'pending', null, $14
         )
         on conflict (narrative_definition_id, document_id, model, prompt_version)
         do nothing`,
        [
          promotedObservationId(
            definitionId,
            item.documentId,
            classificationModel,
            classificationPromptVersion
          ),
          definitionId,
          item.documentId,
          item.matchScore,
          item.stance,
          item.riskTone,
          item.bullishTone,
          item.evidenceSnippet,
          item.interpretation,
          item.affectedEntities,
          classificationModel,
          classificationPromptVersion,
          JSON.stringify({
            promotedFromCandidateId: candidate.id,
            promotionSeed: true,
            discoveryPromptVersion: candidate.prompt_version,
            reviewProvenance,
            ...(reviewActorType === "automatic"
              ? { autoReview: reviewMetadata }
              : {})
          }),
          input.note?.trim() ||
            "Seeded for fresh classification after candidate promotion."
        ]
      );
      observationsCreated += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) > 0) {
        const observationId = promotedObservationId(
          definitionId,
          item.documentId,
          classificationModel,
          classificationPromptVersion
        );
        await client.query(
          `insert into narrative_review_events (
             id, observation_id, observation_key, previous_status, new_status,
             actor_type, review_note, metadata
           ) values (
             $1, $2, $2, 'pending', 'pending', $3, $4, $5::jsonb
           )`,
          [
            `narrative:review-event:${randomUUID()}`,
            observationId,
            reviewActorType,
            input.note?.trim() ||
              "Seeded for fresh classification after candidate promotion.",
            JSON.stringify({
              action: "candidate_promotion",
              candidateId: candidate.id,
              reviewProvenance
            })
          ]
        );
      }
    }

    await client.query(
      `update narrative_candidates
       set status = 'approved',
           promoted_definition_id = $2,
           review_note = nullif($3, ''),
           reviewed_at = now(),
           metadata = metadata || $4::jsonb,
           kind = $5,
           event_label = $6,
           promotion_validation = $7::jsonb,
           updated_at = now()
       where id = $1`,
      [
        candidate.id,
        definitionId,
        input.note?.trim() ?? "",
        JSON.stringify({ promotionProvenance: reviewProvenance }),
        promotionKind,
        promotionEventLabel,
        JSON.stringify(semanticValidation ?? {})
      ]
    );
    await client.query("commit");
    return {
      candidateId: candidate.id,
      definitionId,
      observationsCreated,
      alreadyPromoted: false
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export function isNarrativeCandidateQualified(
  breadth: {
    documentBreadth: number;
    storyBreadth?: number;
    publisherOwnerBreadth: number;
  },
  minimumDocuments = DEFAULT_CANDIDATE_MIN_DOCUMENTS,
  minimumPublisherOwners = DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS
) {
  return (
    (breadth.storyBreadth ?? breadth.documentBreadth) >= minimumDocuments &&
    breadth.publisherOwnerBreadth >= minimumPublisherOwners
  );
}

export function slugifyNarrativeCandidate(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "emerging-narrative";
}

export function narrativeDescriptionsOverlap(
  leftName: string,
  leftProposition: string,
  rightName: string,
  rightProposition: string
) {
  return (
    tokenSimilarity(leftName, rightName) >= 0.5 ||
    tokenSimilarity(leftProposition, rightProposition) >= 0.55
  );
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token)
  ).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function meaningfulTokens(value: string) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "because",
    "for",
    "from",
    "in",
    "is",
    "of",
    "or",
    "the",
    "to"
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token))
      .map(canonicalNarrativeToken)
  );
}

function canonicalNarrativeToken(token: string) {
  if (["oil", "crude", "petroleum"].includes(token)) return "energy";
  if (["rates", "hike", "hikes", "tightening"].includes(token)) {
    return "rate";
  }
  if (["prices", "pricing"].includes(token)) return "price";
  return token;
}

function isAllowedAutomaticPromotionEvidence(
  row: PromotionEvidenceRow,
  candidate: CandidateRow,
  policy: NarrativeCandidateAutomaticPolicy
) {
  return isAllowedPromotionEvidence(
    row,
    candidate,
    normalizeAutomaticPromotionPolicy(policy)
  );
}

function isAllowedPromotionEvidence(
  row: PromotionEvidenceRow,
  candidate: CandidateRow,
  policy: CandidatePromotionPolicy,
  requireStoredTextHash = true
) {
  const publishedAt = new Date(row.published_at).getTime();
  const now = Date.now();
  const cutoff = now - policy.evidenceWindowDays * 24 * 60 * 60 * 1_000;
  const evidenceTextHash = row.evidence_metadata.textHash;
  const matchScore = Number(row.match_score);
  if (
    !Number.isFinite(matchScore) ||
    matchScore < policy.minimumMatchScore ||
    matchScore > 100 ||
    row.evidence_snippet.trim().length === 0 ||
    row.evidence_prompt_version !== candidate.prompt_version ||
    (requireStoredTextHash &&
      (
        typeof evidenceTextHash !== "string" ||
        evidenceTextHash !== row.current_text_hash
      )) ||
    !row.current_text.includes(row.evidence_snippet) ||
    !Number.isFinite(publishedAt) ||
    publishedAt < cutoff ||
    publishedAt > now ||
    String(row.document_metadata.content ?? "").trim().toLowerCase() === "preview"
  ) {
    return false;
  }

  const blocked = new Set(
    policy.excludedPublisherOwners.map((value) =>
      value.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "")
    )
  );
  const normalizedOwner =
    normalizePublisherOwner(row.publisher_owner) ||
    normalizePublisherOwner(row.publisher_id) ||
    row.publisher.trim().toLowerCase();
  if (!normalizedOwner) return false;
  const sourceValues = [
    normalizedOwner,
    row.publisher.trim().toLowerCase(),
    String(row.document_metadata.platform ?? "").trim().toLowerCase()
  ];
  if (sourceValues.some((value) => blocked.has(value))) return false;
  try {
    const url = new URL(row.url);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.+$/, "");
    if (!hostname) return false;
    if (
      [...blocked].some(
        (value) => hostname === value || hostname.endsWith(`.${value}`)
      )
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function normalizeManualPromotionPolicy(
  policy: CandidatePromotionPolicy
): CandidatePromotionPolicy {
  return {
    minimumMatchScore: Math.max(
      75,
      Math.min(100, finiteNumber(policy.minimumMatchScore, 75))
    ),
    minimumDocuments: Math.max(
      2,
      finiteInteger(policy.minimumDocuments, 2)
    ),
    minimumPublisherOwners: Math.max(
      2,
      finiteInteger(policy.minimumPublisherOwners, 2)
    ),
    evidenceWindowDays: Math.max(
      1,
      Math.min(30, finiteInteger(policy.evidenceWindowDays, 30))
    ),
    excludedPublisherOwners: policy.excludedPublisherOwners.map((value) =>
      value.trim().toLowerCase()
    )
  };
}

function normalizeAutomaticPromotionPolicy(
  policy: NarrativeCandidateAutomaticPolicy
): NarrativeCandidateAutomaticPolicy {
  return {
    minimumMatchScore: Math.max(
      90,
      finiteNumber(policy.minimumMatchScore, 90)
    ),
    minimumDocuments: Math.max(
      3,
      finiteInteger(policy.minimumDocuments, 3)
    ),
    minimumPublisherOwners: Math.max(
      3,
      finiteInteger(policy.minimumPublisherOwners, 3)
    ),
    evidenceWindowDays: Math.max(
      1,
      Math.min(7, finiteInteger(policy.evidenceWindowDays, 7))
    ),
    excludedPublisherOwners: policy.excludedPublisherOwners.map((value) =>
      value.trim().toLowerCase()
    )
  };
}

function normalizePublisherOwner(value: string) {
  return value.trim().toLowerCase();
}

function canonicalHostname(value: string) {
  try {
    const url = new URL(value);
    return url.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.+$/, "");
  } catch {
    return null;
  }
}

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function finiteInteger(value: number, fallback: number) {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapEvidence(row: CandidateEvidenceRow): NarrativeCandidateEvidence {
  return {
    id: row.id,
    documentId: row.document_id,
    title: row.title,
    publisher: row.publisher,
    publisherId: row.publisher_id,
    publisherOwner: row.publisher_owner,
    sourceClass: row.source_class,
    publishedAt: row.published_at,
    url: row.url,
    evidenceSnippet: row.evidence_snippet,
    interpretation: row.interpretation,
    stance: row.stance,
    riskTone: Number(row.risk_tone),
    bullishTone: Number(row.bullish_tone),
    affectedEntities: row.affected_entities,
    matchScore: Number(row.match_score),
    storyFingerprint:
      row.near_duplicate_key ??
      createHash("sha256")
        .update(row.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
        .digest("hex")
  };
}

function mapCandidate(
  row: CandidateRow,
  evidence: NarrativeCandidateEvidence[],
  minimumDocuments: number,
  minimumPublisherOwners: number,
  evidenceWindowDays: number
): NarrativeCandidateSummary {
  const breadth = candidateBreadth(
    recentCandidateEvidence(evidence, evidenceWindowDays)
  );
  return {
    id: row.id,
    clusterKey: row.cluster_key,
    name: row.name,
    proposition: row.proposition,
    category: row.category,
    inclusionGuidance: row.inclusion_guidance,
    exclusionGuidance: row.exclusion_guidance,
    status: row.status,
    kind: row.kind,
    eventLabel: row.event_label,
    mergedIntoCandidateId: row.merged_into_candidate_id,
    promotedDefinitionId: row.promoted_definition_id,
    promotedDefinitionStatus: row.promoted_definition_status ?? null,
    model: row.model,
    promptVersion: row.prompt_version,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...breadth,
    qualified: isNarrativeCandidateQualified(
      breadth,
      minimumDocuments,
      minimumPublisherOwners
    ),
    promotionValidation: isPromotionValidation(row.promotion_validation)
      ? row.promotion_validation
      : null,
    evidence
  };
}

function isPromotionValidation(
  value: CandidatePromotionValidation | Record<string, never>
): value is CandidatePromotionValidation {
  return (
    typeof value === "object" &&
    value !== null &&
    "candidateId" in value &&
    "status" in value &&
    "breadth" in value
  );
}

function isAutomaticPromotionValidationEligible(
  validation: CandidatePromotionValidation
) {
  if (
    validation.status !== "eligible" ||
    validation.reasons.length > 0 ||
    validation.supportedEvidenceIds.length === 0
  ) {
    return false;
  }
  if (validation.candidateKind === "event") {
    return Boolean(validation.eventLabel) && validation.breadth.eventBreadth === 1;
  }
  return (
    (validation.breadth.eventBreadth >= 2 ||
      validation.breadth.primaryEntityBreadth >= 2) &&
    (validation.breadth.sourceClassBreadth >= 2 ||
      validation.breadth.eventBreadth >= 2)
  );
}

function candidateBreadth(evidence: NarrativeCandidateEvidence[]) {
  return {
    documentBreadth: new Set(evidence.map((item) => item.documentId)).size,
    storyBreadth: new Set(
      evidence.map((item) => item.storyFingerprint)
    ).size,
    publisherBreadth: new Set(
      evidence
        .map((item) => item.publisherId.trim().toLowerCase())
        .filter(Boolean)
    ).size,
    publisherOwnerBreadth: new Set(
      evidence
        .map((item) => normalizePublisherOwner(item.publisherOwner))
        .filter(Boolean)
    ).size,
    sourceClassBreadth: new Set(evidence.map((item) => item.sourceClass)).size,
    entityBreadth: new Set(evidence.flatMap((item) => item.affectedEntities)).size
  };
}

function recentCandidateEvidence(
  evidence: NarrativeCandidateEvidence[],
  windowDays: number
) {
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1_000;
  return evidence.filter((item) => {
    const publishedAt = new Date(item.publishedAt).getTime();
    return publishedAt >= cutoff && publishedAt <= now;
  });
}

function candidateEvidenceId(candidateId: string, documentId: string) {
  return `narrative:candidate:evidence:${createHash("sha256")
    .update(`${candidateId}:${documentId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function discoveryRunId(
  documentId: string,
  analysisType: string,
  model: string,
  promptVersion: string
) {
  return `analysis:${createHash("sha256")
    .update(`${documentId}:${analysisType}:${model}:${promptVersion}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function promotedObservationId(
  definitionId: string,
  documentId: string,
  model: string,
  promptVersion: string
) {
  return `narrative:obs:${createHash("sha256")
    .update(`${definitionId}:${documentId}:${model}:${promptVersion}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function addDays(value: string, configuredDays: number) {
  const date = new Date(value);
  const days =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? Math.min(Math.floor(configuredDays), 90)
      : 14;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function emptyCandidateQueue(promptVersion: string): NarrativeCandidateQueue {
  return {
    databaseConfigured: false,
    promptVersion,
    pendingCount: 0,
    qualifiedCount: 0,
    autoEligibleCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    mergedCount: 0,
    candidates: []
  };
}
