import { pathToFileURL } from "node:url";
import {
  autoApproveNarrativeObservations,
  autoPromoteNarrativeCandidates
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export async function autoReviewNarratives() {
  if (process.env.NARRATIVE_AUTO_REVIEW_ENABLED !== "true") {
    const result = {
      enabled: false,
      approvedObservations: 0,
      narrativesTouched: 0,
      candidatesPromoted: 0,
      candidateObservationsCreated: 0
    };
    console.log(`[auto-review-narratives] ${JSON.stringify(result)}`);
    return result;
  }

  const result = await autoApproveNarrativeObservations();
  const candidateResult =
    process.env.NARRATIVE_AUTO_PROMOTE_CANDIDATES === "true"
      ? await autoPromoteNarrativeCandidates()
      : {
          candidatesEvaluated: 0,
          candidatesPromoted: 0,
          observationsCreated: 0,
          promotedDefinitionIds: [],
          failedCandidates: []
        };
  const summary = {
    enabled: true,
    ...result,
    candidatesEvaluated: candidateResult.candidatesEvaluated,
    candidatesPromoted: candidateResult.candidatesPromoted,
    candidateObservationsCreated: candidateResult.observationsCreated,
    promotedDefinitionIds: candidateResult.promotedDefinitionIds,
    failedCandidatePromotions: candidateResult.failedCandidates
  };
  console.log(`[auto-review-narratives] ${JSON.stringify(summary)}`);
  if (
    summary.failedCandidatePromotions.length > 0 &&
    summary.candidatesPromoted === 0
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
