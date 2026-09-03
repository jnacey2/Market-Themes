import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyBrief, deriveNarrativeAlerts } from "./narrative-briefs";
import type {
  NarrativeChange,
  NarrativeHomepageItem,
  NarrativeHomepageStatus
} from "./types";

const emptyCounts = {
  unmeasured: 0,
  dormant: 0,
  emerging: 0,
  rising: 0,
  peaking: 0,
  steady: 0,
  fading: 0
};

test("daily brief leads with the rising narrative and names the fading one", () => {
  const lanes: NarrativeHomepageStatus["lanes"] = {
    rising: [item({ id: "r", name: "Private Credit Stress", lifecycleState: "rising", density: 6.2, change: 2.1, attentionZScore: 2.8 })],
    peaking: [],
    fading: [item({ id: "f", name: "Consumer Trade-Down", lifecycleState: "fading", percentOfPeak: 35, daysSincePeak: 18, change: -2 })],
    emerging: [item({ id: "e", name: "Tariff Pass-Through", lifecycleState: "emerging", status: "probationary" })]
  };
  const brief = buildDailyBrief(
    lanes,
    {
      currentDate: "2026-09-01",
      previousDate: "2026-08-31",
      stateCounts: { ...emptyCounts, rising: 1, fading: 1, emerging: 1 },
      changes: [change({ narrativeDefinitionId: "f", name: "Consumer Trade-Down", kind: "state_change", previousState: "steady", currentState: "fading" })]
    },
    "2026-09-01"
  );

  assert.match(brief.headline, /Private Credit Stress is gaining attention; Consumer Trade-Down is fading/);
  assert.match(brief.summary, /35% of its 90-day peak, 18 days past peak/);
  assert.match(brief.summary, /1 lifecycle transition/);
  assert.deepEqual(brief.sections.map((section) => section.title), ["Rising", "Fading", "Emerging", "What changed"]);
  assert.deepEqual(brief.narrativeDefinitionIds, ["r", "f", "e"]);
});

test("daily brief never headlines an unmeasured narrative as measurable", () => {
  const lanes: NarrativeHomepageStatus["lanes"] = {
    rising: [],
    peaking: [],
    fading: [],
    emerging: [
      item({ id: "u1", name: "AI Infrastructure Demand", lifecycleState: "unmeasured", status: "probationary" }),
      item({ id: "u2", name: "Hormuz Escalation", lifecycleState: "unmeasured", status: "probationary" })
    ]
  };
  const brief = buildDailyBrief(
    lanes,
    {
      currentDate: "2026-09-03",
      previousDate: "2026-09-02",
      stateCounts: { ...emptyCounts, unmeasured: 20 },
      changes: []
    },
    "2026-09-03"
  );

  assert.doesNotMatch(brief.headline, /newly measurable/);
  assert.match(brief.headline, /No narrative is measured yet; 20 narratives are awaiting classification coverage/);
  assert.match(brief.summary, /20 narratives have incomplete classification coverage/);
  assert.doesNotMatch(brief.summary, /reviewed density/);

  const mixed = buildDailyBrief(
    {
      ...lanes,
      emerging: [
        item({ id: "u1", name: "AI Infrastructure Demand", lifecycleState: "unmeasured", status: "probationary" }),
        item({ id: "m", name: "Tariff Pass-Through", lifecycleState: "emerging", status: "probationary" })
      ]
    },
    { currentDate: "2026-09-03", previousDate: "2026-09-02", stateCounts: { ...emptyCounts, emerging: 1, unmeasured: 1 }, changes: [] },
    "2026-09-03"
  );
  assert.match(mixed.headline, /^Tariff Pass-Through is newly measurable/);
});

test("alerts fire for state changes, large moves, new definitions, and unusual attention", () => {
  const lanes: NarrativeHomepageStatus["lanes"] = {
    rising: [item({ id: "hot", name: "Hot", attentionZScore: 3.1 })],
    peaking: [],
    fading: [],
    emerging: []
  };
  const alerts = deriveNarrativeAlerts(
    {
      currentDate: "2026-09-01",
      changes: [
        change({ narrativeDefinitionId: "a", kind: "state_change", previousState: "rising", currentState: "fading" }),
        change({ narrativeDefinitionId: "b", kind: "mover", change: 4.2 }),
        change({ narrativeDefinitionId: "c", kind: "mover", change: 1.2 }),
        change({ narrativeDefinitionId: "d", kind: "new_definition" }),
        change({ narrativeDefinitionId: "e", kind: "left_board" })
      ]
    },
    lanes
  );
  const byNarrative = Object.fromEntries(alerts.map((alert) => [alert.narrativeDefinitionId, alert.alertType]));
  assert.equal(byNarrative.a, "state:fading");
  assert.equal(byNarrative.b, "surge");
  assert.equal(byNarrative.c, undefined);
  assert.equal(byNarrative.d, "new_definition");
  assert.equal(byNarrative.e, undefined);
  assert.equal(byNarrative.hot, "unusual_attention");
  assert.ok(alerts.every((alert) => alert.alertDate === "2026-09-01"));
});

function change(overrides: Partial<NarrativeChange> & { narrativeDefinitionId: string }): NarrativeChange {
  return {
    kind: "mover",
    slug: overrides.narrativeDefinitionId,
    name: overrides.narrativeDefinitionId,
    proposition: "",
    category: "Macro",
    kindLabel: "structural",
    previousState: "steady",
    currentState: "steady",
    previousDensity: 1,
    currentDensity: 1,
    attentionZScore: 0,
    change: 0,
    detail: "detail",
    ...overrides
  };
}

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
