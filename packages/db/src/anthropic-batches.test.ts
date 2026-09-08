import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/017_anthropic_message_batches.sql", import.meta.url)
  ),
  "utf8"
);
const narratives = readFileSync(
  fileURLToPath(new URL("narratives.ts", import.meta.url)),
  "utf8"
);
const persistence = readFileSync(
  fileURLToPath(new URL("persistence.ts", import.meta.url)),
  "utf8"
);

test("persists batches, request mappings, and one active batch per workload", () => {
  assert.match(migration, /create table if not exists anthropic_message_batches/);
  assert.match(
    migration,
    /create table if not exists anthropic_message_batch_items/
  );
  assert.match(
    migration,
    /anthropic_message_batches_active_workload_idx[\s\S]*where status in/
  );
  assert.match(migration, /unique \(batch_id, custom_id\)/);
});

test("classification selection excludes documents in active batches", () => {
  assert.match(
    narratives,
    /from anthropic_message_batch_items mbi[\s\S]*mb\.workload = 'narrative_classification'/
  );
  assert.match(
    narratives,
    /'submission_unknown'[\s\S]*'processing_results'/
  );
});

test("ordinary stale recovery does not reclaim provider-owned batch work", () => {
  assert.match(
    persistence,
    /metadata->>'executionMode', ''\) = 'anthropic_batch'[\s\S]*from anthropic_message_batches amb[\s\S]*amb\.status in/
  );
});
