import assert from "node:assert/strict";
import test from "node:test";
import { autoReviewNarratives } from "./auto-review-narratives";

test("automatic review is fail-closed unless explicitly enabled", async () => {
  const previous = process.env.NARRATIVE_AUTO_REVIEW_ENABLED;
  delete process.env.NARRATIVE_AUTO_REVIEW_ENABLED;
  try {
    assert.deepEqual(await autoReviewNarratives(), {
      enabled: false,
      approvedObservations: 0,
      narrativesTouched: 0,
      candidatesPromoted: 0,
      candidatesBlocked: 0,
      candidateObservationsCreated: 0
    });
  } finally {
    if (previous === undefined) {
      delete process.env.NARRATIVE_AUTO_REVIEW_ENABLED;
    } else {
      process.env.NARRATIVE_AUTO_REVIEW_ENABLED = previous;
    }
  }
});
