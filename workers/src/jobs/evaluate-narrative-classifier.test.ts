import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EvalCaseFile } from "@market-themes/db";
import { narrativeClassificationEvalDefinitions } from "@market-themes/analysis";
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
      casesPath: null,
      submit: false,
      offline: false
    }
  );
});

test("defaults classifier evaluation to Haiku", () => {
  assert.deepEqual(parseEvaluationArgs([]), {
    batchId: null,
    model: "claude-haiku-4-5-20251001",
    casesPath: null,
    submit: false,
    offline: false
  });
  assert.equal(parseEvaluationArgs(["--submit"]).submit, true);
  assert.equal(parseEvaluationArgs(["--offline"]).offline, true);
  assert.equal(parseEvaluationArgs(["--cases", "eval/cases.json"]).casesPath, "eval/cases.json");
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

test("scores exported real-document cases offline from stored verdicts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "narrative-eval-"));
  const path = join(directory, "cases.json");
  const file: EvalCaseFile = {
    version: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    model: "prod",
    promptVersion: "v1",
    definitions: narrativeClassificationEvalDefinitions,
    cases: [
      {
        id: "review:a",
        labelSource: "review",
        expectedMatchedSlugs: ["pricing-power"],
        classifierMatchedSlugs: ["pricing-power"],
        rejectedSlugs: [],
        document: {
          id: "a",
          sourceId: "s",
          sourceClass: "newspaper",
          title: "a",
          publisher: "p",
          url: "https://example.com/a",
          publishedAt: "2026-08-01T00:00:00.000Z",
          tickers: [],
          summary: "",
          metadata: {},
          text: "Prices rose while volumes held.",
          textHash: "a"
        }
      },
      {
        id: "recall:b",
        labelSource: "unlabeled",
        expectedMatchedSlugs: null,
        classifierMatchedSlugs: [],
        rejectedSlugs: [],
        document: {
          id: "b",
          sourceId: "s",
          sourceClass: "newspaper",
          title: "b",
          publisher: "p",
          url: "https://example.com/b",
          publishedAt: "2026-08-01T00:00:00.000Z",
          tickers: [],
          summary: "",
          metadata: {},
          text: "Unlabeled.",
          textHash: "b"
        }
      }
    ]
  };
  await writeFile(path, JSON.stringify(file));

  const result = await evaluateNarrativeClassifier(["--offline", "--cases", path]);
  assert.equal(result.action, "scored_stored_verdicts");
  assert.equal(result.suite?.labeledCases, 1);
  assert.equal(result.suite?.unlabeledCases, 1);
  assert.equal(result.score?.truePositive, 1);

  const dryRun = await evaluateNarrativeClassifier(["--cases", path]);
  assert.equal(dryRun.action, "dry_run");
  assert.equal("requestCount" in dryRun ? dryRun.requestCount : null, 1);
  assert.match(
    "submitCommand" in dryRun ? String(dryRun.submitCommand) : "",
    /--cases /
  );

  await assert.rejects(
    evaluateNarrativeClassifier(["--offline"]),
    /--offline requires --cases/
  );
});
