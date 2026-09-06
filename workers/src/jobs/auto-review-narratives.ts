import { pathToFileURL } from "node:url";
import { validateCandidateForPromotion } from "@market-themes/analysis";
import {
  autoApproveNarrativeObservations,
  autoPromoteNarrativeCandidates,
  listRecentlyObservedEvidenceWindows,
  reconcileNarrativeDefinitionLifecycle,
  resolveRecentObservationHours,
  resolveStructuralAutoReviewOptions
} from "@market-themes/db";
import { autoReviewWindows } from "./auto-review-backlog";
import { runRecordedJob } from "./recorded-job";

const DEFAULT_LOOKBACK_DAYS = 7;

/**
 * Evidence classified in the last day but published weeks or months ago (a
 * definition backfill, or filings and transcripts that arrive late) has no
 * corroborating neighbours in the now-anchored window. Re-run the tiers with
 * the window anchored at each such evidence week so history reviews itself as
 * it arrives, without a manual backlog pass.
 */
export async function autoReviewRecentlyObservedHistory(
  structural = resolveStructuralAutoReviewOptions()
) {
  const recentHours = resolveRecentObservationHours();
  const lookbackDays = Number(
    process.env.NARRATIVE_AUTO_REVIEW_LOOKBACK_DAYS ?? DEFAULT_LOOKBACK_DAYS
  );
  const windowEnds = await listRecentlyObservedEvidenceWindows({
    recentHours,
    excludeWithinDays: Number.isFinite(lookbackDays) ? lookbackDays : DEFAULT_LOOKBACK_DAYS
  });
  const result = await autoReviewWindows(windowEnds, structural);
  return { recentHours, ...result };
}

export async function autoReviewNarratives() {
  if (process.env.NARRATIVE_AUTO_REVIEW_ENABLED !== "true") {
    const result = {
      enabled: false,
      approvedObservations: 0,
      narrativesTouched: 0,
      candidatesPromoted: 0,
      candidatesBlocked: 0,
      candidateObservationsCreated: 0
    };
    console.log(`[auto-review-narratives] ${JSON.stringify(result)}`);
    return result;
  }

  const result = await autoApproveNarrativeObservations();
  const structuralOptions = resolveStructuralAutoReviewOptions();
  const structuralResult = structuralOptions
    ? await autoApproveNarrativeObservations(structuralOptions)
    : null;
  const historical = await autoReviewRecentlyObservedHistory(structuralOptions);
  const candidateResult =
    process.env.NARRATIVE_AUTO_PROMOTE_CANDIDATES === "true"
      ? await autoPromoteNarrativeCandidates({
          validateCandidate: (input) =>
            validateCandidateForPromotion(input)
        })
      : {
          candidatesEvaluated: 0,
          candidatesPromoted: 0,
          candidatesBlocked: 0,
          candidatesAwaitingPersistence: 0,
          observationsCreated: 0,
          promotedDefinitionIds: [],
          duplicateCandidates: [],
          failedCandidates: []
        };
  const lifecycleResult = await reconcileNarrativeDefinitionLifecycle();
  const summary = {
    enabled: true,
    ...result,
    approvedObservations:
      result.approvedObservations +
      (structuralResult?.approvedObservations ?? 0) +
      historical.approvedObservations,
    structuralTier: structuralResult
      ? {
          approvedObservations: structuralResult.approvedObservations,
          narrativesTouched: structuralResult.narrativesTouched,
          reviewNote: structuralResult.reviewNote
        }
      : null,
    historicalWindows: historical,
    candidatesEvaluated: candidateResult.candidatesEvaluated,
    candidatesPromoted: candidateResult.candidatesPromoted,
    candidatesBlocked: candidateResult.candidatesBlocked,
    candidatesAwaitingPersistence: candidateResult.candidatesAwaitingPersistence,
    candidateObservationsCreated: candidateResult.observationsCreated,
    promotedDefinitionIds: candidateResult.promotedDefinitionIds,
    duplicateCandidates: candidateResult.duplicateCandidates,
    failedCandidatePromotions: candidateResult.failedCandidates,
    ...lifecycleResult
  };
  console.log(`[auto-review-narratives] ${JSON.stringify(summary)}`);
  if (
    summary.failedCandidatePromotions.length > 0 &&
    summary.candidatesPromoted === 0 &&
    summary.approvedObservations === 0
  ) {
    throw new Error(
      `${summary.failedCandidatePromotions.length} automatic candidate promotion(s) failed.`
    );
  }
  if (summary.failedCandidatePromotions.length > 0) {
    console.warn(
      `[auto-review-narratives] partial candidate promotion failures=${summary.failedCandidatePromotions.length}`
    );
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRecordedJob(
    "narrative_auto_review",
    () => autoReviewNarratives(),
    (value) => value.approvedObservations + value.candidatesPromoted
  );
}
