import assert from "node:assert/strict";
import test from "node:test";
import { selectStages, type PipelineStage } from "./run-pipeline";

const stages: PipelineStage[] = [
  { name: "extract", script: "extract", enabled: () => true },
  { name: "normalize", script: "normalize", enabled: () => true },
  { name: "trends", script: "trends", enabled: () => true }
];

test("resumes an isolated pipeline from the requested stage", () => {
  const previous = process.env.PIPELINE_START_AT;
  process.env.PIPELINE_START_AT = "normalize";
  try {
    assert.deepEqual(
      selectStages(stages).map((stage) => stage.name),
      ["normalize", "trends"]
    );
  } finally {
    restoreEnvironment("PIPELINE_START_AT", previous);
  }
});

test("rejects an unknown resume stage", () => {
  const previous = process.env.PIPELINE_START_AT;
  process.env.PIPELINE_START_AT = "unknown";
  try {
    assert.throws(() => selectStages(stages), /PIPELINE_START_AT=unknown is invalid/);
  } finally {
    restoreEnvironment("PIPELINE_START_AT", previous);
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
