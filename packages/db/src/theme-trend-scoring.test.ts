import assert from "node:assert/strict";
import test from "node:test";
import {
  buildThemeTrendSeries,
  scoreTrendWindow,
  scoreTrendWindowAt,
  type DailyTrendBucket
} from "./persistence";
import type { SourceClass } from "./types";

function isoDate(base: Date, offset: number) {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** Deterministic pseudo-random generator so failures are reproducible. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SOURCE_CLASSES: SourceClass[] = ["newspaper", "filing", "transcript"];

function randomBuckets(dates: string[], density: number, random: () => number) {
  const buckets = new Map<string, DailyTrendBucket>();
  for (const date of dates) {
    if (random() > density) continue;
    const sourceClasses = new Set<SourceClass>();
    const sourceMix: Partial<Record<SourceClass, number>> = {};
    const documentIds = new Set<string>();
    const entities = new Set<string>();
    const evidenceCount = 1 + Math.floor(random() * 4);
    let baseIntensity = 0;
    for (let index = 0; index < evidenceCount; index += 1) {
      const sourceClass = SOURCE_CLASSES[Math.floor(random() * SOURCE_CLASSES.length)];
      sourceClasses.add(sourceClass);
      sourceMix[sourceClass] = (sourceMix[sourceClass] ?? 0) + 1;
      documentIds.add(`doc-${date}-${Math.floor(random() * 3)}`);
      if (random() > 0.4) entities.add(`entity-${Math.floor(random() * 5)}`);
      baseIntensity += Math.round(random() * 300) / 100;
    }
    buckets.set(date, {
      date,
      baseIntensity,
      intensity: baseIntensity * (1 + Math.min(sourceClasses.size - 1, 3) * 0.05),
      evidenceCount,
      documentIds,
      sourceMix,
      sourceClasses,
      entities
    });
  }
  return buckets;
}

test("precomputed scorer matches the reference scorer for every date and window", () => {
  const base = new Date("2026-06-01T00:00:00.000Z");
  const random = rng(20260904);
  for (const [lookbackDays, storageDays, density] of [
    [120, 45, 0.15],
    [60, 45, 0.6],
    [30, 45, 0.3], // storage window starts before the lookback
    [90, 20, 0.02]
  ] as const) {
    const asOfIndex = 200;
    const startDate = isoDate(base, asOfIndex - (lookbackDays - 1));
    const storageStartDate = isoDate(base, asOfIndex - (storageDays - 1));
    const asOfDate = isoDate(base, asOfIndex);
    const seriesStart = storageStartDate < startDate ? storageStartDate : startDate;
    const allDates: string[] = [];
    for (let cursor = seriesStart; cursor <= asOfDate; cursor = isoDate(new Date(`${cursor}T00:00:00.000Z`), 1)) {
      allDates.push(cursor);
    }
    // Signals outside the lookback are never bucketed by groupSignalsByTheme.
    const buckets = randomBuckets(allDates.filter((date) => date >= startDate), density, random);
    const series = buildThemeTrendSeries(buckets, allDates);
    const baselineStartIndex = allDates.indexOf(startDate);

    for (const trendLevel of ["market", "sector", "unmapped"] as const) {
      for (const windowDays of [7, 30]) {
        for (const date of allDates.filter((entry) => entry >= storageStartDate)) {
          const reference = scoreTrendWindow(buckets, date, windowDays, 14, trendLevel, startDate);
          const fast = scoreTrendWindowAt(
            series,
            allDates.indexOf(date),
            windowDays,
            14,
            trendLevel,
            baselineStartIndex
          );
          assert.deepEqual(
            fast,
            reference,
            `lookback=${lookbackDays} storage=${storageDays} window=${windowDays} date=${date} level=${trendLevel}`
          );
        }
      }
    }
  }
});

test("empty windows score as no information and dense windows carry evidence", () => {
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];
  const empty = buildThemeTrendSeries(new Map(), dates);
  const score = scoreTrendWindowAt(empty, 2, 7, 14, "market");
  assert.equal(score.intensity, 0);
  assert.equal(score.zScore, 0);
  assert.equal(score.sourceMix.evidenceCount, 0);
  assert.equal(score.lowHistory, true);

  const buckets = randomBuckets(dates, 1, rng(7));
  const dense = buildThemeTrendSeries(buckets, dates);
  const scored = scoreTrendWindowAt(dense, 2, 7, 14, "sector");
  assert.ok(scored.intensity > 0);
  assert.ok(scored.sourceMix.evidenceCount >= 3);
});
