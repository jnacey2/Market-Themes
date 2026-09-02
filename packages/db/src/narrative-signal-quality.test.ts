import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/018_narrative_signal_quality.sql", import.meta.url)
  ),
  "utf8"
);

test("adds narrative hierarchy, lifecycle, and story breadth", () => {
  assert.match(migration, /parent_definition_id/);
  assert.match(migration, /event_expires_at/);
  assert.match(migration, /activated_at/);
  assert.match(migration, /story_breadth/);
  assert.match(migration, /corpus_eligible_documents/);
  assert.match(migration, /classification_coverage_pct/);
  assert.match(migration, /coverage_state/);
  assert.match(migration, /'probationary'/);
  assert.match(migration, /'family'/);
  assert.match(migration, /'merged'/);
});

test("consolidates geopolitical energy narratives into measured dimensions", () => {
  assert.match(migration, /Geopolitical Energy Shock/);
  assert.match(migration, /'supply disruption'/);
  assert.match(migration, /'inflation and rates'/);
  assert.match(migration, /'cross-asset repricing'/);
  assert.match(migration, /merged_into_definition_id/);
  assert.match(migration, /quality-consolidation/);
});

test("re-reviews incomplete evidence and corrects the Venezuela claim", () => {
  assert.match(migration, /contract-completeness re-review/);
  assert.match(migration, /US-Backed Venezuela Oil Concessions/);
  assert.match(migration, /35% parent-company stake/);
  assert.match(migration, /Exclude claims of majority US equity ownership/);
});

test("backfills explicit wire attribution before breadth is recomputed", () => {
  assert.match(migration, /Reuters reported/);
  assert.match(migration, /associated-press/);
  assert.match(migration, /publisher_owner/);
});
