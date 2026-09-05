import type { NarrativeTrendPoint } from "@market-themes/db";

export const CHART_HORIZONS = [7, 30, 90] as const;
export type ChartHorizon = (typeof CHART_HORIZONS)[number];

type HistoryPoint = Pick<NarrativeTrendPoint, "lifecycleState"> &
  Partial<Pick<NarrativeTrendPoint, "density" | "attentionDensity">>;

export function countMeasuredDays(history: Pick<NarrativeTrendPoint, "lifecycleState">[]) {
  return history.filter((point) => point.lifecycleState !== "unmeasured").length;
}

/**
 * Days from the first point with any signal (reviewed or raw attention) to the
 * end of the series. A backfilled event narrative has weeks of measured zeros
 * before the event; those are history, but not something worth a 90-day axis.
 */
export function activeSpanDays(history: HistoryPoint[]) {
  const first = history.findIndex(
    (point) =>
      point.lifecycleState !== "unmeasured" &&
      ((point.density ?? 0) > 0 || (point.attentionDensity ?? 0) > 0)
  );
  return first < 0 ? 0 : history.length - first;
}

/**
 * Pick the shortest chart range that still shows everything that happened, so
 * a narrative whose signal is nine days old opens on 30d instead of a 90-day
 * axis with one spike at the right edge.
 */
export function defaultChartHorizon(history: HistoryPoint[]): ChartHorizon {
  const span = activeSpanDays(history);
  for (const horizon of CHART_HORIZONS) {
    if (span <= horizon) return horizon;
  }
  return CHART_HORIZONS[CHART_HORIZONS.length - 1];
}
