import { createHash, randomUUID } from "node:crypto";
import {
  providerBatchState,
  type AnthropicBatchApi,
  type AnthropicBatchRequest,
  type AnthropicBatchResult
} from "@market-themes/analysis";
import {
  closeDatabaseClient,
  createDatabaseClient,
  finishAnthropicMessageBatch,
  getActiveAnthropicMessageBatch,
  markAnthropicBatchSubmissionUnknown,
  markAnthropicBatchSubmitted,
  pruneAnthropicMessageBatches,
  reopenRecentIncompleteAnthropicBatch,
  updateAnthropicBatchProviderState,
  type AnthropicMessageBatchRecord
} from "@market-themes/db";

const BATCH_EXPIRATION_GRACE_MS = 25 * 60 * 60 * 1_000;
const RESULT_RETENTION_MS = 29 * 24 * 60 * 60 * 1_000;
const DEFAULT_MAX_BATCH_BYTES = 240 * 1024 * 1024;
const PROVIDER_MAX_BATCH_BYTES = 256 * 1024 * 1024;

type BatchRuntimeStore = {
  prune?(workload: string): Promise<unknown>;
  reopenIncomplete?(workload: string): Promise<unknown>;
  getActive(workload: string): Promise<AnthropicMessageBatchRecord | null>;
  markSubmitted(
    id: string,
    state: ReturnType<typeof providerBatchState>
  ): Promise<void>;
  markSubmissionUnknown(id: string, error: unknown): Promise<void>;
  updateProviderState(
    id: string,
    state: ReturnType<typeof providerBatchState>
  ): Promise<void>;
  finish(input: {
    id: string;
    status: "completed" | "failed";
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
};

const defaultStore: BatchRuntimeStore = {
  prune: (workload) => pruneAnthropicMessageBatches(workload),
  reopenIncomplete: (workload) =>
    reopenRecentIncompleteAnthropicBatch(workload),
  getActive: (workload) => getActiveAnthropicMessageBatch(workload),
  markSubmitted: (id, state) => markAnthropicBatchSubmitted(id, state),
  markSubmissionUnknown: (id, error) =>
    markAnthropicBatchSubmissionUnknown(id, error),
  updateProviderState: (id, state) =>
    updateAnthropicBatchProviderState(id, state),
  finish: (input) => finishAnthropicMessageBatch(input)
};

export function newAnthropicBatchId(workload: string) {
  return `anthropic-batch:${workload}:${randomUUID()}`;
}

export function anthropicBatchCustomId(
  prefix: string,
  index: number,
  stableValue: string
) {
  const digest = createHash("sha256")
    .update(stableValue)
    .digest("hex")
    .slice(0, 20);
  const customId = `${prefix}-${index + 1}-${digest}`;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(customId)) {
    throw new Error(`Invalid Anthropic batch custom_id: ${customId}`);
  }
  return customId;
}

export function assertAnthropicBatchRequestLimits(
  requests: AnthropicBatchRequest[],
  configuredMaxBytes?: number
) {
  const requestedLimit =
    configuredMaxBytes ??
    Number(
      process.env.ANTHROPIC_BATCH_MAX_BYTES ?? DEFAULT_MAX_BATCH_BYTES
    );
  const maxBytes =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, PROVIDER_MAX_BATCH_BYTES)
      : DEFAULT_MAX_BATCH_BYTES;
  if (requests.length < 1 || requests.length > 100_000) {
    throw new Error(
      `Anthropic batches require 1-100000 requests; received ${requests.length}.`
    );
  }
  const requestBytes = Buffer.byteLength(JSON.stringify({ requests }));
  if (requestBytes > maxBytes) {
    throw new Error(
      `Anthropic batch request is ${requestBytes} bytes; limit is ${maxBytes}.`
    );
  }
  return requestBytes;
}

export async function submitPersistedAnthropicBatch(options: {
  batch: AnthropicMessageBatchRecord;
  requests: AnthropicBatchRequest[];
  api: AnthropicBatchApi;
  abandon: (
    batch: AnthropicMessageBatchRecord,
    error: unknown
  ) => Promise<void>;
  store?: BatchRuntimeStore;
}) {
  const store = options.store ?? defaultStore;
  const requestBytes = assertAnthropicBatchRequestLimits(options.requests);
  let providerBatch;
  try {
    providerBatch = await options.api.create(options.requests);
  } catch (error) {
    if (isDefinitiveSubmissionRejection(error)) {
      await options.abandon(options.batch, error);
      await store.finish({
        id: options.batch.id,
        status: "failed",
        errorMessage: errorMessage(error),
        metadata: { requestBytes, submissionRejected: true }
      });
      return { status: "failed" as const, requestBytes };
    }
    await store.markSubmissionUnknown(options.batch.id, error);
    return { status: "submission_unknown" as const, requestBytes };
  }
  await store.markSubmitted(
    options.batch.id,
    providerBatchState(providerBatch)
  );
  return {
    status: "submitted" as const,
    providerBatchId: providerBatch.id,
    requestBytes
  };
}

export async function reconcileActiveAnthropicBatch(options: {
  workload: string;
  api: AnthropicBatchApi;
  processResults: (
    batch: AnthropicMessageBatchRecord,
    results: AsyncIterable<AnthropicBatchResult>
  ) => Promise<Record<string, unknown>>;
  abandon: (
    batch: AnthropicMessageBatchRecord,
    error: unknown
  ) => Promise<void>;
  store?: BatchRuntimeStore;
  now?: () => number;
}) {
  const store = options.store ?? defaultStore;
  const now = options.now ?? Date.now;
  await store.prune?.(options.workload);
  await store.reopenIncomplete?.(options.workload);
  const batch = await store.getActive(options.workload);
  if (!batch) return { status: "none" as const };

  const ageMs = now() - new Date(batch.createdAt).getTime();
  if (!batch.providerBatchId) {
    if (ageMs < BATCH_EXPIRATION_GRACE_MS) {
      return {
        status: "submission_unknown" as const,
        batchId: batch.id
      };
    }
    const error = new Error(
      "Batch submission outcome remained unknown beyond the provider's 24-hour processing window."
    );
    await options.abandon(batch, error);
    await store.finish({
      id: batch.id,
      status: "failed",
      errorMessage: error.message,
      metadata: { abandonedAfterUnknownSubmission: true }
    });
    return { status: "failed" as const, batchId: batch.id };
  }

  const providerBatch = await options.api.retrieve(batch.providerBatchId);
  await store.updateProviderState(
    batch.id,
    providerBatchState(providerBatch)
  );
  if (providerBatch.processing_status !== "ended") {
    return {
      status: providerBatch.processing_status,
      batchId: batch.id,
      providerBatchId: providerBatch.id
    };
  }

  try {
    const results = await options.api.results(batch.providerBatchId);
    const completeResults = await collectCompleteAnthropicBatchResults(
      batch,
      results
    );
    const summary = await options.processResults(
      batch,
      toAsyncIterable(completeResults)
    );
    await store.finish({
      id: batch.id,
      status: "completed",
      metadata: { resultSummary: summary }
    });
    return {
      status: "completed" as const,
      batchId: batch.id,
      providerBatchId: providerBatch.id,
      summary
    };
  } catch (error) {
    if (ageMs < RESULT_RETENTION_MS) throw error;
    await options.abandon(batch, error);
    await store.finish({
      id: batch.id,
      status: "failed",
      errorMessage: errorMessage(error),
      metadata: { resultsExpired: true }
    });
    return { status: "failed" as const, batchId: batch.id };
  }
}

export async function collectCompleteAnthropicBatchResults(
  batch: AnthropicMessageBatchRecord,
  results: AsyncIterable<AnthropicBatchResult>
) {
  const expectedIds = new Set(batch.items.map((item) => item.customId));
  if (expectedIds.size !== batch.requestCount) {
    throw new Error(
      `Persisted Anthropic batch manifest has ${expectedIds.size} items but expected ${batch.requestCount}.`
    );
  }
  const received = new Map<string, AnthropicBatchResult>();
  for await (const result of results) {
    if (!expectedIds.has(result.custom_id)) {
      throw new Error(
        `Anthropic batch returned unknown custom_id ${result.custom_id}.`
      );
    }
    if (received.has(result.custom_id)) {
      throw new Error(
        `Anthropic batch returned duplicate custom_id ${result.custom_id}.`
      );
    }
    received.set(result.custom_id, result);
  }
  if (received.size !== expectedIds.size) {
    const missing = [...expectedIds].filter((id) => !received.has(id));
    throw new Error(
      `Anthropic batch results are incomplete: received ${received.size}/${expectedIds.size}; missing ${missing.slice(0, 5).join(", ")}.`
    );
  }
  return [...received.values()];
}

async function* toAsyncIterable<T>(items: T[]) {
  for (const item of items) yield item;
}

export async function withAnthropicBatchAdvisoryLock<T>(
  lockName: string,
  operation: () => Promise<T>
): Promise<T | null> {
  const client = createDatabaseClient();
  await client.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as acquired",
      [lockName]
    );
    acquired = lock.rows[0]?.acquired === true;
    return acquired ? operation() : null;
  } finally {
    if (acquired) {
      await client
        .query("select pg_advisory_unlock(hashtext($1))", [lockName])
        .catch(() => undefined);
    }
    await closeDatabaseClient(client);
  }
}

function isDefinitiveSubmissionRejection(error: unknown) {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : null;
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 429].includes(status)
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
