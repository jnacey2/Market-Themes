import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseClient } from "./persistence";
import { acquireTrendDatabaseLock } from "./trend-database-lock";
import { countNarrativeClassificationBacklog, selectDocumentsForNarrativeClassification } from "./narratives";

test("trend rewrite blocks classification queries until its connection closes", { skip: !process.env.DATABASE_URL }, async () => {
  const writer = createDatabaseClient();
  await writer.connect();
  await acquireTrendDatabaseLock(writer, "exclusive");
  const reader = createDatabaseClient();
  await reader.connect();
  try {
    await assert.rejects(
      acquireTrendDatabaseLock(reader, "shared", { maxWaitMs: 20, pollIntervalMs: 5, onWait: () => {} }),
      /Timed out waiting/
    );
  } finally {
    await reader.end();
    await writer.end();
  }
  // The timed-out reader and the writer have released their sessions. Real
  // classification functions must now acquire/release shared locks themselves.
  await selectDocumentsForNarrativeClassification({ model: "lock-test", promptVersion: "lock-test", limit: 1 });
  await countNarrativeClassificationBacklog({ model: "lock-test", promptVersion: "lock-test" });
  const nextWriter = createDatabaseClient();
  await nextWriter.connect();
  try {
    await acquireTrendDatabaseLock(nextWriter, "exclusive", { maxWaitMs: 20 });
  } finally { await nextWriter.end(); }
});

test("readers can coexist but a rewrite waits and resumes after the last reader closes", { skip: !process.env.DATABASE_URL }, async () => {
  const first = createDatabaseClient();
  const second = createDatabaseClient();
  const writer = createDatabaseClient();
  await Promise.all([first.connect(), second.connect(), writer.connect()]);
  let firstClosed = false;
  let secondClosed = false;
  try {
    await acquireTrendDatabaseLock(first, "shared");
    await acquireTrendDatabaseLock(second, "shared", { maxWaitMs: 20 });
    await first.end(); firstClosed = true;
    let waiting!: () => void;
    const didWait = new Promise<void>((resolve) => { waiting = resolve; });
    const pending = acquireTrendDatabaseLock(writer, "exclusive", {
      maxWaitMs: 1000, pollIntervalMs: 5, onWait: waiting
    });
    await didWait;
    await second.end(); secondClosed = true;
    await pending;
  } finally {
    if (!firstClosed) await first.end();
    if (!secondClosed) await second.end();
    await writer.end();
  }
});
