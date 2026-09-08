import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabaseClient } from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

test(
  "recorded jobs retain partial and fully failed outcomes",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const stage = `audit-outcome:${randomUUID()}`;
    for (const processed of [0, 2]) {
      await runRecordedJob(
        stage,
        async () => ({ processed, failed: 1 }),
        (result) => result.processed,
        (result) => result.failed
      );
    }
    const client = createDatabaseClient();
    await client.connect();
    try {
      const rows = await client.query(
        "select status, processed_count, failed_count from pipeline_runs where stage = $1 order by processed_count",
        [stage]
      );
      assert.deepEqual(rows.rows, [
        { status: "failed", processed_count: 0, failed_count: 1 },
        { status: "partial", processed_count: 2, failed_count: 1 }
      ]);
    } finally {
      await client.end();
    }
  }
);
