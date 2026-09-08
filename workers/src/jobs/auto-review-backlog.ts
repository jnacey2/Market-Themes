import { pathToFileURL } from "node:url";
import {
  autoApproveNarrativeObservations,
  resolveStructuralAutoReviewOptions,
  type NarrativeAutoReviewOptions
} from "@market-themes/db";

export type AutoReviewWindowPass = {
  windowEnd: string;
  tier: string;
  approvedObservations: number;
  narrativesTouched: number;
};

/**
 * Run every auto-approval tier with its corroboration window anchored at each
 * of `windowEnds`, so evidence is judged against the neighbours it was published
 * alongside rather than against today's window. Only passes that approved
 * something are reported.
 */
export async function autoReviewWindows(
  windowEnds: Date[],
  structural: NarrativeAutoReviewOptions | null = resolveStructuralAutoReviewOptions()
) {
  const passes: AutoReviewWindowPass[] = [];
  let approvedObservations = 0;
  for (const windowEnd of windowEnds) {
    const tiers: NarrativeAutoReviewOptions[] = [
      { windowEnd, tier: "default" },
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
  return { windows: windowEnds.length, approvedObservations, passes };
}

/**
 * One-off backlog pass over a date range. The scheduled job already re-anchors
 * on the publish week of evidence classified in the last day (see
 * auto-review-narratives), so this is only needed to re-sweep history after a
 * policy change such as loosening a tier's gate.
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
  const result = await autoReviewWindows(windowEnds);
  const summary = {
    since: input.since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    stepDays,
    approvedObservations: result.approvedObservations,
    passes: result.passes
  };
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
