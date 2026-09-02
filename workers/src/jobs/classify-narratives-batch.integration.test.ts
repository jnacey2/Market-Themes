import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  AnthropicBatchApi,
  AnthropicBatchProviderRecord,
  AnthropicBatchRequest,
  AnthropicBatchResult
} from "@market-themes/analysis";
import {
  createDatabaseClient,
  getTrackedNarrativeDefinitions,
  persistDocuments
} from "@market-themes/db";
import {
  pollNarrativeClassificationBatch,
  runNarrativeClassificationBatch
} from "./classify-narratives-batch";

test(
  "submits, reconciles, persists, and reloads a classification batch",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    const documentId = `integration:batch-classification:${suffix}`;
    const model = `integration-batch-model-${suffix}`;
    const promptVersion = `integration-batch-prompt-${suffix}`;
    const providerBatchId = `provider-batch-${suffix}`;
    const priorModel = process.env.ANTHROPIC_MODEL;
    const priorPromptVersion =
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION;
    context.after(() =>
      cleanup(documentId, model, promptVersion).finally(() => {
        restoreEnv("ANTHROPIC_MODEL", priorModel);
        restoreEnv(
          "NARRATIVE_CLASSIFICATION_PROMPT_VERSION",
          priorPromptVersion
        );
      })
    );
    process.env.ANTHROPIC_MODEL = model;
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION = promptVersion;

    await persistDocuments([
      {
        id: documentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Batch classification ${suffix}`,
        publisher: "Integration Publisher",
        url: `https://example.com/batch-classification/${suffix}`,
        publishedAt: "2099-09-01T00:00:00.000Z",
        tickers: [],
        summary: "Batch classification integration fixture",
        body: `No tracked narrative is supported by this fixture. ${suffix}`,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);

    let submittedRequests: AnthropicBatchRequest[] = [];
    const submitApi = fakeBatchApi({
      batch: providerBatch("in_progress", providerBatchId),
      onCreate: (requests) => {
        submittedRequests = requests;
      }
    });
    const submitted = await runNarrativeClassificationBatch({
      api: submitApi,
      maxDocuments: 1
    });
    assert.equal(submitted.documentsSubmitted, 1);
    assert.equal(submitted.batchStatus, "submitted");
    assert.equal(submittedRequests.length, 1);

    const customId = submittedRequests[0].custom_id;
    const result = {
      custom_id: customId,
      result: {
        type: "succeeded",
        message: {
          id: `message-${suffix}`,
          type: "message",
          role: "assistant",
          model,
          content: [{ type: "text", text: '{"observations":[]}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }
      }
    } as AnthropicBatchResult;
    const reconciled = await pollNarrativeClassificationBatch(
      fakeBatchApi({
        batch: providerBatch("ended", providerBatchId),
        results: [result]
      })
    );
    assert.equal(reconciled.status, "completed");

    const definitions = await getTrackedNarrativeDefinitions();
    const client = createDatabaseClient();
    await client.connect();
    try {
      const observations = await client.query<{
        count: string;
        matched_count: string;
      }>(
        `select count(*)::text as count,
                count(*) filter (where matched)::text as matched_count
         from narrative_observations
         where document_id = $1 and model = $2 and prompt_version = $3`,
        [documentId, model, promptVersion]
      );
      assert.equal(Number(observations.rows[0].count), definitions.length);
      assert.equal(Number(observations.rows[0].matched_count), 0);

      const batch = await client.query<{
        status: string;
        item_status: string;
      }>(
        `select mb.status, mbi.status as item_status
         from anthropic_message_batches mb
         join anthropic_message_batch_items mbi on mbi.batch_id = mb.id
         where mb.provider_batch_id = $1`,
        [providerBatchId]
      );
      assert.deepEqual(batch.rows[0], {
        status: "completed",
        item_status: "completed"
      });
    } finally {
      await client.end();
    }
  }
);

function fakeBatchApi(options: {
  batch: AnthropicBatchProviderRecord;
  results?: AnthropicBatchResult[];
  onCreate?: (requests: AnthropicBatchRequest[]) => void;
}): AnthropicBatchApi {
  return {
    create: async (requests) => {
      options.onCreate?.(requests);
      return options.batch;
    },
    retrieve: async () => options.batch,
    results: async () => asyncIterable(options.results ?? [])
  };
}

function providerBatch(
  status: "in_progress" | "ended",
  id: string
): AnthropicBatchProviderRecord {
  return {
    id,
    type: "message_batch",
    processing_status: status,
    request_counts: {
      processing: status === "in_progress" ? 1 : 0,
      succeeded: status === "ended" ? 1 : 0,
      errored: 0,
      canceled: 0,
      expired: 0
    },
    created_at: "2026-09-01T00:00:00.000Z",
    expires_at: "2026-09-02T00:00:00.000Z",
    ended_at: status === "ended" ? "2026-09-01T00:10:00.000Z" : null,
    archived_at: null,
    cancel_initiated_at: null,
    results_url:
      status === "ended"
        ? "https://api.example.test/batch-results"
        : null
  };
}

async function cleanup(
  documentId: string,
  model: string,
  promptVersion: string
) {
  if (!process.env.DATABASE_URL) return;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from narrative_observations
       where document_id = $1 and model = $2 and prompt_version = $3`,
      [documentId, model, promptVersion]
    );
    await client.query(
      `delete from anthropic_message_batches
       where model = $1 and prompt_version = $2`,
      [model, promptVersion]
    );
    await client.query("delete from documents where id = $1", [documentId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function* asyncIterable<T>(items: T[]) {
  for (const item of items) yield item;
}
