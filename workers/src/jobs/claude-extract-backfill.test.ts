import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient } from "@market-themes/db";
import { runClaudeExtractionBackfill } from "./claude-extract-backfill";

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
