import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatEmergenceBacktestTable,
  summarizeEmergenceBacktest,
  type NarrativeEmergenceTimeline
} from "./narrative-backtest";

function timeline(
  overrides: Partial<NarrativeEmergenceTimeline> & { slug: string }
): NarrativeEmergenceTimeline {
  return {
    definitionId: `narrative:def:${overrides.slug}:v1`,
    name: overrides.slug,
    status: "active",
    kind: "structural",
    createdAt: "2026-03-10T12:00:00.000Z",
    activatedAt: null,
    firstEvidenceDate: null,
    firstAttentionSignalDate: null,
    firstReviewedSignalDate: null,
    firstEmergingDate: null,
    firstRisingDate: null,
    firstFadingDate: null,
    peakDate: null,
    latestDate: "2026-04-01",
    latestState: "steady",
    trendDays: 30,
    ...overrides
  };
}

test("lead versus definition is positive when the attention signal preceded the definition", () => {
  const summary = summarizeEmergenceBacktest([
    timeline({
      slug: "early",
      createdAt: "2026-03-10T12:00:00.000Z",
      firstAttentionSignalDate: "2026-03-01",
      firstEmergingDate: "2026-03-12"
    })
  ]);

  const [row] = summary.rows;
  assert.equal(row.attentionLeadVsDefinitionDays, 9);
  assert.equal(row.emergingLeadVsDefinitionDays, -2);
  assert.equal(summary.withAttentionSignal, 1);
  assert.equal(summary.withEmergingState, 1);
  assert.equal(summary.withTruth, 0);
  assert.equal(summary.medianAttentionLagVsTruthDays, null);
});

test("lag versus truth is negative when detection fired before the asserted emergence date", () => {
  const summary = summarizeEmergenceBacktest(
    [
      timeline({
        slug: "a",
        firstAttentionSignalDate: "2026-02-20",
        firstEmergingDate: "2026-03-05",
        firstReviewedSignalDate: "2026-03-20"
      }),
      timeline({
        slug: "b",
        firstAttentionSignalDate: "2026-03-30",
        firstEmergingDate: "2026-04-10"
      }),
      timeline({ slug: "no-truth", firstAttentionSignalDate: "2026-03-01" })
    ],
    { a: "2026-03-01", b: "2026-03-01" }
  );

  const a = summary.rows.find((row) => row.slug === "a")!;
  const b = summary.rows.find((row) => row.slug === "b")!;
  assert.equal(a.attentionLagVsTruthDays, -9);
  assert.equal(a.emergingLagVsTruthDays, 4);
  assert.equal(a.reviewedLagVsTruthDays, 19);
  assert.equal(b.attentionLagVsTruthDays, 29);
  assert.equal(b.emergingLagVsTruthDays, 40);

  assert.equal(summary.withTruth, 2);
  assert.equal(summary.medianAttentionLagVsTruthDays, 10);
  assert.equal(summary.medianEmergingLagVsTruthDays, 22);
  assert.equal(summary.medianReviewedLagVsTruthDays, 19);
  assert.equal(summary.attentionWithin7DaysOfTruth, 0.5);
  assert.equal(summary.attentionWithin14DaysOfTruth, 0.5);
  assert.equal(summary.emergingWithin14DaysOfTruth, 0.5);
});

test("missing detector dates yield null lags rather than zeros", () => {
  const summary = summarizeEmergenceBacktest([timeline({ slug: "silent" })], {
    silent: "2026-03-01"
  });
  const [row] = summary.rows;
  assert.equal(row.attentionLagVsTruthDays, null);
  assert.equal(row.attentionLeadVsDefinitionDays, null);
  assert.equal(summary.attentionWithin7DaysOfTruth, 0);
});

test("table output lists every narrative and the aggregate lines", () => {
  const summary = summarizeEmergenceBacktest(
    [
      timeline({
        slug: "alpha",
        firstAttentionSignalDate: "2026-03-01",
        peakDate: "2026-03-20",
        firstFadingDate: "2026-03-28",
        latestState: "fading"
      })
    ],
    { alpha: "2026-03-03" }
  );
  const table = formatEmergenceBacktestTable(summary);

  assert.match(table, /^slug\s+defined\s+evidence\s+attention/);
  assert.match(table, /alpha\s+2026-03-10\s+-\s+2026-03-01/);
  assert.match(table, /fading/);
  assert.match(table, /\+9d/);
  assert.match(table, /-2d/);
  assert.match(table, /median lag vs truth/);
});
