import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createAnthropicMessageBatch,
  createDatabaseClient,
  finishAnthropicMessageBatch,
  getActiveAnthropicMessageBatch,
  getAnalysisDocumentsByIds,
  getAnthropicMessageBatch,
  markAnthropicBatchSubmitted,
  persistDocuments,
  recordAnthropicBatchItemResult
} from "./index";

test(
  "persists and completes a durable Anthropic batch lifecycle",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    const batchId = `integration:anthropic-batch:${suffix}`;
    const documentId = `integration:anthropic-document:${suffix}`;
    context.after(() => cleanup(batchId, documentId));

    await persistDocuments([
      {
        id: documentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Anthropic batch integration ${suffix}`,
        publisher: "Integration Publisher",
        url: `https://example.com/anthropic-batch/${suffix}`,
        publishedAt: "2026-09-01T00:00:00.000Z",
        tickers: [],
        summary: "Batch integration fixture",
        body: `Durable batch fixture ${suffix}`,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);

    const created = await createAnthropicMessageBatch({
      id: batchId,
      workload: `integration-${suffix}`,
      model: "integration-model",
      promptVersion: "integration-prompt",
      metadata: { fixture: true },
      items: [
        {
          customId: "integration-request-1",
          documentId,
          metadata: { textHash: "fixture-hash" }
        }
      ]
    });
    assert(created);
    assert.equal(created.status, "submitting");
    assert.equal(created.items[0].customId, "integration-request-1");

    const active = await getActiveAnthropicMessageBatch(
      `integration-${suffix}`
    );
    assert.equal(active?.id, batchId);
    assert.equal((await getAnalysisDocumentsByIds([documentId])).length, 1);

    await markAnthropicBatchSubmitted(batchId, {
      id: `provider-${suffix}`,
      processingStatus: "ended",
      processingCount: 0,
      succeededCount: 1,
      erroredCount: 0,
      canceledCount: 0,
      expiredCount: 0,
      expiresAt: "2026-09-02T00:00:00.000Z",
      endedAt: "2026-09-01T00:10:00.000Z",
      resultsUrl: `https://api.example.test/results/${suffix}`
    });
    await recordAnthropicBatchItemResult({
      batchId,
      customId: "integration-request-1",
      status: "completed",
      usage: { inputTokens: 10, outputTokens: 2 }
    });
    await finishAnthropicMessageBatch({
      id: batchId,
      status: "completed",
      metadata: { resultSummary: { documentsProcessed: 1 } }
    });

    const completed = await getAnthropicMessageBatch(batchId);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.providerBatchId, `provider-${suffix}`);
    assert.equal(completed?.items[0].status, "completed");
    assert.equal(
      (completed?.metadata.resultSummary as { documentsProcessed: number })
        .documentsProcessed,
      1
    );
    assert.equal(
      await getActiveAnthropicMessageBatch(`integration-${suffix}`),
      null
    );
  }
);

async function cleanup(batchId: string, documentId: string) {
  if (!process.env.DATABASE_URL) return;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query(
      "delete from anthropic_message_batches where id = $1",
      [batchId]
    );
    await client.query("delete from documents where id = $1", [documentId]);
  } finally {
    await client.end();
  }
}
