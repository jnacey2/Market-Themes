import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient, getAnalysisStatus } from "./persistence";

test(
  "keeps healthy analysis sections when signal queries time out",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const blocker = createDatabaseClient();
    await blocker.connect();
    const previousTimeout = process.env.DB_QUERY_TIMEOUT_MS;
    try {
      await blocker.query("begin");
      await blocker.query("lock table signals in access exclusive mode");
      process.env.DB_QUERY_TIMEOUT_MS = "250";

      const status = await getAnalysisStatus();

      assert.equal(status.databaseConfigured, true);
      assert.equal(status.degraded, true);
      assert(status.unavailableSections.includes("summary"));
      assert(status.unavailableSections.includes("recentSignals"));
      assert.equal(status.unavailableSections.includes("coverage"), false);
      assert.equal(status.unavailableSections.includes("recentRuns"), false);
    } finally {
      if (previousTimeout === undefined) {
        delete process.env.DB_QUERY_TIMEOUT_MS;
      } else {
        process.env.DB_QUERY_TIMEOUT_MS = previousTimeout;
      }
      await blocker.query("rollback");
      await blocker.end();
    }
  }
);
