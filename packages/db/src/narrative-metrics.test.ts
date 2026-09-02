import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNarrativeTrendSeries,
  deriveNarrativeCoverageState,
  type NarrativeMetricObservation
} from "./narrative-metrics";

test("normalizes density by eligible corpus within each source class", () => {
  const rows: NarrativeMetricObservation[] = [
    observation("a", "newspaper", true, "Publisher A", "Owner A"),
    observation("b", "newspaper", false, "Publisher B", "Owner B"),
    observation("c", "filing", true, "Issuer C", "Issuer C")
  ];
  const [point] = calculateNarrativeTrendSeries(rows, ["2026-01-01"], 1, 2);

  assert.equal(point.density, 75);
  assert.equal(point.eligibleDocuments, 3);
  assert.equal(point.matchedDocuments, 2);
  assert.equal(point.lowHistory, true);
  assert.equal(point.zScore, 0);
  assert.equal(point.percentileRank, 0);
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
  const [point] = calculateNarrativeTrendSeries(
    rows,
    ["2026-01-01"],
    1,
    2
  );

  assert.equal(point.matchedDocuments, 2);
  assert.equal(point.publisherOwnerBreadth, 2);
  assert.equal(point.storyBreadth, 1);
});

test("does not rank an uncovered or unmatched window as unusual", () => {
  const rows = [observation("a", "newspaper", true, "Publisher A", "Owner A")];
  const points = calculateNarrativeTrendSeries(
    rows,
    ["2026-01-01", "2026-01-02"],
    1,
    1
  );
  const noCoverage = points[1];

  assert.equal(noCoverage.eligibleDocuments, 0);
  assert.equal(noCoverage.zScore, 0);
  assert.equal(noCoverage.percentileRank, 0);
  assert.equal(noCoverage.change, 0);
  assert.equal(noCoverage.lowHistory, true);

  const unmatched = calculateNarrativeTrendSeries(
    [observation("b", "newspaper", false, "Publisher B", "Owner B")],
    ["2026-01-01"],
    1,
    1
  )[0];
  assert.equal(unmatched.percentileRank, 0);
  assert.equal(unmatched.zScore, 0);
});

test("suppresses movement while classification coverage is incomplete", () => {
  const rows = [
    observation("classified", "newspaper", true, "Publisher", "Owner")
  ];
  const [point] = calculateNarrativeTrendSeries(
    rows,
    ["2026-01-01"],
    1,
    1,
    [
      {
        date: "2026-01-01",
        documentId: "classified",
        sourceClass: "newspaper"
      },
      {
        date: "2026-01-01",
        documentId: "pending",
        sourceClass: "newspaper"
      }
    ]
  );

  assert.equal(point.coverageState, "backfill_pending");
  assert.equal(point.classificationCoveragePercent, 50);
  assert.equal(point.lowHistory, true);
  assert.equal(point.zScore, 0);
  assert.equal(point.change, 0);
});

test("distinguishes backfill, measured zero, measured, and empty coverage", () => {
  assert.deepEqual(deriveNarrativeCoverageState({
    corpusEligibleDocuments: 0,
    classifiedDocuments: 0,
    matchedDocuments: 0
  }), {
    classificationCoveragePercent: 0,
    coverageState: "no_corpus"
  });
  assert.deepEqual(deriveNarrativeCoverageState({
    corpusEligibleDocuments: 10,
    classifiedDocuments: 0,
    matchedDocuments: 0
  }), {
    classificationCoveragePercent: 0,
    coverageState: "backfill_pending"
  });
  assert.deepEqual(deriveNarrativeCoverageState({
    corpusEligibleDocuments: 10,
    classifiedDocuments: 8,
    matchedDocuments: 1
  }), {
    classificationCoveragePercent: 80,
    coverageState: "backfill_pending"
  });
  assert.deepEqual(deriveNarrativeCoverageState({
    corpusEligibleDocuments: 10,
    classifiedDocuments: 10,
    matchedDocuments: 0
  }), {
    classificationCoveragePercent: 100,
    coverageState: "measured_zero"
  });
  assert.deepEqual(deriveNarrativeCoverageState({
    corpusEligibleDocuments: 10,
    classifiedDocuments: 10,
    matchedDocuments: 1
  }), {
    classificationCoveragePercent: 100,
    coverageState: "measured"
  });
});

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
