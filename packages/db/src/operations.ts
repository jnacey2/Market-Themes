import { randomUUID } from "node:crypto";
import { closeDatabaseClient, createDatabaseClient } from "./persistence";
import {
  DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS,
  DEFAULT_CANDIDATE_MIN_DOCUMENTS,
  DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS
} from "./narrative-candidates";
import type {
  ConnectorCheckpointSummary,
  OperationsStatus,
  SourceClass,
  SourcePipelineTelemetry
} from "./types";

export async function startPipelineRun(stage: string, metadata: Record<string, unknown> = {}) {
  const client = createDatabaseClient();
  const id = `pipeline:${stage}:${randomUUID()}`;
  const staleAfterMinutes = Number(
    process.env.PIPELINE_STALE_RUN_MINUTES ?? 90
  );
  await client.connect();

  try {
    await client.query(
      `update pipeline_runs
       set status = 'failed',
           completed_at = now(),
           error_message = 'Marked failed after the prior pipeline run became stale.'
       where stage = $1
         and status = 'running'
         and started_at < now() - ($2::text || ' minutes')::interval`,
      [stage, staleAfterMinutes]
    );
    await client.query(
      `insert into pipeline_runs (id, stage, status, metadata)
       values ($1, $2, 'running', $3::jsonb)`,
      [id, stage, JSON.stringify(metadata)]
    );
    return id;
  } finally {
    await client.end();
  }
}

export async function updatePipelineRunProgress(
  id: string,
  metadata: Record<string, unknown>
) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query(
      `update pipeline_runs
       set metadata = metadata || $2::jsonb
       where id = $1`,
      [id, JSON.stringify(metadata)]
    );
  } finally {
    await client.end();
  }
}

export async function finishPipelineRun(
  id: string,
  result: {
    status: "completed" | "failed";
    processedCount?: number;
    failedCount?: number;
    estimatedCostUsd?: number;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      `update pipeline_runs
       set status = $2,
           completed_at = now(),
           processed_count = $3,
           failed_count = $4,
           estimated_cost_usd = $5,
           error_message = $6,
           metadata = metadata || $7::jsonb
       where id = $1`,
      [
        id,
        result.status,
        result.processedCount ?? 0,
        result.failedCount ?? 0,
        result.estimatedCostUsd ?? null,
        result.errorMessage ?? null,
        JSON.stringify(result.metadata ?? {})
      ]
    );
  } finally {
    await client.end();
  }
}

export async function recordConnectorCheckpoint(input: {
  connectorId: string;
  success: boolean;
  documentsFetched?: number;
  documentsInserted?: number;
  lastDocumentAt?: string | null;
  error?: string;
  metadata?: Record<string, unknown>;
}) {
  const client = createDatabaseClient();
  await client.connect();

  try {
    await client.query(
      `insert into connector_checkpoints (
         connector_id, last_attempt_at, last_success_at, last_document_at,
         last_error, documents_fetched, documents_inserted, metadata, updated_at
       )
       values (
         $1, now(), case when $2 then now() else null end, $3,
         $4, $5, $6, $7::jsonb, now()
       )
       on conflict (connector_id) do update set
         last_attempt_at = now(),
         last_success_at = case
           when $2 then now()
           else connector_checkpoints.last_success_at
         end,
         last_document_at = coalesce($3, connector_checkpoints.last_document_at),
         last_error = $4,
         documents_fetched = connector_checkpoints.documents_fetched + $5,
         documents_inserted = connector_checkpoints.documents_inserted + $6,
         metadata = connector_checkpoints.metadata || $7::jsonb,
         updated_at = now()`,
      [
        input.connectorId,
        input.success,
        input.lastDocumentAt ?? null,
        input.error ?? null,
        input.documentsFetched ?? 0,
        input.documentsInserted ?? 0,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  } finally {
    await client.end();
  }
}

export async function listConnectorCheckpoints(
  databaseUrl = process.env.DATABASE_URL
): Promise<ConnectorCheckpointSummary[]> {
  if (!databaseUrl) return [];

  const client = createDatabaseClient(databaseUrl);
  try {
    await client.connect();
    const connectors = await client.query<{
      connector_id: string;
      last_attempt_at: string | null;
      last_success_at: string | null;
      last_document_at: string | null;
      last_error: string | null;
      documents_fetched: number;
      documents_inserted: number;
    }>(
      `select connector_id, last_attempt_at::text, last_success_at::text,
              last_document_at::text, last_error, documents_fetched, documents_inserted
       from connector_checkpoints
       order by connector_id`
    );
    return connectors.rows.map(mapConnectorCheckpoint);
  } catch (error) {
    console.warn(
      `[db] connector checkpoint query failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  } finally {
    await closeDatabaseClient(client);
  }
}

export async function getOperationsStatus(
  databaseUrl = process.env.DATABASE_URL,
  overrides: {
    analysisModel?: string;
    analysisPromptVersion?: string;
    classificationPromptVersion?: string;
    discoveryPromptVersion?: string;
    discoveryLookbackDays?: number;
    discoveryMaxAttempts?: number;
    analysisMaxAttempts?: number;
    candidateEvidenceWindowDays?: number;
  } = {}
): Promise<OperationsStatus> {
  if (!databaseUrl) {
    return emptyOperationsStatus();
  }

  const client = createDatabaseClient(databaseUrl);
  try {
    await client.connect();
    const analysisModel =
      overrides.analysisModel ??
      process.env.ANTHROPIC_MODEL ??
      "claude-haiku-4-5-20251001";
    const analysisPromptVersion =
      overrides.analysisPromptVersion ??
      process.env.CLAUDE_PROMPT_VERSION ??
      "market_signal_extraction_v2";
    const classificationPromptVersion =
      overrides.classificationPromptVersion ??
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
      "narrative_classification_v6";
    const discoveryPromptVersion =
      overrides.discoveryPromptVersion ??
      process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION ?? "narrative_discovery_v1";
    const discoveryLookbackDays =
      overrides.discoveryLookbackDays ??
      Number(process.env.NARRATIVE_DISCOVERY_LOOKBACK_DAYS ?? 30);
    const discoveryMaxAttempts =
      overrides.discoveryMaxAttempts ??
      Number(process.env.NARRATIVE_DISCOVERY_MAX_ATTEMPTS ?? 5);
    const analysisMaxAttempts =
      overrides.analysisMaxAttempts ??
      Number(process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5);
    const candidateEvidenceWindowDays =
      overrides.candidateEvidenceWindowDays ??
      Number(
        process.env.NARRATIVE_CANDIDATE_EVIDENCE_WINDOW_DAYS ??
          DEFAULT_CANDIDATE_EVIDENCE_WINDOW_DAYS
      );
    const counts = await client.query<{
        latest_document_at: string | null;
        total_documents: string;
        analyzed_documents: string;
        normalization_backlog: string;
        narrative_review_pending_count: string;
        narrative_candidate_pending_count: string;
        narrative_candidate_qualified_count: string;
        latest_trend_date: string | null;
        latest_narrative_trend_date: string | null;
      }>(
        `select
          (select max(published_at)::text from documents) as latest_document_at,
          (select count(*)::text from documents) as total_documents,
          (select count(distinct document_id)::text
             from document_analysis_runs
             where analysis_type = 'market_signal_extraction'
               and model = $1
               and prompt_version = $2
               and status = 'completed') as analyzed_documents,
          (select count(*)::text from themes t
             where t.theme_level = 'extracted'
               and not exists (
                 select 1 from theme_mappings tm where tm.extracted_theme_id = t.id
               )) as normalization_backlog,
          (select count(*)::text
             from narrative_observations
             where matched
               and review_status = 'pending'
               and prompt_version = $3) as narrative_review_pending_count,
          (select count(*)::text
             from narrative_candidates
             where status = 'pending'
               and prompt_version = $4) as narrative_candidate_pending_count,
          (select count(*)::text
             from (
               select nc.id
               from narrative_candidates nc
               join narrative_candidate_evidence ce on ce.candidate_id = nc.id
               join documents d on d.id = ce.document_id
               where nc.status = 'pending'
                 and nc.prompt_version = $4
                 and d.published_at >= now() - ($7::text || ' days')::interval
               group by nc.id
               having count(distinct ce.document_id) >= $5
                  and count(distinct coalesce(
                    nullif(d.publisher_owner, ''),
                    nullif(d.publisher_id, ''),
                    d.publisher
                  )) >= $6
             ) qualified) as narrative_candidate_qualified_count,
          (select max(date)::text from theme_trends) as latest_trend_date,
          (select max(date)::text
             from narrative_trends
             where prompt_version = $3) as latest_narrative_trend_date`,
        [
          analysisModel,
          analysisPromptVersion,
          classificationPromptVersion,
          discoveryPromptVersion,
          DEFAULT_CANDIDATE_MIN_DOCUMENTS,
          DEFAULT_CANDIDATE_MIN_PUBLISHER_OWNERS,
          candidateEvidenceWindowDays
        ]
      );
    const sourceTelemetryRows = await client.query<{
      source_id: string;
      source_class: SourceClass | null;
      label: string;
      enabled: boolean | null;
      document_count: string;
      latest_document_at: string | null;
      analyzed_documents: string;
      extraction_backlog: string;
      classification_backlog: string;
      discovery_backlog: string;
      matched_pending: string;
      matched_approved: string;
      matched_rejected: string;
      last_attempt_at: string | null;
      last_success_at: string | null;
      last_error: string | null;
    }>(
      `with source_ids as (
         select source_id from documents
         union
         select connector_id as source_id from connector_checkpoints
         union
         select id as source_id from publication_feeds
       ),
       document_stats as (
         select source_id,
                min(source_class) as source_class,
                count(*) as document_count,
                max(published_at) as latest_document_at
         from documents
         group by source_id
       ),
       extraction_stats as (
         select d.source_id,
                count(distinct d.id) filter (where ar.status = 'completed') as analyzed_documents,
                count(distinct d.id) filter (
                  where coalesce(ar.status, '') not in ('completed', 'running')
                    and coalesce(ar.attempt_count, 0) < $7
                )
                  as extraction_backlog
         from documents d
         join document_texts dt on dt.document_id = d.id
         left join document_analysis_runs ar
           on ar.document_id = d.id
          and ar.analysis_type = 'market_signal_extraction'
          and ar.model = $1
          and ar.prompt_version = $2
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and not (
             d.source_id = 'sec-filings'
             and coalesce(d.metadata->>'filingCategory', 'uncategorized') = 'capital_markets'
           )
         group by d.source_id
       ),
       classification_stats as (
         select d.source_id, count(distinct d.id) as classification_backlog
         from documents d
         join document_texts dt on dt.document_id = d.id
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and exists (
             select 1
             from narrative_definitions nd
             where nd.status = 'active'
               and not exists (
                 select 1
                 from narrative_observations no
                 where no.narrative_definition_id = nd.id
                   and no.document_id = d.id
                   and no.model = $1
                   and no.prompt_version = $3
               )
           )
         group by d.source_id
       ),
       discovery_stats as (
         select d.source_id,
                count(distinct d.id) filter (
                  where d.published_at >= now() - ($5::text || ' days')::interval
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
                ) as discovery_backlog
         from documents d
         join document_texts dt on dt.document_id = d.id
         left join document_analysis_runs ar
           on ar.document_id = d.id
          and ar.analysis_type = 'narrative_candidate_discovery'
          and ar.model = $1
          and ar.prompt_version = $4
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and length(btrim(dt.content)) > 0
         group by d.source_id
       ),
       match_stats as (
         select d.source_id,
                count(*) filter (where no.review_status = 'pending') as matched_pending,
                count(*) filter (where no.review_status = 'approved') as matched_approved,
                count(*) filter (where no.review_status = 'rejected') as matched_rejected
         from narrative_observations no
         join documents d on d.id = no.document_id
         where no.matched
           and no.model = $1
           and no.prompt_version = $3
         group by d.source_id
       )
       select s.source_id,
              ds.source_class,
              coalesce(pf.name, s.source_id) as label,
              pf.enabled,
              coalesce(ds.document_count, 0)::text as document_count,
              ds.latest_document_at::text,
              coalesce(es.analyzed_documents, 0)::text as analyzed_documents,
              coalesce(es.extraction_backlog, 0)::text as extraction_backlog,
              coalesce(cs.classification_backlog, 0)::text as classification_backlog,
              coalesce(dis.discovery_backlog, 0)::text as discovery_backlog,
              coalesce(ms.matched_pending, 0)::text as matched_pending,
              coalesce(ms.matched_approved, 0)::text as matched_approved,
              coalesce(ms.matched_rejected, 0)::text as matched_rejected,
              cc.last_attempt_at::text,
              cc.last_success_at::text,
              cc.last_error
       from source_ids s
       left join document_stats ds on ds.source_id = s.source_id
       left join extraction_stats es on es.source_id = s.source_id
       left join classification_stats cs on cs.source_id = s.source_id
       left join discovery_stats dis on dis.source_id = s.source_id
       left join match_stats ms on ms.source_id = s.source_id
       left join connector_checkpoints cc on cc.connector_id = s.source_id
       left join publication_feeds pf on pf.id = s.source_id
       order by coalesce(pf.name, s.source_id)`,
      [
        analysisModel,
        analysisPromptVersion,
        classificationPromptVersion,
        discoveryPromptVersion,
        discoveryLookbackDays,
        discoveryMaxAttempts,
        analysisMaxAttempts
      ]
    );
    const connectors = await client.query<{
        connector_id: string;
        last_attempt_at: string | null;
        last_success_at: string | null;
        last_document_at: string | null;
        last_error: string | null;
        documents_fetched: number;
        documents_inserted: number;
      }>(
        `select connector_id, last_attempt_at::text, last_success_at::text,
                last_document_at::text, last_error, documents_fetched, documents_inserted
         from connector_checkpoints
         order by connector_id`
      );
    const runs = await client.query<{
        id: string;
        stage: string;
        status: string;
        started_at: string;
        completed_at: string | null;
        processed_count: number;
        failed_count: number;
        estimated_cost_usd: number | null;
        error_message: string | null;
      }>(
        `select id, stage, status, started_at::text, completed_at::text,
                processed_count, failed_count, estimated_cost_usd::float, error_message
         from pipeline_runs
         order by started_at desc
         limit 20`
      );

    const row = counts.rows[0];
    const sourceTelemetry = sourceTelemetryRows.rows.map(mapSourceTelemetry);
    return {
      databaseConfigured: true,
      latestDocumentAt: row?.latest_document_at ?? null,
      totalDocuments: Number(row?.total_documents ?? 0),
      analyzedDocuments: Number(row?.analyzed_documents ?? 0),
      extractionBacklog: sumTelemetry(sourceTelemetry, "extractionBacklog"),
      normalizationBacklog: Number(row?.normalization_backlog ?? 0),
      narrativeClassificationBacklog: sumTelemetry(
        sourceTelemetry,
        "narrativeClassificationBacklog"
      ),
      narrativeDiscoveryBacklog: sumTelemetry(
        sourceTelemetry,
        "narrativeDiscoveryBacklog"
      ),
      narrativeReviewPendingCount: Number(
        row?.narrative_review_pending_count ?? 0
      ),
      narrativeCandidatePendingCount: Number(
        row?.narrative_candidate_pending_count ?? 0
      ),
      narrativeCandidateQualifiedCount: Number(
        row?.narrative_candidate_qualified_count ?? 0
      ),
      latestTrendDate: row?.latest_trend_date ?? null,
      latestNarrativeTrendDate: row?.latest_narrative_trend_date ?? null,
      connectors: connectors.rows.map(mapConnectorCheckpoint),
      sourceTelemetry,
      recentRuns: runs.rows.map((run) => ({
        id: run.id,
        stage: run.stage,
        status: run.status,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        processedCount: run.processed_count,
        failedCount: run.failed_count,
        estimatedCostUsd: run.estimated_cost_usd,
        errorMessage: run.error_message
      }))
    };
  } catch (error) {
    console.warn(
      `[db] operations status query failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      ...emptyOperationsStatus(),
      databaseConfigured: true
    };
  } finally {
    await closeDatabaseClient(client);
  }
}

function mapConnectorCheckpoint(connector: {
  connector_id: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_document_at: string | null;
  last_error: string | null;
  documents_fetched: number;
  documents_inserted: number;
}): ConnectorCheckpointSummary {
  return {
    connectorId: connector.connector_id,
    lastAttemptAt: connector.last_attempt_at,
    lastSuccessAt: connector.last_success_at,
    lastDocumentAt: connector.last_document_at,
    lastError: connector.last_error,
    documentsFetched: connector.documents_fetched,
    documentsInserted: connector.documents_inserted
  };
}

function mapSourceTelemetry(row: {
  source_id: string;
  source_class: SourceClass | null;
  label: string;
  enabled: boolean | null;
  document_count: string;
  latest_document_at: string | null;
  analyzed_documents: string;
  extraction_backlog: string;
  classification_backlog: string;
  discovery_backlog: string;
  matched_pending: string;
  matched_approved: string;
  matched_rejected: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}): SourcePipelineTelemetry {
  return {
    sourceId: row.source_id,
    sourceClass: row.source_class,
    label: row.label,
    enabled: row.enabled,
    documentCount: Number(row.document_count),
    latestDocumentAt: row.latest_document_at,
    analyzedDocuments: Number(row.analyzed_documents),
    extractionBacklog: Number(row.extraction_backlog),
    narrativeClassificationBacklog: Number(row.classification_backlog),
    narrativeDiscoveryBacklog: Number(row.discovery_backlog),
    matchedPending: Number(row.matched_pending),
    matchedApproved: Number(row.matched_approved),
    matchedRejected: Number(row.matched_rejected),
    lastIngestAttemptAt: row.last_attempt_at,
    lastIngestSuccessAt: row.last_success_at,
    lastIngestError: row.last_error
  };
}

function sumTelemetry(
  telemetry: SourcePipelineTelemetry[],
  field:
    | "extractionBacklog"
    | "narrativeClassificationBacklog"
    | "narrativeDiscoveryBacklog"
) {
  return telemetry.reduce((sum, row) => sum + row[field], 0);
}

function emptyOperationsStatus(): OperationsStatus {
  return {
    databaseConfigured: false,
    latestDocumentAt: null,
    totalDocuments: 0,
    analyzedDocuments: 0,
    extractionBacklog: 0,
    normalizationBacklog: 0,
    narrativeClassificationBacklog: 0,
    narrativeDiscoveryBacklog: 0,
    narrativeReviewPendingCount: 0,
    narrativeCandidatePendingCount: 0,
    narrativeCandidateQualifiedCount: 0,
    latestTrendDate: null,
    latestNarrativeTrendDate: null,
    connectors: [],
    sourceTelemetry: [],
    recentRuns: []
  };
}
