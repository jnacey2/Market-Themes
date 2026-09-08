import assert from "node:assert/strict";
import test from "node:test";
import type { EvalCaseFile } from "@market-themes/db";
import {
  buildNarrativeClassificationEvalRequests,
  evalCaseForCustomId,
  loadNarrativeClassificationEvalSuite,
  narrativeClassificationEvalCases,
  narrativeClassificationEvalDefinitions,
  scoreNarrativeClassificationEval,
  scoreStoredClassifierVerdicts
} from "./narrative-classification-eval";

function exportedFile(): EvalCaseFile {
  const document = (id: string, text: string) => ({
    id,
    sourceId: "newspaper-rss",
    sourceClass: "newspaper" as const,
    title: id,
    publisher: "Example",
    url: `https://example.com/${id}`,
    publishedAt: "2026-08-01T00:00:00.000Z",
    tickers: [],
    summary: "",
    metadata: {},
    text,
    textHash: id
  });
  return {
    version: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    model: "prod-model",
    promptVersion: "v1",
    definitions: narrativeClassificationEvalDefinitions,
    cases: [
      {
        id: "review:doc-1",
        labelSource: "review",
        expectedMatchedSlugs: ["pricing-power"],
        classifierMatchedSlugs: ["pricing-power"],
        rejectedSlugs: [],
        document: document("doc-1", "Prices rose 4% while volumes held.")
      },
      {
        id: "review:doc-2",
        labelSource: "review",
        expectedMatchedSlugs: [],
        classifierMatchedSlugs: ["consumer-trade-down"],
        rejectedSlugs: ["consumer-trade-down"],
        document: document("doc-2", "A seasonal promotion lifted traffic.")
      },
      {
        id: "recall:doc-3",
        labelSource: "unlabeled",
        expectedMatchedSlugs: ["credit-quality-deterioration"],
        classifierMatchedSlugs: [],
        rejectedSlugs: [],
        document: document("doc-3", "Charge-offs rose again this quarter.")
      },
      {
        id: "recall:doc-4",
        labelSource: "unlabeled",
        expectedMatchedSlugs: null,
        classifierMatchedSlugs: [],
        rejectedSlugs: [],
        document: document("doc-4", "Not yet labeled.")
      }
    ]
  };
}

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
  assert.equal(score.documentRecall, 1);
  assert.deepEqual(
    score.byLabelSource.map((stratum) => stratum.labelSource),
    ["manual"]
  );
});

test("loads exported real-document cases, skipping unlabeled ones", () => {
  const suite = loadNarrativeClassificationEvalSuite(exportedFile());

  assert.equal(suite.source, "file");
  assert.equal(suite.cases.length, 3);
  assert.equal(suite.unlabeledCases, 1);

  const requests = buildNarrativeClassificationEvalRequests("test-model", suite);
  assert.equal(requests.length, 3);
  assert.equal(evalCaseForCustomId("eval-3", suite)?.id, "recall:doc-3");
  assert.equal(evalCaseForCustomId("eval-3")?.id, "ai-demand-positive");
});

test("rejects exported labels that reference unknown definitions", () => {
  const file = exportedFile();
  file.cases[0].expectedMatchedSlugs = ["not-a-definition"];
  assert.throws(
    () => loadNarrativeClassificationEvalSuite(file),
    /unknown definition slugs: not-a-definition/
  );
});

test("scores stored production verdicts by label stratum and document recall", () => {
  const suite = loadNarrativeClassificationEvalSuite(exportedFile());
  const score = scoreStoredClassifierVerdicts(suite);

  // doc-1 true positive, doc-2 rejected false positive, doc-3 missed (recall miss).
  assert.equal(score.truePositive, 1);
  assert.equal(score.falsePositive, 1);
  assert.equal(score.falseNegative, 1);
  assert.equal(score.positiveCases, 2);
  assert.equal(score.documentRecall, 0.5);

  const review = score.byLabelSource.find((stratum) => stratum.labelSource === "review")!;
  const recall = score.byLabelSource.find((stratum) => stratum.labelSource === "unlabeled")!;
  assert.equal(review.precision, 0.5);
  assert.equal(review.recall, 1);
  assert.equal(recall.recall, 0);
  assert.equal(recall.falseNegative, 1);
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
