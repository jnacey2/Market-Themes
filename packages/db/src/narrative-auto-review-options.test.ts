import assert from "node:assert/strict";
import test from "node:test";
import { resolveStructuralAutoReviewOptions } from "./narratives";

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
