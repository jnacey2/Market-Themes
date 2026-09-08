import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient } from "@market-themes/db";
import {
  runWithConcurrency,
  withTimeout,
  runClaudeExtractionBackfill,
  shouldStopClaimedBackfillJob
} from "./claude-extract-backfill";

test("claimed jobs stop for requested, cancelled, or missing state", () => {
  assert.equal(shouldStopClaimedBackfillJob({ status: "running" }), false);
  assert.equal(shouldStopClaimedBackfillJob({ status: "stop_requested" }), true);
  assert.equal(shouldStopClaimedBackfillJob({ status: "cancelled" }), true);
  assert.equal(shouldStopClaimedBackfillJob({ status: "completed" }), true);
  assert.equal(shouldStopClaimedBackfillJob(null), true);
});

test(
  "signal extraction skips safely when another run owns the global lock",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const client = createDatabaseClient();
    await client.connect();
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "integration-placeholder";
    try {
      await client.query(
        `select pg_advisory_lock(hashtext('market_themes_signal_extraction'))`
      );
      const result = await runClaudeExtractionBackfill({
        batchSize: 10,
        maxBatches: 10,
        concurrency: 2,
        documentTimeoutMs: 600_000,
        maxRuntimeMs: 3_000_000,
        lookbackDays: 30,
        excludedSecFilingCategories: ["capital_markets"],
        maxAnalysisAttempts: 5,
        model: "integration-model",
        promptVersion: "integration-prompt",
        maxEvidenceChars: 800,
        staleAfterMinutes: 90
      });
      assert.equal(result.skippedAlreadyRunning, true);
      assert.equal(result.selectedDocuments, 0);
      assert.equal(result.stopReason, "already_running");
    } finally {
      await client
        .query(
          `select pg_advisory_unlock(hashtext('market_themes_signal_extraction'))`
        )
        .catch(() => undefined);
      await client.end();
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
    }
  }
);

test("asynchronous stop checks never schedule an undefined extra item", async () => {
  const visited: number[] = [];
  const result = await runWithConcurrency(
    [1, 2, 3, 4, 5],
    3,
    async (item) => {
      assert.notEqual(item, undefined);
      visited.push(item);
      return item * 2;
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return false;
    }
  );
  assert.deepEqual(visited.sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});

test("extraction timeout aborts the actual provider operation", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    withTimeout(
      async (current) => {
        signal = current;
        await new Promise((resolve) =>
          current.addEventListener("abort", resolve, { once: true })
        );
        current.throwIfAborted();
      },
      5,
      "time budget exceeded"
    )
  );
  assert.equal(signal?.aborted, true);
});
