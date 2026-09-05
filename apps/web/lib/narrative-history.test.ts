import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeLifecycleState } from "@market-themes/db";
import { countMeasuredDays, defaultChartHorizon } from "./narrative-history";

function history(states: NarrativeLifecycleState[]) {
  return states.map((lifecycleState) => ({ lifecycleState }));
}

test("the chart opens on the shortest range that shows all measured history", () => {
  assert.equal(defaultChartHorizon([]), 7);
  assert.equal(defaultChartHorizon(history(Array(5).fill("steady"))), 7);
  assert.equal(defaultChartHorizon(history(Array(9).fill("peaking"))), 30);
  assert.equal(defaultChartHorizon(history(Array(30).fill("steady"))), 30);
  assert.equal(defaultChartHorizon(history(Array(31).fill("steady"))), 90);
  assert.equal(defaultChartHorizon(history(Array(120).fill("steady"))), 90);
});

test("unmeasured days do not count as history", () => {
  const points = history([
    ...Array<NarrativeLifecycleState>(80).fill("unmeasured"),
    ...Array<NarrativeLifecycleState>(6).fill("emerging")
  ]);
  assert.equal(countMeasuredDays(points), 6);
  assert.equal(defaultChartHorizon(points), 7);
});
