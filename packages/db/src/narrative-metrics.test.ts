import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNarrativeTrendSeries,
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
  assert.equal(point.lowHistory, true);
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
    sourceClass,
    affectedEntities: matched ? ["Example"] : []
  };
}

const dates = Array.from({ length: 60 }, (_, i) =>
  new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10)
);
function stableRows() {
  return dates.flatMap((date, i) =>
    [true, false].map((matched, j) => ({
      ...observation(`${i}:${j}`, "newspaper", matched, "Publisher", "Owner"),
      date
    }))
  );
}
test("missing days cannot manufacture a fall from a stable 50 percent series", () => {
  const rows = stableRows().filter((row) => row.date < dates.at(-3)!);
  const point = calculateNarrativeTrendSeries(rows, dates, 7, 20).at(-1)!;
  assert.equal(point.density, 50);
  assert.equal(point.coveredDays, 4);
  assert.equal(point.coverageComplete, false);
  assert.equal(point.comparisonReady, false);
  assert.equal(point.change, 0);
  assert.equal(point.zScoreAvailable, false);
});
test("pending reviews and missing classifications both suppress comparisons", () => {
  const rows = stableRows();
  rows.at(-2)!.matched = false;
  const pending = rows.map((row, i) => ({
    ...row,
    reviewPending: i === rows.length - 2
  }));
  assert.equal(
    calculateNarrativeTrendSeries(pending, dates, 7, 20).at(-1)!
      .comparisonReady,
    false
  );
  const corpus = dates.map((date) => ({
    date,
    expectedDocuments: date === dates.at(-1) ? 3 : 2
  }));
  assert.equal(
    calculateNarrativeTrendSeries(rows, dates, 7, 20, corpus).at(-1)!
      .coverageComplete,
    false
  );
});
test("a fully observed disappearance remains a measured decline", () => {
  const rows = stableRows().map((row) => ({
    ...row,
    matched: row.date > dates.at(-8)! ? false : row.matched
  }));
  const point = calculateNarrativeTrendSeries(rows, dates, 7, 20).at(-1)!;
  assert.equal(point.comparisonReady, true);
  assert.equal(point.change, -50);
  assert.equal(point.percentileRank, 0);
  assert.equal(point.zScoreAvailable, false); // flat baseline cannot support a z-score
});
test("ties use midpoint percentile and tone includes genuine zeros", () => {
  const point = calculateNarrativeTrendSeries(stableRows(), dates, 7, 20).at(
    -1
  )!;
  assert.equal(point.percentileRank, 50);
  assert.equal(point.zScoreAvailable, false);
  const rows = [
    observation("a", "newspaper", true, "a", "a"),
    { ...observation("b", "newspaper", true, "b", "b"), riskTone: 0 }
  ];
  assert.equal(
    calculateNarrativeTrendSeries(rows, [dates[0]], 1, 1)[0].riskTone,
    30
  );
});
test("a source class entering the corpus invalidates adjacent comparisons", () => {
  const rows = stableRows();
  rows.push({
    ...observation("new-source", "filing", true, "issuer", "issuer"),
    date: dates.at(-1)!
  });
  assert.equal(
    calculateNarrativeTrendSeries(rows, dates, 7, 20).at(-1)!.comparisonReady,
    false
  );
});
