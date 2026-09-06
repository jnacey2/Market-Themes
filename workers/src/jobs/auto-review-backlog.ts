import { pathToFileURL } from "node:url";
import {
  autoApproveNarrativeObservations,
  resolveStructuralAutoReviewOptions
} from "@market-themes/db";

/**
 * One-off backlog pass. The scheduled auto-review anchors its corroboration
 * window at "now", so evidence that was classified months after publication
 * (definition backfills) never qualified: two stories from July are not
 * "within 7 days" of today. Step a window through history instead, judging
 * each week's evidence against its own neighbours.
 *
 *   AUTO_REVIEW_BACKLOG_SINCE=2025-09-01 npm run narratives:auto-review-backlog --workspace @market-themes/workers
 */
export async function autoReviewBacklog(input: {
  since: Date;
  until?: Date;
  stepDays?: number;
}) {
  const until = input.until ?? new Date();
  const stepDays = input.stepDays ?? 7;
  const structural = resolveStructuralAutoReviewOptions();
  const passes: Array<{
    windowEnd: string;
    tier: string;
    approvedObservations: number;
    narrativesTouched: number;
  }> = [];
  let approvedObservations = 0;
  const windowEnds: Date[] = [];
  for (
    let cursor = new Date(input.since);
    cursor < until;
    cursor = new Date(cursor.getTime() + stepDays * 86_400_000)
  ) {
    windowEnds.push(cursor);
  }
  // Always finish with a window anchored at `until` so the most recent days are covered.
  windowEnds.push(until);
  for (const windowEnd of windowEnds) {
    const tiers = [
      { windowEnd, tier: "default" as const },
      ...(structural ? [{ ...structural, windowEnd }] : [])
    ];
    for (const options of tiers) {
      const result = await autoApproveNarrativeObservations(options);
      approvedObservations += result.approvedObservations;
      if (result.approvedObservations > 0) {
        passes.push({
          windowEnd: windowEnd.toISOString().slice(0, 10),
          tier: result.tier,
          approvedObservations: result.approvedObservations,
          narrativesTouched: result.narrativesTouched
        });
      }
    }
  }
  const summary = { since: input.since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10), stepDays, approvedObservations, passes };
  console.log(`[auto-review-backlog] ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const since = process.env.AUTO_REVIEW_BACKLOG_SINCE;
  if (!since) {
    throw new Error("Set AUTO_REVIEW_BACKLOG_SINCE (YYYY-MM-DD).");
  }
  await autoReviewBacklog({
    since: new Date(`${since}T00:00:00Z`),
    until: process.env.AUTO_REVIEW_BACKLOG_UNTIL
      ? new Date(`${process.env.AUTO_REVIEW_BACKLOG_UNTIL}T00:00:00Z`)
      : undefined,
    stepDays: process.env.AUTO_REVIEW_BACKLOG_STEP_DAYS
      ? Number(process.env.AUTO_REVIEW_BACKLOG_STEP_DAYS)
      : undefined
  });
}
