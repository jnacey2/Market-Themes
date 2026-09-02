import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateNarrativeClassifier,
  parseEvaluationArgs
} from "./evaluate-narrative-classifier";

test("parses classifier evaluation model and result batch", () => {
  assert.deepEqual(
    parseEvaluationArgs([
      "--batch-id",
      "msgbatch_test",
      "--model",
      "comparison-model"
    ]),
    {
      batchId: "msgbatch_test",
      model: "comparison-model",
      submit: false
    }
  );
});

test("defaults classifier evaluation to Haiku", () => {
  assert.deepEqual(parseEvaluationArgs([]), {
    batchId: null,
    model: "claude-haiku-4-5-20251001",
    submit: false
  });
  assert.equal(parseEvaluationArgs(["--submit"]).submit, true);
  assert.throws(
    () => parseEvaluationArgs(["--unknown"]),
    /Unknown or incomplete/
  );
});

test("dry-runs without an API key or billable request", async () => {
  const prior = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await evaluateNarrativeClassifier([]);
    assert.equal(result.action, "dry_run");
    assert.equal("requestCount" in result ? result.requestCount : null, 10);
  } finally {
    if (prior === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prior;
  }
});
