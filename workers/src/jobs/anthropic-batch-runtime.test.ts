import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnthropicBatchApi,
  AnthropicBatchProviderRecord,
  AnthropicBatchRequest,
  AnthropicBatchResult
} from "@market-themes/analysis";
import type { AnthropicMessageBatchRecord } from "@market-themes/db";
import {
  anthropicBatchCustomId,
  assertAnthropicBatchRequestLimits,
  mergeBatchSummaries,
  reconcileActiveAnthropicBatch,
  resolveMaxActiveBatches,
  submitPersistedAnthropicBatch
} from "./anthropic-batch-runtime";

const request: AnthropicBatchRequest = {
  custom_id: "request-1",
  params: {
    model: "test-model",
    max_tokens: 10,
    messages: [{ role: "user", content: "test" }]
  }
};

const canceledResult = {
  custom_id: "request-1",
  result: { type: "canceled" }
} as AnthropicBatchResult;

test("builds valid stable custom ids and enforces request bytes", () => {
  const customId = anthropicBatchCustomId(
    "classification",
    0,
    "document:1"
  );
  assert.match(customId, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(
    customId,
    anthropicBatchCustomId("classification", 0, "document:1")
  );
  assert.throws(
    () => assertAnthropicBatchRequestLimits([request], 1),
    /limit is 1/
  );
});

test("persists a successful provider submission", async () => {
  const events: string[] = [];
  const store = fakeStore(events);
  const result = await submitPersistedAnthropicBatch({
    batch: batchRecord(),
    requests: [request],
    api: fakeApi(providerBatch("in_progress")),
    abandon: async () => {
      events.push("abandon");
    },
    store
  });

  assert.equal(result.status, "submitted");
  assert.deepEqual(events, ["submitted"]);
});

test("holds ambiguous submissions but releases definitive rejections", async () => {
  const ambiguousEvents: string[] = [];
  const ambiguous = await submitPersistedAnthropicBatch({
    batch: batchRecord(),
    requests: [request],
    api: fakeApi(providerBatch("in_progress"), new Error("connection lost")),
    abandon: async () => {
      ambiguousEvents.push("abandon");
    },
    store: fakeStore(ambiguousEvents)
  });
  assert.equal(ambiguous.status, "submission_unknown");
  assert.deepEqual(ambiguousEvents, ["unknown"]);

  const rejectedEvents: string[] = [];
  const rejection = Object.assign(new Error("invalid request"), {
    status: 400
  });
  const rejected = await submitPersistedAnthropicBatch({
    batch: batchRecord(),
    requests: [request],
    api: fakeApi(providerBatch("in_progress"), rejection),
    abandon: async () => {
      rejectedEvents.push("abandon");
    },
    store: fakeStore(rejectedEvents)
  });
  assert.equal(rejected.status, "failed");
  assert.deepEqual(rejectedEvents, ["abandon", "finish:failed"]);
});

test("reconciles terminal results exactly once before completion", async () => {
  const events: string[] = [];
  const store = fakeStore(events, batchRecord({ providerBatchId: "batch-1" }));
  const result = await reconcileActiveAnthropicBatch({
    workload: "classification",
    api: fakeApi(providerBatch("ended"), undefined, [canceledResult]),
    processResults: async (_batch, results) => {
      for await (const entry of results) {
        events.push(`result:${entry.custom_id}`);
      }
      return { processed: 1 };
    },
    abandon: async () => {
      events.push("abandon");
    },
    store
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(events, [
    "provider:ended",
    "result:request-1",
    "finish:completed"
  ]);
});

test("updates in-progress provider state without reading results", async () => {
  const events: string[] = [];
  const result = await reconcileActiveAnthropicBatch({
    workload: "classification",
    api: fakeApi(providerBatch("in_progress")),
    processResults: async () => {
      events.push("results");
      return {};
    },
    abandon: async () => {
      events.push("abandon");
    },
    store: fakeStore(
      events,
      batchRecord({ providerBatchId: "batch-1", status: "in_progress" })
    )
  });

  assert.equal(result.status, "in_progress");
  assert.deepEqual(events, ["provider:in_progress"]);
});

test("leaves terminal results recoverable when application processing fails", async () => {
  const events: string[] = [];
  const store = fakeStore(
    events,
    batchRecord({ providerBatchId: "batch-1" })
  );

  await assert.rejects(
    reconcileActiveAnthropicBatch({
      workload: "classification",
      api: fakeApi(providerBatch("ended"), undefined, [canceledResult]),
      processResults: async () => {
        throw new Error("database unavailable");
      },
      abandon: async () => {
        events.push("abandon");
      },
      store,
      now: () => new Date("2026-09-01T00:20:00.000Z").getTime()
    }),
    /database unavailable/
  );
  assert.deepEqual(events, ["provider:ended"]);
});

test("leaves empty and partial result streams retryable without applying them", async () => {
  const emptyEvents: string[] = [];
  await assert.rejects(
    reconcileActiveAnthropicBatch({
      workload: "classification",
      api: fakeApi(providerBatch("ended")),
      processResults: async () => {
        emptyEvents.push("applied");
        return {};
      },
      abandon: async () => {
        emptyEvents.push("abandon");
      },
      store: fakeStore(
        emptyEvents,
        batchRecord({ providerBatchId: "batch-1" })
      ),
      now: () => new Date("2026-09-01T00:20:00.000Z").getTime()
    }),
    /results are incomplete: received 0\/1/
  );
  assert.deepEqual(emptyEvents, ["provider:ended"]);

  const partialEvents: string[] = [];
  const twoItemBatch = batchRecord({
    providerBatchId: "batch-1",
    requestCount: 2,
    items: [batchItem("request-1"), batchItem("request-2")]
  });
  await assert.rejects(
    reconcileActiveAnthropicBatch({
      workload: "classification",
      api: fakeApi(providerBatch("ended"), undefined, [canceledResult]),
      processResults: async () => {
        partialEvents.push("applied");
        return {};
      },
      abandon: async () => {
        partialEvents.push("abandon");
      },
      store: fakeStore(partialEvents, twoItemBatch),
      now: () => new Date("2026-09-01T00:20:00.000Z").getTime()
    }),
    /results are incomplete: received 1\/2/
  );
  assert.deepEqual(partialEvents, ["provider:ended"]);
});

test("waits through the provider window before abandoning unknown submissions", async () => {
  const recentEvents: string[] = [];
  const recent = batchRecord({
    createdAt: "2026-09-01T00:00:00.000Z",
    status: "submission_unknown"
  });
  const waiting = await reconcileActiveAnthropicBatch({
    workload: "classification",
    api: fakeApi(providerBatch("in_progress")),
    processResults: async () => ({}),
    abandon: async () => {
      recentEvents.push("abandon");
    },
    store: fakeStore(recentEvents, recent),
    now: () => new Date("2026-09-02T00:00:00.000Z").getTime()
  });
  assert.equal(waiting.status, "submission_unknown");
  assert.deepEqual(recentEvents, []);

  const staleEvents: string[] = [];
  const stale = await reconcileActiveAnthropicBatch({
    workload: "classification",
    api: fakeApi(providerBatch("in_progress")),
    processResults: async () => ({}),
    abandon: async () => {
      staleEvents.push("abandon");
    },
    store: fakeStore(staleEvents, recent),
    now: () => new Date("2026-09-02T02:00:00.000Z").getTime()
  });
  assert.equal(stale.status, "failed");
  assert.deepEqual(staleEvents, ["abandon", "finish:failed"]);
});

test("a workload below its in-flight limit reports capacity while a slow batch is still processing", async () => {
  const events: string[] = [];
  const slow = batchRecord({ id: "slow", providerBatchId: "batch-slow", status: "in_progress" });
  const store = { ...fakeStore(events), listActive: async () => [slow] };
  const api: AnthropicBatchApi = {
    create: async () => providerBatch("in_progress"),
    retrieve: async () => ({ ...providerBatch("in_progress"), id: "batch-slow" }),
    results: async () => asyncIterable([])
  };
  const options = {
    workload: "classification",
    api,
    processResults: async () => ({}),
    abandon: async () => undefined,
    store
  };

  const single = await reconcileActiveAnthropicBatch({ ...options, maxActive: 1 });
  assert.equal(single.status, "in_progress", "at the limit the caller must wait");
  assert.equal(single.activeBatches, 1);

  const concurrent = await reconcileActiveAnthropicBatch({ ...options, maxActive: 3 });
  assert.equal(concurrent.status, "none", "below the limit the caller may submit another batch");
  assert.equal(concurrent.activeBatches, 1);
});

test("reconciling several active batches applies every completed one and merges summaries", async () => {
  const events: string[] = [];
  const done1 = batchRecord({ id: "done-1", providerBatchId: "ended-1", items: [batchItem("a")] });
  const done2 = batchRecord({ id: "done-2", providerBatchId: "ended-2", items: [batchItem("b")] });
  const busy = batchRecord({ id: "busy", providerBatchId: "busy-1", status: "in_progress" });
  const store = { ...fakeStore(events), listActive: async () => [done1, done2, busy] };
  const api: AnthropicBatchApi = {
    create: async () => providerBatch("ended"),
    retrieve: async (id: string) => ({
      ...providerBatch(id.startsWith("ended") ? "ended" : "in_progress"),
      id
    }),
    results: async (id: string) =>
      asyncIterable([{ ...canceledResult, custom_id: id === "ended-1" ? "a" : "b" }])
  };
  const result = await reconcileActiveAnthropicBatch({
    workload: "classification",
    api,
    processResults: async (batch) => {
      events.push(`processed:${batch.id}`);
      return { documentsProcessed: 1, tokenUsage: { inputTokens: 10 } };
    },
    abandon: async () => undefined,
    store,
    maxActive: 3
  });

  assert.equal(result.status, "completed");
  assert.equal(result.activeBatches, 1);
  assert.deepEqual(result.summary, { documentsProcessed: 2, tokenUsage: { inputTokens: 20 } });
  assert.deepEqual(
    events.filter((event) => event.startsWith("processed:")),
    ["processed:done-1", "processed:done-2"]
  );
});

test("max active batches defaults to one and parses the environment", () => {
  assert.equal(resolveMaxActiveBatches(undefined), 1);
  assert.equal(resolveMaxActiveBatches("3"), 3);
  assert.equal(resolveMaxActiveBatches("0"), 1);
  assert.equal(resolveMaxActiveBatches("abc"), 1);
  assert.deepEqual(
    mergeBatchSummaries([{ a: 1, label: "x", nested: { b: 2 } }, { a: 2, label: "y", nested: { b: 3, c: 1 } }]),
    { a: 3, label: "y", nested: { b: 5, c: 1 } }
  );
});

function fakeApi(
  batch: AnthropicBatchProviderRecord,
  createError?: Error,
  results: AnthropicBatchResult[] = []
): AnthropicBatchApi {
  return {
    create: async () => {
      if (createError) throw createError;
      return batch;
    },
    retrieve: async () => batch,
    results: async () => asyncIterable(results)
  };
}

function providerBatch(
  processingStatus: "in_progress" | "canceling" | "ended"
): AnthropicBatchProviderRecord {
  return {
    id: "batch-1",
    type: "message_batch",
    processing_status: processingStatus,
    request_counts: {
      processing: processingStatus === "ended" ? 0 : 1,
      succeeded: 0,
      errored: 0,
      canceled: processingStatus === "ended" ? 1 : 0,
      expired: 0
    },
    ended_at:
      processingStatus === "ended"
        ? "2026-09-01T00:10:00.000Z"
        : null,
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-09-02T00:00:00.000Z",
    archived_at: null,
    cancel_initiated_at: null,
    results_url:
      processingStatus === "ended"
        ? "https://api.example.test/results"
        : null
  };
}

function batchRecord(
  overrides: Partial<AnthropicMessageBatchRecord> = {}
): AnthropicMessageBatchRecord {
  return {
    id: "local-batch-1",
    providerBatchId: null,
    workload: "classification",
    model: "test-model",
    promptVersion: "test-prompt",
    status: "submitting",
    requestCount: 1,
    processingCount: 1,
    succeededCount: 0,
    erroredCount: 0,
    canceledCount: 0,
    expiredCount: 0,
    errorMessage: null,
    metadata: {},
    submittedAt: null,
    providerExpiresAt: null,
    providerEndedAt: null,
    resultsUrl: null,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    items: [batchItem("request-1")],
    ...overrides
  };
}

function batchItem(customId: string) {
  return {
    id: `item-${customId}`,
    batchId: "local-batch-1",
    customId,
    documentId: `document-${customId}`,
    analysisRunId: null,
    status: "submitted",
    errorType: null,
    errorMessage: null,
    usage: {},
    metadata: {},
    completedAt: null
  };
}

function fakeStore(
  events: string[],
  active: AnthropicMessageBatchRecord | null = null
) {
  return {
    getActive: async () => active,
    markSubmitted: async () => {
      events.push("submitted");
    },
    markSubmissionUnknown: async () => {
      events.push("unknown");
    },
    updateProviderState: async (
      _id: string,
      state: { processingStatus: string }
    ) => {
      events.push(`provider:${state.processingStatus}`);
    },
    finish: async ({ status }: { status: string }) => {
      events.push(`finish:${status}`);
    }
  };
}

async function* asyncIterable<T>(items: T[]) {
  for (const item of items) yield item;
}
