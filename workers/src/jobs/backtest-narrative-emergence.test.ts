import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTruth, parseBacktestArgs } from "./backtest-narrative-emergence";
import { parseExportArgs } from "./export-eval-cases";

test("parses backtest arguments with sensible defaults", () => {
  assert.deepEqual(parseBacktestArgs([]), {
    window: "7d",
    signalZ: 2,
    truthPath: null,
    promptVersion: null,
    format: "table",
    includeExpired: false,
    slugs: []
  });
  const parsed = parseBacktestArgs([
    "--window",
    "30d",
    "--z",
    "1.5",
    "--truth",
    "eval/truth.json",
    "--slug",
    "a",
    "--slug",
    "b",
    "--json",
    "--include-expired"
  ]);
  assert.equal(parsed.window, "30d");
  assert.equal(parsed.signalZ, 1.5);
  assert.equal(parsed.truthPath, "eval/truth.json");
  assert.deepEqual(parsed.slugs, ["a", "b"]);
  assert.equal(parsed.format, "json");
  assert.equal(parsed.includeExpired, true);
  assert.throws(() => parseBacktestArgs(["--window", "1d"]), /7d or 30d/);
  assert.throws(() => parseBacktestArgs(["--z", "-1"]), /positive/);
  assert.throws(() => parseBacktestArgs(["--nope"]), /Unknown or incomplete/);
});

test("validates truth files as slug to ISO date maps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "emergence-truth-"));
  const good = join(directory, "good.json");
  const bad = join(directory, "bad.json");
  await writeFile(good, JSON.stringify({ "pricing-power": "2026-03-01" }));
  await writeFile(bad, JSON.stringify({ "pricing-power": "March 1" }));

  assert.deepEqual(await loadTruth(good), { "pricing-power": "2026-03-01" });
  await assert.rejects(loadTruth(bad), /YYYY-MM-DD/);
});

test("parses eval export arguments", () => {
  assert.deepEqual(parseExportArgs([]), {
    out: "eval/narrative-eval-cases.json",
    export: {}
  });
  const parsed = parseExportArgs([
    "--out",
    "tmp/cases.json",
    "--unlabeled",
    "25",
    "--reviewed-per-definition",
    "3",
    "--lookback-days",
    "90",
    "--source-class",
    "newspaper",
    "--source-class",
    "transcript",
    "--model",
    "m",
    "--prompt-version",
    "v9"
  ]);
  assert.equal(parsed.out, "tmp/cases.json");
  assert.deepEqual(parsed.export, {
    unlabeledSample: 25,
    reviewedPerDefinition: 3,
    lookbackDays: 90,
    sourceClasses: ["newspaper", "transcript"],
    model: "m",
    promptVersion: "v9"
  });
  assert.throws(() => parseExportArgs(["--unlabeled", "lots"]), /non-negative number/);
});
