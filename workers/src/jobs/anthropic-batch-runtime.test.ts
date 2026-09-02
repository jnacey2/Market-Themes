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
  reconcileActiveAnthropicBatch,
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
