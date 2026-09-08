import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineStride,
  calculateNarrativeTrendSeries,
  deriveLifecycleState,
  deriveNarrativeCoverageState,
  isThinEvidence,
  resolveCoverageMeasuredPercent,
  resolveLifecycleBreadthPolicy,
  resolveBaselineCorpusFloor,
  robustScale,
  type NarrativeMetricObservation
} from "./narrative-metrics";

/** Synthetic series use a handful of documents per day, far below the production corpus floor. */
const SYNTHETIC_CORPUS = { baselineCorpusFloor: 0 };

test("normalizes density by eligible corpus within each source class, weighting classes by log volume", () => {
  const rows: NarrativeMetricObservation[] = [
    observation("a", "newspaper", true, "Publisher A", "Owner A"),
    observation("b", "newspaper", false, "Publisher B", "Owner B"),
    observation("c", "filing", true, "Issuer C", "Issuer C")
  ];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 2);

  // newspaper: 50% at weight ln(3); filing: 100% at weight ln(2)
  const expected =
    (50 * Math.log1p(2) + 100 * Math.log1p(1)) / (Math.log1p(2) + Math.log1p(1));
  assert.equal(point.density, Math.round(expected * 100) / 100);
  assert.ok(point.density < 75, "a single-document class no longer carries equal weight");
  assert.equal(point.eligibleDocuments, 3);
  assert.equal(point.matchedDocuments, 2);
  assert.equal(point.lowHistory, true);
  assert.equal(point.zScore, 0);
  assert.equal(point.percentileRank, 0);
  assert.equal(point.lifecycleState, "emerging");
});

test("counts publisher owners independently from syndicated publishers", () => {
  const rows = [
    observation("a", "newspaper", true, "Outlet A", "Wire Owner"),
    observation("b", "newspaper", true, "Outlet B", "Wire Owner")
  ];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 2);

  assert.equal(point.publisherBreadth, 2);
  assert.equal(point.publisherOwnerBreadth, 1);
  assert.equal(point.storyBreadth, 2);
  assert.equal(point.lowHistory, true);
});

test("counts syndicated copies as one unique story", () => {
  const rows = [
    {
      ...observation("a", "newspaper", true, "Outlet A", "Owner A"),
      storyFingerprint: "shared-wire-story"
    },
    {
      ...observation("b", "newspaper", true, "Outlet B", "Owner B"),
      storyFingerprint: "shared-wire-story"
    }
  ];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 2);

  assert.equal(point.matchedDocuments, 2);
  assert.equal(point.publisherOwnerBreadth, 2);
  assert.equal(point.storyBreadth, 1);
});

test("does not rank an uncovered window as unusual", () => {
  const rows = [observation("a", "newspaper", true, "Publisher A", "Owner A")];
  const points = calculateNarrativeTrendSeries(rows, ["2026-01-01", "2026-01-02"], 1, 1);
  const noCoverage = points[1];

  assert.equal(noCoverage.eligibleDocuments, 0);
  assert.equal(noCoverage.zScore, 0);
  assert.equal(noCoverage.percentileRank, 0);
  assert.equal(noCoverage.change, 0);
  assert.equal(noCoverage.lowHistory, true);
  assert.equal(noCoverage.lifecycleState, "unmeasured");
});

test("a measured zero after a sustained baseline produces a negative z-score and a fading state", () => {
  const dates = enumerate("2026-01-01", 30);
  const rows: NarrativeMetricObservation[] = [];
  for (const [index, date] of dates.entries()) {
    // Two documents per day; one matches for the first 22 days, then nothing.
    rows.push({ ...observation(`${date}:a`, "newspaper", index < 22, "P", "O"), date });
    rows.push({ ...observation(`${date}:b`, "newspaper", false, "Q", "R"), date });
  }
  const points = calculateNarrativeTrendSeries(rows, dates, 7, 14, undefined, SYNTHETIC_CORPUS);
  const last = points.at(-1)!;

  assert.equal(last.matchedDocuments, 0);
  assert.equal(last.coverageState, "measured_zero");
  assert.ok(last.baselineWindows >= 2);
  assert.ok(last.zScore < 0, `expected negative z, got ${last.zScore}`);
  assert.equal(last.percentileRank, 0);
  assert.ok(last.change < 0);
  assert.equal(last.lifecycleState, "fading");
  assert.ok(last.percentOfPeak < 50);
  assert.ok((last.daysSincePeak ?? 0) > 0);
});

test("a fresh burst after a flat history is rising, not silenced by the minimum scale", () => {
  const dates = enumerate("2026-01-01", 40);
  const rows: NarrativeMetricObservation[] = [];
  for (const [index, date] of dates.entries()) {
    for (let doc = 0; doc < 10; doc += 1) {
      // flat 10% density for 33 days, then 60% for the last week
      const matched = index >= 33 ? doc < 6 : doc < 1;
      rows.push({ ...observation(`${date}:${doc}`, "newspaper", matched, `P${doc}`, `O${doc}`), date });
    }
  }
  const points = calculateNarrativeTrendSeries(rows, dates, 7, 14, undefined, SYNTHETIC_CORPUS);
  const last = points.at(-1)!;

  assert.equal(last.lowHistory, false);
  assert.ok(last.zScore > 3, `expected large positive z, got ${last.zScore}`);
  assert.equal(last.percentileRank, 100);
  assert.equal(last.lifecycleState, "rising");
  assert.equal(last.percentOfPeak, 100);
  assert.equal(last.daysSincePeak, 0);
});

test("thin-corpus windows are excluded from the baseline and the peak", () => {
  const dates = enumerate("2026-01-01", 40);
  const rows: NarrativeMetricObservation[] = [];
  for (const [index, date] of dates.entries()) {
    // Days 10-16: a 3-document corpus with one match (33% density). Every other day:
    // 20 documents with one match (5%). The last week: 20 documents, 3 matches (15%).
    const thin = index >= 10 && index < 17;
    const documents = thin ? 3 : 20;
    for (let doc = 0; doc < documents; doc += 1) {
      const matched = index >= 33 ? doc < 3 : doc < 1;
      rows.push({ ...observation(`${date}:${doc}`, "newspaper", matched, `P${doc}`, `O${doc}`), date });
    }
  }
  const unfiltered = calculateNarrativeTrendSeries(rows, dates, 7, 14, undefined, SYNTHETIC_CORPUS).at(-1)!;
  const filtered = calculateNarrativeTrendSeries(rows, dates, 7, 14, undefined, {
    baselineCorpusFloor: 50
  }).at(-1)!;

  assert.ok(unfiltered.peakDensity > filtered.peakDensity, "the thin week set the unfiltered peak");
  assert.equal(filtered.percentOfPeak, 100, "the current week is the peak once thin windows are ignored");
  assert.ok(filtered.zScore > unfiltered.zScore, "thin windows inflated the unfiltered baseline");
  assert.ok(filtered.baselineWindows < unfiltered.baselineWindows);
  assert.equal(filtered.lifecycleState, "rising");
});

test("baseline corpus floor reads its env with a production default", () => {
  assert.equal(resolveBaselineCorpusFloor({}), 100);
  assert.equal(resolveBaselineCorpusFloor({ NARRATIVE_BASELINE_MIN_CORPUS_DOCUMENTS: "0" }), 0);
  assert.equal(resolveBaselineCorpusFloor({ NARRATIVE_BASELINE_MIN_CORPUS_DOCUMENTS: "250" }), 250);
  assert.equal(resolveBaselineCorpusFloor({ NARRATIVE_BASELINE_MIN_CORPUS_DOCUMENTS: "nope" }), 100);
});

test("raw attention counts pending classifier matches that reviewed density excludes", () => {
  const rows: NarrativeMetricObservation[] = [
    { ...observation("a", "newspaper", false, "P", "O"), rawMatched: true, matchScore: 80 },
    { ...observation("b", "newspaper", false, "Q", "R"), rawMatched: false, matchScore: 10 }
  ];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 1);

  assert.equal(point.density, 0);
  assert.equal(point.matchedDocuments, 0);
  assert.equal(point.attentionMatchedDocuments, 1);
  assert.equal(point.attentionDensity, 40);
});

test("suppresses movement while classification coverage is incomplete", () => {
  const rows = [observation("classified", "newspaper", true, "Publisher", "Owner")];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 1, [
    { date: "2026-01-01", documentId: "classified", sourceClass: "newspaper" },
    { date: "2026-01-01", documentId: "pending", sourceClass: "newspaper" }
  ]);

  assert.equal(point.coverageState, "backfill_pending");
  assert.equal(point.classificationCoveragePercent, 50);
  assert.equal(point.lowHistory, true);
  assert.equal(point.zScore, 0);
  assert.equal(point.change, 0);
  assert.equal(point.lifecycleState, "unmeasured");
});

test("baseline windows are spaced so consecutive samples do not overlap heavily", () => {
  assert.equal(baselineStride(7), 3);
  assert.equal(baselineStride(30), 15);
  assert.equal(baselineStride(1), 1);
});

test("robust scale floors flat baselines and survives a majority of identical values", () => {
  assert.equal(robustScale([2, 2, 2, 2]), 0.5);
  assert.equal(robustScale([0, 0, 0, 0, 9]), Math.max(Math.sqrt((4 * 1.8 ** 2 + 7.2 ** 2) / 4), 0.5));
  assert.ok(robustScale([1, 5, 9, 13]) > 0.5);
});

test("lifecycle state transitions follow peak and change rules", () => {
  const base = {
    hasCoverage: true,
    lowHistory: false,
    previousDensity: 4,
    previousChange: 0,
    peakDensity: 10,
    daysSincePeak: 0,
    windowDays: 7
  };
  assert.equal(deriveLifecycleState({ ...base, hasCoverage: false, density: 5, change: 0 }), "unmeasured");
  assert.equal(
    deriveLifecycleState({ ...base, density: 0, previousDensity: 0, change: 0 }),
    "dormant"
  );
  assert.equal(deriveLifecycleState({ ...base, density: 0, change: -4 }), "fading");
  assert.equal(
    deriveLifecycleState({ ...base, density: 3, change: -2, previousChange: -1 }),
    "fading"
  );
  assert.equal(
    deriveLifecycleState({ ...base, density: 3, change: 0.1, daysSincePeak: 20 }),
    "fading"
  );
  // Re-emerging from a trough well past the old peak is rising, not fading.
  assert.equal(
    deriveLifecycleState({ ...base, density: 4, change: 1.5, daysSincePeak: 44 }),
    "rising"
  );
  assert.equal(
    deriveLifecycleState({
      ...base,
      density: 4,
      change: 1.5,
      daysSincePeak: 44,
      storyBreadth: 1,
      publisherOwnerBreadth: 1
    }),
    "steady",
    "recovery on thin evidence is steady, still not fading"
  );
  assert.equal(deriveLifecycleState({ ...base, density: 10, change: 6 }), "rising");
  assert.equal(deriveLifecycleState({ ...base, density: 9.5, change: 0.2 }), "peaking");
  assert.equal(
    deriveLifecycleState({ ...base, density: 6, change: 0.2, daysSincePeak: 3 }),
    "steady"
  );
  assert.equal(
    deriveLifecycleState({ ...base, lowHistory: true, density: 2, change: 0.5 }),
    "emerging"
  );
});

test("rising and peaking require enough independent evidence", () => {
  const base = {
    hasCoverage: true,
    lowHistory: false,
    previousDensity: 4,
    previousChange: 0,
    peakDensity: 10,
    daysSincePeak: 0,
    windowDays: 7
  };
  const policy = { minimumStories: 3, minimumPublisherOwners: 2 };
  // One story from one publisher is trivially at its own peak: not a movement claim.
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 9.5, change: 0.2, storyBreadth: 1, publisherOwnerBreadth: 1 },
      policy
    ),
    "steady"
  );
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 10, change: 6, storyBreadth: 2, publisherOwnerBreadth: 2 },
      policy
    ),
    "steady"
  );
  // Three stories all from one owner is still one voice.
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 10, change: 6, storyBreadth: 3, publisherOwnerBreadth: 1 },
      policy
    ),
    "steady"
  );
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 10, change: 6, storyBreadth: 3, publisherOwnerBreadth: 2 },
      policy
    ),
    "rising"
  );
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 9.5, change: 0.2, storyBreadth: 4, publisherOwnerBreadth: 3 },
      policy
    ),
    "peaking"
  );
  // Thin evidence never hides a decline or a fresh definition's low history.
  assert.equal(
    deriveLifecycleState(
      { ...base, density: 0, change: -4, storyBreadth: 0, publisherOwnerBreadth: 0 },
      policy
    ),
    "fading"
  );
  assert.equal(
    deriveLifecycleState(
      { ...base, lowHistory: true, density: 2, change: 0.5, storyBreadth: 1, publisherOwnerBreadth: 1 },
      policy
    ),
    "emerging"
  );
  assert.equal(isThinEvidence({ storyBreadth: 1, publisherOwnerBreadth: 1 }, policy), true);
  assert.equal(isThinEvidence({ storyBreadth: 3, publisherOwnerBreadth: 2 }, policy), false);
  assert.deepEqual(resolveLifecycleBreadthPolicy({}), {
    minimumStories: 3,
    minimumPublisherOwners: 2
  });
  assert.deepEqual(
    resolveLifecycleBreadthPolicy({
      NARRATIVE_LIFECYCLE_MIN_STORIES: "5",
      NARRATIVE_LIFECYCLE_MIN_PUBLISHER_OWNERS: "bogus"
    }),
    { minimumStories: 5, minimumPublisherOwners: 2 }
  );
});

test("a single-publisher series does not open as peaking", () => {
  const dates = enumerate("2026-01-01", 40);
  const rows: NarrativeMetricObservation[] = [];
  for (const [index, date] of dates.entries()) {
    for (let doc = 0; doc < 10; doc += 1) {
      // Flat 10% for 33 days, then 60% in the last week, but every match comes from one owner.
      const matched = index >= 33 ? doc < 6 : doc < 1;
      rows.push({ ...observation(`${date}:${doc}`, "newspaper", matched, "P", "O"), date });
    }
  }
  const last = calculateNarrativeTrendSeries(rows, dates, 7, 14, undefined, SYNTHETIC_CORPUS).at(-1)!;
  assert.equal(last.publisherOwnerBreadth, 1);
  assert.ok(last.zScore > 3);
  assert.equal(last.lifecycleState, "steady");
});

test("distinguishes backfill, measured zero, measured, and empty coverage", () => {
  assert.deepEqual(
    deriveNarrativeCoverageState({ corpusEligibleDocuments: 0, classifiedDocuments: 0, matchedDocuments: 0 }),
    { classificationCoveragePercent: 0, coverageState: "no_corpus" }
  );
  assert.deepEqual(
    deriveNarrativeCoverageState({ corpusEligibleDocuments: 10, classifiedDocuments: 0, matchedDocuments: 0 }),
    { classificationCoveragePercent: 0, coverageState: "backfill_pending" }
  );
  assert.deepEqual(
    deriveNarrativeCoverageState({ corpusEligibleDocuments: 10, classifiedDocuments: 8, matchedDocuments: 1 }),
    { classificationCoveragePercent: 80, coverageState: "backfill_pending" }
  );
  assert.deepEqual(
    deriveNarrativeCoverageState({ corpusEligibleDocuments: 10, classifiedDocuments: 10, matchedDocuments: 0 }),
    { classificationCoveragePercent: 100, coverageState: "measured_zero" }
  );
  assert.deepEqual(
    deriveNarrativeCoverageState({ corpusEligibleDocuments: 10, classifiedDocuments: 10, matchedDocuments: 1 }),
    { classificationCoveragePercent: 100, coverageState: "measured" }
  );
});

function enumerate(start: string, days: number) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  for (let index = 0; index < days; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function observation(
  documentId: string,
  sourceClass: string,
  matched: boolean,
  publisherId: string,
  publisherOwner: string
): NarrativeMetricObservation {
  return {
    narrativeDefinitionId: "narrative:test",
    date: "2026-01-01",
    documentId,
    matched,
    matchScore: matched ? 90 : 10,
    riskTone: matched ? 60 : 0,
    bullishTone: 0,
    publisherId,
    publisherOwner,
    storyFingerprint: documentId,
    sourceClass,
    affectedEntities: matched ? ["Example"] : []
  };
}

test("coverage threshold below 100 lets a nearly complete window measure", () => {
  assert.deepEqual(
    deriveNarrativeCoverageState(
      { corpusEligibleDocuments: 1000, classifiedDocuments: 985, matchedDocuments: 3 },
      98
    ),
    { classificationCoveragePercent: 98.5, coverageState: "measured" }
  );
  assert.deepEqual(
    deriveNarrativeCoverageState(
      { corpusEligibleDocuments: 1000, classifiedDocuments: 970, matchedDocuments: 3 },
      98
    ),
    { classificationCoveragePercent: 97, coverageState: "backfill_pending" }
  );
  assert.equal(resolveCoverageMeasuredPercent(undefined), 100);
  assert.equal(resolveCoverageMeasuredPercent("98"), 98);
  assert.equal(resolveCoverageMeasuredPercent("0"), 100);
  assert.equal(resolveCoverageMeasuredPercent("150"), 100);
  assert.equal(resolveCoverageMeasuredPercent("abc"), 100);
});
