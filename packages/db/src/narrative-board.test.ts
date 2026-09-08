import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomepageLanes,
  compareBySurprise,
  deriveNarrativeChanges,
  type ChangeSnapshotRow
} from "./narratives";
import type { NarrativeHomepageItem } from "./types";

test("homepage lanes group narratives by lifecycle state and rank by surprise", () => {
  const items = [
    item({ id: "a", name: "Broad but boring", lifecycleState: "steady", storyBreadth: 40, attentionZScore: 0.1 }),
    item({ id: "b", name: "Quiet surge", lifecycleState: "rising", storyBreadth: 3, attentionZScore: 3.2 }),
    item({ id: "c", name: "Loud surge", lifecycleState: "rising", storyBreadth: 12, attentionZScore: 2.1 }),
    item({ id: "d", name: "Rolling over", lifecycleState: "fading", change: -3, daysSincePeak: 12 }),
    item({ id: "e", name: "Collapsed", lifecycleState: "fading", change: -8, daysSincePeak: 20 }),
    item({ id: "f", name: "Top", lifecycleState: "peaking", percentOfPeak: 100 }),
    item({ id: "g", name: "Brand new", lifecycleState: "emerging", status: "probationary", attentionMatchedDocuments: 2 }),
    item({ id: "h", name: "Pending coverage", lifecycleState: "unmeasured", coverageStatus: "backfill_pending" })
  ];
  const lanes = buildHomepageLanes(items, "2026-09-01");

  assert.deepEqual(lanes.rising.map((row) => row.id), ["b", "c"]);
  assert.deepEqual(lanes.peaking.map((row) => row.id), ["f"]);
  assert.deepEqual(lanes.fading.map((row) => row.id), ["e", "d"]);
  assert.deepEqual(lanes.emerging.map((row) => row.id), ["g"]);
});

test("recently activated narratives appear in the emerging lane even when steady", () => {
  const lanes = buildHomepageLanes(
    [
      item({ id: "new", lifecycleState: "steady", activatedAt: "2026-08-30T10:00:00Z" }),
      item({ id: "old", lifecycleState: "steady", activatedAt: "2026-05-01T10:00:00Z" })
    ],
    "2026-09-01"
  );
  assert.deepEqual(lanes.emerging.map((row) => row.id), ["new"]);
});

test("surprise ordering prefers attention z-score over raw breadth", () => {
  const sorted = [
    item({ id: "popular", storyBreadth: 50, attentionZScore: 0, zScore: 0 }),
    item({ id: "surprising", storyBreadth: 2, attentionZScore: 2.5, zScore: 1 })
  ].sort(compareBySurprise);
  assert.equal(sorted[0].id, "surprising");
});

test("change report captures state transitions, movers, entries, and new definitions", () => {
  const report = deriveNarrativeChanges(
    [
      snapshot({ id: "flip", previous_state: "rising", current_state: "peaking", previous_density: 6, current_density: 6.4 }),
      snapshot({ id: "move", previous_state: "steady", current_state: "steady", previous_density: 2, current_density: 4.5 }),
      snapshot({ id: "quiet", previous_state: "steady", current_state: "steady", previous_density: 2, current_density: 2.2 }),
      snapshot({ id: "enter", previous_coverage: "backfill_pending", previous_state: "unmeasured", current_state: "emerging", previous_density: 0, current_density: 1 }),
      snapshot({ id: "fresh", activated_at: "2026-09-01T00:00:00Z", current_state: "emerging", previous_state: null, previous_coverage: null, previous_density: null, current_density: 1 }),
      snapshot({ id: "gone", status: "expired", current_state: null, current_coverage: null, current_density: null })
    ],
    "2026-09-01",
    "2026-08-31"
  );

  const kinds = Object.fromEntries(report.changes.map((change) => [change.narrativeDefinitionId, change.kind]));
  assert.equal(kinds.flip, "state_change");
  assert.equal(kinds.move, "mover");
  assert.equal(kinds.quiet, undefined);
  assert.equal(kinds.enter, "entered_board");
  assert.equal(kinds.gone, "expired_definition");
  assert.ok(report.changes.some((change) => change.narrativeDefinitionId === "fresh" && change.kind === "new_definition"));
  assert.equal(report.stateCounts.steady, 2);
  assert.equal(report.stateCounts.peaking, 1);
  assert.equal(report.changes[0].kind, "new_definition");
});

function item(overrides: Partial<NarrativeHomepageItem> & { id: string }): NarrativeHomepageItem {
  return {
    slug: overrides.id,
    version: 1,
    name: overrides.id,
    proposition: "",
    category: "Macro",
    inclusionGuidance: "",
    exclusionGuidance: "",
    positiveExamples: [],
    negativeExamples: [],
    status: "active",
    trendWindow: "7d",
    latestDate: "2026-09-01",
    density: 1,
    baselineMean: 1,
    zScore: 0,
    percentileRank: 50,
    change: 0,
    acceleration: 0,
    riskTone: 0,
    bullishTone: 0,
    eligibleDocuments: 10,
    matchedDocuments: 1,
    publisherBreadth: 1,
    publisherOwnerBreadth: 1,
    storyBreadth: 1,
    sourceClassBreadth: 1,
    entityBreadth: 1,
    lowHistory: false,
    corpusDocuments: 10,
    classificationCoveragePercent: 100,
    coverageStatus: "measured",
    lifecycleState: "steady",
    baselineWindows: 5,
    attentionDensity: 1,
    attentionMatchedDocuments: 1,
    attentionZScore: 0,
    peakDensity: 1,
    peakDate: "2026-09-01",
    daysSincePeak: 0,
    percentOfPeak: 100,
    evidencePreview: [],
    ...overrides
  };
}

function snapshot(overrides: Partial<ChangeSnapshotRow> & { id: string }): ChangeSnapshotRow {
  return {
    slug: overrides.id,
    version: 1,
    name: overrides.id,
    proposition: "",
    category: "Macro",
    inclusion_guidance: "",
    exclusion_guidance: "",
    positive_examples: [],
    negative_examples: [],
    status: "active",
    kind: "structural",
    event_label: null,
    metadata: {},
    parent_definition_id: null,
    merged_into_definition_id: null,
    parent_name: null,
    dimension: null,
    event_expires_at: null,
    activated_at: "2026-01-01T00:00:00Z",
    current_density: 1,
    current_state: "steady",
    current_attention_z: 0,
    current_coverage: "measured",
    previous_density: 1,
    previous_state: "steady",
    previous_coverage: "measured",
    ...overrides
  };
}
