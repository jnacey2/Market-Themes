import type { NarrativeTrendPoint } from "@market-themes/db";

export const CHART_HORIZONS = [7, 30, 90] as const;
export type ChartHorizon = (typeof CHART_HORIZONS)[number];

export function countMeasuredDays(history: Pick<NarrativeTrendPoint, "lifecycleState">[]) {
  return history.filter((point) => point.lifecycleState !== "unmeasured").length;
}

/**
 * Pick the shortest chart range that still shows all measured history, so a
 * narrative that is nine days old opens on 30d instead of a 90-day axis with
 * one spike at the right edge.
 */
export function defaultChartHorizon(
  history: Pick<NarrativeTrendPoint, "lifecycleState">[]
): ChartHorizon {
  const measured = countMeasuredDays(history);
  for (const horizon of CHART_HORIZONS) {
    if (measured <= horizon) return horizon;
  }
  return CHART_HORIZONS[CHART_HORIZONS.length - 1];
}
