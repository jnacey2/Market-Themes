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
  persistDocuments
} from "@market-themes/db";
import {
  pollSignalExtractionBatch,
  runClaudeExtractionBatch
} from "./claude-extract-batch";

test(
  "submits, reconciles, and persists a signal-extraction batch",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    const documentId = `integration:batch-extraction:${suffix}`;
    const model = `integration-extraction-model-${suffix}`;
    const promptVersion = `integration-extraction-prompt-${suffix}`;
    const providerBatchId = `provider-extraction-${suffix}`;
    const evidence = "Demand is weakening.";
    const priorModel = process.env.ANTHROPIC_MODEL;
    const priorPromptVersion = process.env.CLAUDE_PROMPT_VERSION;
    const priorLookback = process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS;
    context.after(() =>
      cleanup(documentId, model, promptVersion).finally(() => {
        restoreEnv("ANTHROPIC_MODEL", priorModel);
        restoreEnv("CLAUDE_PROMPT_VERSION", priorPromptVersion);
        restoreEnv("CLAUDE_EXTRACTION_LOOKBACK_DAYS", priorLookback);
      })
    );
    process.env.ANTHROPIC_MODEL = model;
    process.env.CLAUDE_PROMPT_VERSION = promptVersion;
    delete process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS;

    await persistDocuments([
      {
        id: documentId,
        sourceId: "fmp-transcripts",
        sourceClass: "transcript",
        title: `Batch extraction ${suffix}`,
        publisher: "Integration Publisher",
        url: `https://example.com/batch-extraction/${suffix}`,
        publishedAt: "2099-09-01T00:00:00.000Z",
        tickers: ["TEST"],
        summary: "Batch extraction integration fixture",
        body: `${evidence} ${suffix}`,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);

    let submittedRequests: AnthropicBatchRequest[] = [];
    const submitted = await runClaudeExtractionBatch({
      api: fakeBatchApi({
        batch: providerBatch("in_progress", providerBatchId),
        onCreate: (requests) => {
          submittedRequests = requests;
        }
      }),
      maxDocuments: 1
    });
    assert.equal(submitted.documentsSubmitted, 1);
    assert.equal(submittedRequests.length, 1);

    const result = {
      custom_id: submittedRequests[0].custom_id,
      result: {
        type: "succeeded",
        message: {
          id: `message-${suffix}`,
          type: "message",
          role: "assistant",
          model,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                signals: [
                  {
                    rawThemeLabel: "Demand weakness",
                    canonicalThemeLabel: "Demand Weakness",
                    themeDescription:
                      "Demand is weakening across the covered market.",
                    stance: "risk",
                    riskTone: 85,
                    bullishTone: 5,
                    confidence: 92,
                    affectedEntities: ["TEST"],
                    evidenceSnippet: evidence,
                    interpretation: "The source explicitly reports weaker demand.",
                    sectionLabel: "Full document",
                    speaker: null
                  }
                ]
              })
            }
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 120,
            output_tokens: 40,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }
      }
    } as AnthropicBatchResult;
    const reconciled = await pollSignalExtractionBatch(
      fakeBatchApi({
        batch: providerBatch("ended", providerBatchId),
        results: [result]
      })
    );
    assert.equal(reconciled.status, "completed");

    const client = createDatabaseClient();
    await client.connect();
    try {
      const persisted = await client.query<{
        signal_count: string;
        run_status: string;
        item_status: string;
      }>(
        `select
           (select count(*)::text
              from signals
              where document_id = $1 and model = $2 and prompt_version = $3)
             as signal_count,
           (select status
              from document_analysis_runs
              where document_id = $1 and model = $2 and prompt_version = $3
                and analysis_type = 'market_signal_extraction')
             as run_status,
           (select mbi.status
              from anthropic_message_batch_items mbi
              join anthropic_message_batches mb on mb.id = mbi.batch_id
              where mb.provider_batch_id = $4)
             as item_status`,
        [documentId, model, promptVersion, providerBatchId]
      );
      assert.deepEqual(persisted.rows[0], {
        signal_count: "1",
        run_status: "completed",
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
        ? "https://api.example.test/extraction-results"
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
      "delete from signals where document_id = $1 and model = $2 and prompt_version = $3",
      [documentId, model, promptVersion]
    );
    await client.query(
      "delete from anthropic_message_batches where model = $1 and prompt_version = $2",
      [model, promptVersion]
    );
    await client.query(
      "delete from document_analysis_runs where document_id = $1",
      [documentId]
    );
    await client.query("delete from documents where id = $1", [documentId]);
    await client.query(
      `delete from themes
       where id = 'theme:demand-weakness'
         and not exists (
           select 1 from signals where theme_id = 'theme:demand-weakness'
         )`
    );
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
