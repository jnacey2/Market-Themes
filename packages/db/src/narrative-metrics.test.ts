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
