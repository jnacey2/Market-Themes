import { pathToFileURL } from "node:url";
import { validateCandidateForPromotion } from "@market-themes/analysis";
import {
  autoApproveNarrativeObservations,
  autoPromoteNarrativeCandidates,
  reconcileNarrativeDefinitionLifecycle,
  resolveStructuralAutoReviewOptions
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

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
      result.approvedObservations + (structuralResult?.approvedObservations ?? 0),
    structuralTier: structuralResult
      ? {
          approvedObservations: structuralResult.approvedObservations,
          narrativesTouched: structuralResult.narrativesTouched,
          reviewNote: structuralResult.reviewNote
        }
      : null,
    candidatesEvaluated: candidateResult.candidatesEvaluated,
    candidatesPromoted: candidateResult.candidatesPromoted,
    candidatesBlocked: candidateResult.candidatesBlocked,
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
