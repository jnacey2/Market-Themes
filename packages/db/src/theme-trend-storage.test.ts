import assert from "node:assert/strict";
import test from "node:test";
import {
  fillThemeTrendHistoryGaps,
  isNoInformationTrendScore
} from "./persistence";

test("only windows with no intensity, no z-score, and no evidence are skipped", () => {
  assert.equal(isNoInformationTrendScore(0, 0, 0), true);
  assert.equal(isNoInformationTrendScore(0, -1.4, 0), false, "fading against a baseline is kept");
  assert.equal(isNoInformationTrendScore(0, 0, 1), false, "evidence rounding to zero intensity is kept");
  assert.equal(isNoInformationTrendScore(0.3, 0, 2), false);
});

test("history gaps are restored as zero points so the series stays contiguous", () => {
  const filled = fillThemeTrendHistoryGaps([
    { date: "2026-09-01", intensity: 1.2, baselineMean: 0.4, zScore: 2.1 },
    { date: "2026-09-04", intensity: 0, baselineMean: 0.5, zScore: -1.1 }
  ]);
  assert.deepEqual(
    filled.map((point) => [point.date, point.intensity, point.zScore]),
    [
      ["2026-09-01", 1.2, 2.1],
      ["2026-09-02", 0, 0],
      ["2026-09-03", 0, 0],
      ["2026-09-04", 0, -1.1]
    ]
  );
  assert.deepEqual(fillThemeTrendHistoryGaps([]), []);
  const single = [{ date: "2026-09-01", intensity: 0, baselineMean: 0, zScore: 0 }];
  assert.deepEqual(fillThemeTrendHistoryGaps(single), single);
});
