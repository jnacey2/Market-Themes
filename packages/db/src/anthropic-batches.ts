import { createDatabaseClient } from "./persistence";
import type {
  AnalysisDocument,
  AnthropicMessageBatchItem,
  AnthropicMessageBatchRecord,
  AnthropicMessageBatchStatus
} from "./types";

type BatchItemInput = {
  customId: string;
  documentId: string;
  analysisRunId?: string | null;
  metadata?: Record<string, unknown>;
};

type ProviderBatchState = {
  id: string;
  processingStatus: "in_progress" | "canceling" | "ended";
  processingCount: number;
  succeededCount: number;
  erroredCount: number;
  canceledCount: number;
  expiredCount: number;
  expiresAt: string;
  endedAt?: string | null;
  resultsUrl: string | null;
};

type BatchRow = {
  id: string;
  provider_batch_id: string | null;
  workload: string;
  model: string;
  prompt_version: string;
  status: AnthropicMessageBatchStatus;
  request_count: number;
  processing_count: number;
  succeeded_count: number;
  errored_count: number;
  canceled_count: number;
  expired_count: number;
  error_message: string | null;
  metadata: Record<string, unknown>;
  submitted_at: string | null;
  provider_expires_at: string | null;
  provider_ended_at: string | null;
  results_url: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type BatchItemRow = {
  id: string;
  batch_id: string;
  custom_id: string;
  document_id: string;
  analysis_run_id: string | null;
  status: string;
  error_type: string | null;
  error_message: string | null;
  usage: Record<string, unknown>;
  metadata: Record<string, unknown>;
  completed_at: string | null;
};

const activeStatuses: AnthropicMessageBatchStatus[] = [
  "submitting",
  "submission_unknown",
  "in_progress",
  "canceling",
  "processing_results"
];

const batchSelectColumns = `
  id, provider_batch_id, workload, model, prompt_version, status,
  request_count, processing_count, succeeded_count, errored_count,
  canceled_count, expired_count, error_message, metadata,
  submitted_at::text as submitted_at,
  provider_expires_at::text as provider_expires_at,
  provider_ended_at::text as provider_ended_at,
  results_url,
  completed_at::text as completed_at,
  created_at::text as created_at,
  updated_at::text as updated_at
`;

export async function createAnthropicMessageBatch(
  input: {
    id: string;
    workload: string;
    model: string;
    promptVersion: string;
    metadata?: Record<string, unknown>;
    items: BatchItemInput[];
  },
  databaseUrl = process.env.DATABASE_URL
) {
  if (input.items.length === 0) {
    throw new Error("An Anthropic message batch requires at least one item.");
  }
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into anthropic_message_batches (
         id, workload, model, prompt_version, status, request_count, metadata
       ) values ($1, $2, $3, $4, 'submitting', $5, $6::jsonb)`,
      [
        input.id,
        input.workload,
        input.model,
        input.promptVersion,
        input.items.length,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    for (const [index, item] of input.items.entries()) {
      await client.query(
        `insert into anthropic_message_batch_items (
           id, batch_id, custom_id, document_id, analysis_run_id, metadata
         ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          `${input.id}:item:${index + 1}`,
          input.id,
          item.customId,
          item.documentId,
          item.analysisRunId ?? null,
          JSON.stringify(item.metadata ?? {})
        ]
      );
    }
    await client.query("commit");
    return getAnthropicMessageBatch(input.id, databaseUrl);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getActiveAnthropicMessageBatch(
  workload: string,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<BatchRow>(
      `select ${batchSelectColumns}
       from anthropic_message_batches
       where workload = $1
         and status = any($2::text[])
       order by created_at
       limit 1`,
      [workload, activeStatuses]
    );
    if (!result.rows[0]) return null;
    return await loadBatchRecord(client, result.rows[0]);
  } finally {
    await client.end();
  }
}

export async function getAnthropicMessageBatch(
  id: string,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<BatchRow>(
      `select ${batchSelectColumns}
       from anthropic_message_batches
       where id = $1`,
      [id]
    );
    if (!result.rows[0]) return null;
    return await loadBatchRecord(client, result.rows[0]);
  } finally {
    await client.end();
  }
}

export async function markAnthropicBatchSubmitted(
  id: string,
  state: ProviderBatchState,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query(
      `update anthropic_message_batches
       set provider_batch_id = $2,
           status = $3,
           processing_count = $4,
           succeeded_count = $5,
           errored_count = $6,
           canceled_count = $7,
           expired_count = $8,
           submitted_at = coalesce(submitted_at, now()),
           provider_expires_at = $9::timestamptz,
           provider_ended_at = $10::timestamptz,
           results_url = $11,
           error_message = null,
           updated_at = now()
       where id = $1`,
      [
        id,
        state.id,
        localStatus(state.processingStatus),
        state.processingCount,
        state.succeededCount,
        state.erroredCount,
        state.canceledCount,
        state.expiredCount,
        state.expiresAt,
        state.endedAt ?? null,
        state.resultsUrl
      ]
    );
  } finally {
    await client.end();
  }
}

export async function markAnthropicBatchSubmissionUnknown(
  id: string,
  error: unknown,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query(
      `update anthropic_message_batches
       set status = 'submission_unknown',
           error_message = $2,
           updated_at = now()
       where id = $1
         and status = 'submitting'`,
      [id, errorMessage(error)]
    );
  } finally {
    await client.end();
  }
}

export async function updateAnthropicBatchProviderState(
  id: string,
  state: ProviderBatchState,
  databaseUrl = process.env.DATABASE_URL
) {
  return markAnthropicBatchSubmitted(id, state, databaseUrl);
}

export async function recordAnthropicBatchItemResult(
  input: {
    batchId: string;
    customId: string;
    status: string;
    errorType?: string | null;
    errorMessage?: string | null;
    usage?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query(
      `update anthropic_message_batch_items
       set status = $3,
           error_type = $4,
           error_message = $5,
           usage = $6::jsonb,
           metadata = metadata || $7::jsonb,
           completed_at = now(),
           updated_at = now()
       where batch_id = $1
         and custom_id = $2`,
      [
        input.batchId,
        input.customId,
        input.status,
        input.errorType ?? null,
        input.errorMessage ?? null,
        JSON.stringify(input.usage ?? {}),
        JSON.stringify(input.metadata ?? {})
      ]
    );
    if ((result.rowCount ?? 0) !== 1) {
      throw new Error(`Unknown Anthropic batch item ${input.customId}.`);
    }
  } finally {
    await client.end();
  }
}

export async function finishAnthropicMessageBatch(
  input: {
    id: string;
    status: Extract<AnthropicMessageBatchStatus, "completed" | "failed">;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query(
      `update anthropic_message_batches
       set status = $2,
           error_message = $3,
           metadata = metadata || $4::jsonb,
           completed_at = now(),
           updated_at = now()
       where id = $1`,
      [
        input.id,
        input.status,
        input.errorMessage ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  } finally {
    await client.end();
  }
}

export async function pruneAnthropicMessageBatches(
  workload: string,
  retentionDays = Number(
    process.env.ANTHROPIC_BATCH_RETENTION_DAYS ?? 35
  ),
  databaseUrl = process.env.DATABASE_URL
) {
  const days =
    Number.isFinite(retentionDays) && retentionDays >= 30
      ? Math.floor(retentionDays)
      : 35;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query(
      `delete from anthropic_message_batches
       where workload = $1
         and status in ('completed', 'failed')
         and completed_at < now() - ($2::text || ' days')::interval`,
      [workload, days]
    );
    return { deletedBatches: result.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

export async function reopenRecentIncompleteAnthropicBatch(
  workload: string,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const candidate = await client.query<{ id: string }>(
      `select b.id
       from anthropic_message_batches b
       where b.workload = $1
         and b.status = 'completed'
         and b.provider_batch_id is not null
         and b.created_at >= now() - interval '29 days'
         and exists (
           select 1
           from anthropic_message_batch_items i
           where i.batch_id = b.id
         )
         and not exists (
           select 1
           from anthropic_message_batch_items i
           where i.batch_id = b.id
             and i.status <> 'missing'
         )
         and not exists (
           select 1
           from anthropic_message_batches active
           where active.workload = b.workload
             and active.status in (
               'submitting',
               'submission_unknown',
               'in_progress',
               'canceling',
               'processing_results'
             )
         )
       order by b.created_at desc
       limit 1
       for update skip locked`,
      [workload]
    );
    const batchId = candidate.rows[0]?.id;
    if (!batchId) {
      await client.query("commit");
      return { reopened: false, batchId: null };
    }
    await client.query(
      `update anthropic_message_batches
       set status = 'processing_results',
           completed_at = null,
           error_message = null,
           metadata = metadata || jsonb_build_object(
             'resultRecovery',
             jsonb_build_object(
               'reason', 'Previously completed with an empty or incomplete provider result stream.',
               'reopenedAt', now()
             )
           ),
           updated_at = now()
       where id = $1`,
      [batchId]
    );
    await client.query(
      `update anthropic_message_batch_items
       set status = 'submitted',
           error_type = null,
           error_message = null,
           completed_at = null,
           updated_at = now()
       where batch_id = $1
         and status = 'missing'`,
      [batchId]
    );
    await client.query("commit");
    return { reopened: true, batchId };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getAnalysisDocumentsByIds(
  documentIds: string[],
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  if (documentIds.length === 0) return [];
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      id: string;
      source_id: string;
      source_class: AnalysisDocument["sourceClass"];
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
              dt.content, dt.content_hash as text_hash
       from documents d
       join document_texts dt on dt.document_id = d.id
       where d.id = any($1::text[])`,
      [documentIds]
    );
    return result.rows.map((row) => ({
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

async function loadBatchRecord(
  client: ReturnType<typeof createDatabaseClient>,
  row: BatchRow
): Promise<AnthropicMessageBatchRecord> {
  const items = await client.query<BatchItemRow>(
    `select id, batch_id, custom_id, document_id, analysis_run_id,
            status, error_type, error_message, usage, metadata,
            completed_at::text as completed_at
     from anthropic_message_batch_items
     where batch_id = $1
     order by created_at, id`,
    [row.id]
  );
  return {
    id: row.id,
    providerBatchId: row.provider_batch_id,
    workload: row.workload,
    model: row.model,
    promptVersion: row.prompt_version,
    status: row.status,
    requestCount: row.request_count,
    processingCount: row.processing_count,
    succeededCount: row.succeeded_count,
    erroredCount: row.errored_count,
    canceledCount: row.canceled_count,
    expiredCount: row.expired_count,
    errorMessage: row.error_message,
    metadata: row.metadata,
    submittedAt: row.submitted_at,
    providerExpiresAt: row.provider_expires_at,
    providerEndedAt: row.provider_ended_at,
    resultsUrl: row.results_url,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.rows.map(mapBatchItem)
  };
}

function mapBatchItem(row: BatchItemRow): AnthropicMessageBatchItem {
  return {
    id: row.id,
    batchId: row.batch_id,
    customId: row.custom_id,
    documentId: row.document_id,
    analysisRunId: row.analysis_run_id,
    status: row.status,
    errorType: row.error_type,
    errorMessage: row.error_message,
    usage: row.usage,
    metadata: row.metadata,
    completedAt: row.completed_at
  };
}

function localStatus(
  status: ProviderBatchState["processingStatus"]
): AnthropicMessageBatchStatus {
  if (status === "ended") return "processing_results";
  return status;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
