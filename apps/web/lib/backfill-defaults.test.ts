import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_BACKFILL_DEFAULTS,
  controlledBackfillOptions
} from "./backfill-defaults";

test("backfill requests default to 100 recent documents at concurrency two", () => {
  const options = controlledBackfillOptions({});
  assert.deepEqual(options, CONTROLLED_BACKFILL_DEFAULTS);
  assert.equal(options.batchSize * options.maxBatches, 100);
});

test("invalid backfill limits fail closed to controlled defaults", () => {
  assert.deepEqual(
    controlledBackfillOptions({
      batchSize: 0,
      maxBatches: -1,
      concurrency: "invalid",
      documentTimeoutMs: Number.NaN,
      staleAfterMinutes: null,
      lookbackDays: ""
    }),
    CONTROLLED_BACKFILL_DEFAULTS
  );
});

test("explicit positive backfill limits remain supported", () => {
  assert.deepEqual(
    controlledBackfillOptions({
      batchSize: 25,
      maxBatches: 4,
      concurrency: 3,
      documentTimeoutMs: 300_000,
      staleAfterMinutes: 60,
      lookbackDays: 14
    }),
    {
      batchSize: 25,
      maxBatches: 4,
      concurrency: 3,
      documentTimeoutMs: 300_000,
      staleAfterMinutes: 60,
      lookbackDays: 14
    }
  );
});

test("backfill API limits cannot exceed operational safety ceilings", () => {
  assert.deepEqual(
    controlledBackfillOptions({
      batchSize: 10_000,
      maxBatches: 10_000,
      concurrency: 100,
      documentTimeoutMs: 9_000_000,
      staleAfterMinutes: 10_000,
      lookbackDays: 10_000
    }),
    {
      batchSize: 25,
      maxBatches: 40,
      concurrency: 4,
      documentTimeoutMs: 600_000,
      staleAfterMinutes: 240,
      lookbackDays: 365
    }
  );
});
