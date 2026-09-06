import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveMaxHistoricalReviewWindows,
  resolveRecentObservationHours,
  resolveStructuralAutoReviewOptions
} from "./narratives";

test("structural tier defaults to a looser gate restricted to structural definitions", () => {
  assert.deepEqual(resolveStructuralAutoReviewOptions({}), {
    kinds: ["structural"],
    tier: "structural",
    minimumMatchScore: 70,
    minimumDocuments: 2,
    minimumPublisherOwners: 2,
    lookbackDays: 14
  });
});

test("structural tier reads its own env and can be disabled", () => {
  assert.equal(
    resolveStructuralAutoReviewOptions({ NARRATIVE_AUTO_REVIEW_STRUCTURAL_ENABLED: "false" }),
    null
  );
  const options = resolveStructuralAutoReviewOptions({
    NARRATIVE_AUTO_REVIEW_STRUCTURAL_MIN_SCORE: "75",
    NARRATIVE_AUTO_REVIEW_STRUCTURAL_LOOKBACK_DAYS: "21",
    // The default tier's settings must not leak into the structural tier.
    NARRATIVE_AUTO_REVIEW_MIN_SCORE: "95"
  });
  assert.equal(options?.minimumMatchScore, 75);
  assert.equal(options?.lookbackDays, 21);
  assert.deepEqual(options?.kinds, ["structural"]);
});

test("recent-observation sweep defaults to a day and can be disabled or capped", () => {
  assert.equal(resolveRecentObservationHours({}), 24);
  assert.equal(resolveRecentObservationHours({ NARRATIVE_AUTO_REVIEW_RECENT_OBSERVATION_HOURS: "0" }), 0);
  assert.equal(resolveRecentObservationHours({ NARRATIVE_AUTO_REVIEW_RECENT_OBSERVATION_HOURS: "6" }), 6);
  assert.equal(resolveRecentObservationHours({ NARRATIVE_AUTO_REVIEW_RECENT_OBSERVATION_HOURS: "-1" }), 24);
  assert.equal(resolveMaxHistoricalReviewWindows({}), 120);
  assert.equal(resolveMaxHistoricalReviewWindows({ NARRATIVE_AUTO_REVIEW_MAX_HISTORICAL_WINDOWS: "30" }), 30);
  assert.equal(resolveMaxHistoricalReviewWindows({ NARRATIVE_AUTO_REVIEW_MAX_HISTORICAL_WINDOWS: "0" }), 120);
});
