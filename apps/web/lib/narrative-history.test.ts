import assert from "node:assert/strict";
import test from "node:test";
import type { NarrativeLifecycleState } from "@market-themes/db";
import { activeSpanDays, countMeasuredDays, defaultChartHorizon } from "./narrative-history";

function history(
  states: NarrativeLifecycleState[],
  density: (index: number) => number = () => 1
) {
  return states.map((lifecycleState, index) => ({
    lifecycleState,
    density: lifecycleState === "unmeasured" ? 0 : density(index),
    attentionDensity: 0
  }));
}

test("the chart opens on the shortest range that shows everything that happened", () => {
  assert.equal(defaultChartHorizon([]), 7);
  assert.equal(defaultChartHorizon(history(Array(5).fill("steady"))), 7);
  assert.equal(defaultChartHorizon(history(Array(9).fill("peaking"))), 30);
  assert.equal(defaultChartHorizon(history(Array(30).fill("steady"))), 30);
  assert.equal(defaultChartHorizon(history(Array(31).fill("steady"))), 90);
  assert.equal(defaultChartHorizon(history(Array(120).fill("steady"))), 90);
});

test("backfilled measured zeros before the first signal do not widen the axis", () => {
  // 60 days of measured history, but the narrative only had evidence in the last 9.
  const points = history(Array<NarrativeLifecycleState>(60).fill("steady"), (index) =>
    index >= 51 ? 2 : 0
  );
  assert.equal(countMeasuredDays(points), 60);
  assert.equal(activeSpanDays(points), 9);
  assert.equal(defaultChartHorizon(points), 30);
});

test("raw attention counts as signal even before review approves anything", () => {
  const points = Array.from({ length: 20 }, (_, index) => ({
    lifecycleState: "dormant" as NarrativeLifecycleState,
    density: 0,
    attentionDensity: index >= 15 ? 3 : 0
  }));
  assert.equal(activeSpanDays(points), 5);
  assert.equal(defaultChartHorizon(points), 7);
});

test("unmeasured days do not count as history", () => {
  const points = history([
    ...Array<NarrativeLifecycleState>(80).fill("unmeasured"),
    ...Array<NarrativeLifecycleState>(6).fill("emerging")
  ]);
  assert.equal(countMeasuredDays(points), 6);
  assert.equal(defaultChartHorizon(points), 7);
});
