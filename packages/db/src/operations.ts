import { randomUUID } from "node:crypto";
import { closeDatabaseClient, createDatabaseClient } from "./persistence";
import type { ConnectorCheckpointSummary, OperationsStatus } from "./types";

export async function startPipelineRun(stage: string, metadata: Record<string, unknown> = {}) {
  const client = createDatabaseClient();
  const id = `pipeline:${stage}:${randomUUID()}`;
  await client.connect();

  try {
    await client.query(
      `update pipeline_runs
       set status = 'failed',
           completed_at = now(),
           error_message = 'Superseded by a new pipeline run after the prior process stopped.'
       where stage = $1 and status = 'running'`,
      [stage]
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
  databaseUrl = process.env.DATABASE_URL
): Promise<OperationsStatus> {
  if (!databaseUrl) {
    return emptyOperationsStatus();
  }

  const client = createDatabaseClient(databaseUrl);
  try {
    await client.connect();
    const counts = await client.query<{
        latest_document_at: string | null;
        total_documents: string;
        analyzed_documents: string;
        extraction_backlog: string;
        normalization_backlog: string;
        latest_trend_date: string | null;
        latest_narrative_trend_date: string | null;
      }>(
        `select
          (select max(published_at)::text from documents) as latest_document_at,
          (select count(*)::text from documents) as total_documents,
          (select count(distinct document_id)::text from document_analysis_runs where status = 'completed') as analyzed_documents,
          (select count(*)::text from documents d
             join document_texts dt on dt.document_id = d.id
             where not exists (
               select 1 from document_analysis_runs dar
               where dar.document_id = d.id and dar.status = 'completed'
             )) as extraction_backlog,
          (select count(*)::text from themes t
             where t.theme_level = 'extracted'
               and not exists (
                 select 1 from theme_mappings tm where tm.extracted_theme_id = t.id
               )) as normalization_backlog,
          (select max(date)::text from theme_trends) as latest_trend_date,
          (select max(date)::text from narrative_trends) as latest_narrative_trend_date`
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
    return {
      databaseConfigured: true,
      latestDocumentAt: row?.latest_document_at ?? null,
      totalDocuments: Number(row?.total_documents ?? 0),
      analyzedDocuments: Number(row?.analyzed_documents ?? 0),
      extractionBacklog: Number(row?.extraction_backlog ?? 0),
      normalizationBacklog: Number(row?.normalization_backlog ?? 0),
      latestTrendDate: row?.latest_trend_date ?? null,
      latestNarrativeTrendDate: row?.latest_narrative_trend_date ?? null,
      connectors: connectors.rows.map(mapConnectorCheckpoint),
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

function emptyOperationsStatus(): OperationsStatus {
  return {
    databaseConfigured: false,
    latestDocumentAt: null,
    totalDocuments: 0,
    analyzedDocuments: 0,
    extractionBacklog: 0,
    normalizationBacklog: 0,
    latestTrendDate: null,
    latestNarrativeTrendDate: null,
    connectors: [],
    recentRuns: []
  };
}
