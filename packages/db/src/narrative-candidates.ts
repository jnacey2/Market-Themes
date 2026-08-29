import { createHash, randomUUID } from "node:crypto";
import { createDatabaseClient } from "./persistence";
import type {
  AnalysisDocument,
  NarrativeBacklogSummary,
  NarrativeCandidateContext,
  NarrativeCandidateEvidence,
  NarrativeCandidateInput,
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
  merged_into_candidate_id: string | null;
  promoted_definition_id: string | null;
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
           and coalesce(ar.status, '') not in ('completed', 'running')
           and coalesce(ar.attempt_count, 0) < $6
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
           and coalesce(ar.status, '') not in ('completed', 'running')
           and coalesce(ar.attempt_count, 0) < $6
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
      const current = await client.query<{ status: string; attempt_count: number }>(
        `select status, attempt_count
         from document_analysis_runs
         where document_id = $1
           and analysis_type = $2
           and model = $3
           and prompt_version = $4
         for update`,
        [row.id, options.analysisType, options.model, options.promptVersion]
      );
      if (
        ["completed", "running"].includes(current.rows[0]?.status ?? "") ||
        Number(current.rows[0]?.attempt_count ?? 0) >= (options.maxAttempts ?? 5)
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
           attempt_count = document_analysis_runs.attempt_count + 1,
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
            attemptToken
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
         and coalesce(ar.status, '') not in ('completed', 'running')
         and coalesce(ar.attempt_count, 0) < $5
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
    }>(
      `select status, metadata->>'attemptToken' as attempt_token, document_id
       from document_analysis_runs
       where id = $1
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
           inclusion_guidance, exclusion_guidance, model, prompt_version, metadata
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         on conflict (cluster_key, prompt_version) do update set
           model = excluded.model,
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
          candidate.model,
          candidate.promptVersion,
          JSON.stringify(candidate.metadata ?? {})
        ]
      );
      let candidateId =
        persisted.rows[0].merged_into_candidate_id ?? persisted.rows[0].id;
      let candidateStatus = persisted.rows[0].status;
      if (persisted.rows[0].merged_into_candidate_id) {
        const mergeTarget = await client.query<{
          id: string;
          status: NarrativeCandidateStatus;
        }>(
          `select id, status from narrative_candidates where id = $1`,
          [candidateId]
        );
        if (!mergeTarget.rows[0]) continue;
        candidateId = mergeTarget.rows[0].id;
        candidateStatus = mergeTarget.rows[0].status;
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
           on conflict (candidate_id, document_id) do nothing`,
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
         group by nc.id
         having count(distinct ce.document_id) >= $2
            and count(distinct coalesce(
              nullif(d.publisher_owner, ''),
              nullif(d.publisher_id, ''),
              d.publisher
            )) >= $3
       ) qualified`,
      [
        promptVersion,
        minimumDocuments,
        minimumPublisherOwners,
        evidenceWindowDays
      ]
    );
    const candidateResult = await client.query<CandidateRow>(
      `select id, cluster_key, name, proposition, category,
              inclusion_guidance, exclusion_guidance, status,
              merged_into_candidate_id, promoted_definition_id,
              model, prompt_version, review_note, reviewed_at::text,
              created_at::text, updated_at::text
       from narrative_candidates
       where prompt_version = $1
         and status in ('pending', 'approved')
       order by
         case status when 'pending' then 0 else 1 end,
         coalesce(reviewed_at, updated_at) desc
       limit $2`,
      [promptVersion, options.limit ?? 250]
    );
    const candidateIds = candidateResult.rows.map((row) => row.id);
    const evidenceResult = candidateIds.length === 0
      ? { rows: [] as CandidateEvidenceRow[] }
      : await client.query<CandidateEvidenceRow>(
          `select ce.id, ce.candidate_id, ce.document_id,
                  d.title, d.publisher,
                  coalesce(nullif(d.publisher_id, ''), d.publisher) as publisher_id,
                  coalesce(nullif(d.publisher_owner, ''), nullif(d.publisher_id, ''), d.publisher)
                    as publisher_owner,
                  d.source_class, d.published_at::text, d.url,
                  ce.evidence_snippet, ce.interpretation, ce.stance,
                  ce.risk_tone::float, ce.bullish_tone::float,
                  ce.affected_entities, ce.match_score::float
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

export async function promoteNarrativeCandidate(
  input: {
    id: string;
    note?: string;
    classificationModel?: string;
    classificationPromptVersion?: string;
    minimumDocuments?: number;
    minimumPublisherOwners?: number;
    evidenceWindowDays?: number;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const candidateResult = await client.query<CandidateRow>(
      `select id, cluster_key, name, proposition, category,
              inclusion_guidance, exclusion_guidance, status,
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

    const evidenceResult = await client.query<CandidateEvidenceRow>(
      `select ce.id, ce.candidate_id, ce.document_id,
              d.title, d.publisher,
              coalesce(nullif(d.publisher_id, ''), d.publisher) as publisher_id,
              coalesce(nullif(d.publisher_owner, ''), nullif(d.publisher_id, ''), d.publisher)
                as publisher_owner,
              d.source_class, d.published_at::text, d.url,
              ce.evidence_snippet, ce.interpretation, ce.stance,
              ce.risk_tone::float, ce.bullish_tone::float,
              ce.affected_entities, ce.match_score::float
       from narrative_candidate_evidence ce
       join documents d on d.id = ce.document_id
       where ce.candidate_id = $1
       order by d.published_at desc`,
      [candidate.id]
    );
    const evidence = evidenceResult.rows.map(mapEvidence);
    const evidenceWindowDays =
      input.evidenceWindowDays ??
      Number(
        process.env.NARRATIVE_CANDIDATE_EVIDENCE_WINDOW_DAYS ??
          DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS
      );
    const qualification = candidateBreadth(
      recentCandidateEvidence(evidence, evidenceWindowDays)
    );
    const minimumDocuments = input.minimumDocuments ?? DEFAULT_CANDIDATE_MIN_DOCUMENTS;
    const minimumPublisherOwners =
      input.minimumPublisherOwners ?? DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS;
    if (
      !isNarrativeCandidateQualified(
        qualification,
        minimumDocuments,
        minimumPublisherOwners
      )
    ) {
      throw new Error(
        `Candidate needs at least ${minimumDocuments} documents from ${minimumPublisherOwners} independent publisher groups before promotion.`
      );
    }

    const slug = slugifyNarrativeCandidate(candidate.cluster_key || candidate.name);
    const activeCollision = await client.query(
      `select 1 from narrative_definitions where slug = $1 and status = 'active' limit 1`,
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
    await client.query(
      `insert into narrative_definitions (
         id, slug, version, name, proposition, category,
         inclusion_guidance, exclusion_guidance, positive_examples,
         negative_examples, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}', 'active')`,
      [
        definitionId,
        slug,
        version,
        candidate.name,
        candidate.proposition,
        candidate.category,
        candidate.inclusion_guidance,
        candidate.exclusion_guidance,
        evidence.slice(0, 5).map((item) => item.evidenceSnippet)
      ]
    );

    const classificationModel =
      input.classificationModel ??
      process.env.ANTHROPIC_MODEL ??
      "claude-sonnet-4-5-20250929";
    const classificationPromptVersion =
      input.classificationPromptVersion ??
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
      "narrative_classification_v5";
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
           $10, $11, $12, $13::jsonb, 'approved', now(), $14
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
            discoveryPromptVersion: candidate.prompt_version
          }),
          input.note?.trim() || "Approved with discovered narrative candidate."
        ]
      );
      observationsCreated += result.rowCount ?? 0;
    }

    await client.query(
      `update narrative_candidates
       set status = 'approved',
           promoted_definition_id = $2,
           review_note = nullif($3, ''),
           reviewed_at = now(),
           updated_at = now()
       where id = $1`,
      [candidate.id, definitionId, input.note?.trim() ?? ""]
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
  breadth: { documentBreadth: number; publisherOwnerBreadth: number },
  minimumDocuments = DEFAULT_CANDIDATE_MIN_DOCUMENTS,
  minimumPublisherOwners = DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS
) {
  return (
    breadth.documentBreadth >= minimumDocuments &&
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
    matchScore: Number(row.match_score)
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
    mergedIntoCandidateId: row.merged_into_candidate_id,
    promotedDefinitionId: row.promoted_definition_id,
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
    evidence
  };
}

function candidateBreadth(evidence: NarrativeCandidateEvidence[]) {
  return {
    documentBreadth: new Set(evidence.map((item) => item.documentId)).size,
    publisherBreadth: new Set(evidence.map((item) => item.publisherId)).size,
    publisherOwnerBreadth: new Set(evidence.map((item) => item.publisherOwner)).size,
    sourceClassBreadth: new Set(evidence.map((item) => item.sourceClass)).size,
    entityBreadth: new Set(evidence.flatMap((item) => item.affectedEntities)).size
  };
}

function recentCandidateEvidence(
  evidence: NarrativeCandidateEvidence[],
  windowDays: number
) {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1_000;
  return evidence.filter(
    (item) => new Date(item.publishedAt).getTime() >= cutoff
  );
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

function emptyCandidateQueue(promptVersion: string): NarrativeCandidateQueue {
  return {
    databaseConfigured: false,
    promptVersion,
    pendingCount: 0,
    qualifiedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    mergedCount: 0,
    candidates: []
  };
}
