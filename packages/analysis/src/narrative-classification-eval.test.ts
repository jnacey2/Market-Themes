import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNarrativeClassificationEvalRequests,
  evalCaseForCustomId,
  narrativeClassificationEvalCases,
  scoreNarrativeClassificationEval
} from "./narrative-classification-eval";

test("scores a perfect human-labeled classification run", () => {
  const score = scoreNarrativeClassificationEval(
    narrativeClassificationEvalCases.map((item) => ({
      caseId: item.id,
      matchedSlugs: item.expectedMatchedSlugs
    }))
  );

  assert.equal(score.precision, 1);
  assert.equal(score.recall, 1);
  assert.equal(score.f1, 1);
  assert.equal(score.accuracy, 1);
});

test("penalizes false positives and false negatives", () => {
  const score = scoreNarrativeClassificationEval([
    {
      caseId: "pricing-positive",
      matchedSlugs: []
    },
    {
      caseId: "promotion-negative",
      matchedSlugs: ["consumer-trade-down"]
    }
  ]);

  assert(score.falsePositive >= 1);
  assert(score.falseNegative >= 1);
  assert(score.f1 < 1);
});

test("builds stable batch requests for every labeled case", () => {
  const requests = buildNarrativeClassificationEvalRequests("test-model");

  assert.equal(requests.length, narrativeClassificationEvalCases.length);
  assert.equal(new Set(requests.map((request) => request.custom_id)).size, requests.length);
  assert.equal(evalCaseForCustomId(requests[0].custom_id)?.id, "pricing-positive");
  const content = requests[0].params.messages[0].content;
  assert(
    Array.isArray(content) &&
      "cache_control" in content[0] &&
      content[0].cache_control?.ttl === "1h"
  );
});
