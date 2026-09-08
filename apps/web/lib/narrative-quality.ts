import type { NarrativeTrendSummary } from "@market-themes/db";

export function measurementStatus(narrative: NarrativeTrendSummary) {
  if (narrative.measurementPending) return "Refresh pending";
  if (!narrative.latestDate || narrative.eligibleDocuments === 0)
    return "No recent coverage";
  if (narrative.pendingReview)
    return `${narrative.pendingReview} awaiting review`;
  if (!narrative.coverageComplete) return "Incomplete coverage";
  if (narrative.lowHistory) return "Building baseline";
  if (!narrative.comparisonReady) return "Comparison unavailable";
  return "Measured";
}

export function densityReady(narrative: NarrativeTrendSummary) {
  return narrative.coverageComplete && !narrative.measurementPending;
}
