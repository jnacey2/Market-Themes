import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStages, getIngestionFunnel } from "./ingestion-funnel";

test("funnel stages express every stage as a share of ingested documents", () => {
  const stages = buildStages({
    ingested: 200,
    with_text: 180,
    extracted: 150,
    with_signals: 120,
    classified: 140,
    matched: 35,
    approved: 12,
    in_candidates: 9
  });

  assert.deepEqual(
    stages.map((stage) => stage.key),
    [
      "ingested",
      "with_text",
      "extracted",
      "with_signals",
      "classified",
      "matched",
      "approved",
      "in_candidates"
    ]
  );
  assert.equal(stages[0].share, 1);
  assert.equal(stages[1].share, 0.9);
  assert.equal(stages[5].share, 0.175);
  assert.equal(stages[6].count, 12);
  assert.ok(stages.every((stage) => stage.description.length > 0));
});

test("funnel stages are zero-safe when nothing was ingested", () => {
  const stages = buildStages({
    ingested: 0,
    with_text: 0,
    extracted: 0,
    with_signals: 0,
    classified: 0,
    matched: 0,
    approved: 0,
    in_candidates: 0
  });
  assert.ok(stages.every((stage) => stage.share === 0 && stage.count === 0));
});

test("funnel returns an empty shape when the database is not configured", async () => {
  const funnel = await getIngestionFunnel({ windowDays: 400 }, "");
  assert.equal(funnel.databaseConfigured, false);
  assert.equal(funnel.windowDays, 90, "window is clamped");
  assert.equal(funnel.stages.length, 8);
  assert.equal(funnel.polling.dedupeRate, 0);
  assert.deepEqual(funnel.bySourceClass, []);

  const defaulted = await getIngestionFunnel({ windowDays: -3 }, "");
  assert.equal(defaulted.windowDays, 7);
});
