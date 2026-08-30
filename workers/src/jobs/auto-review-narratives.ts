import { pathToFileURL } from "node:url";
import { autoApproveNarrativeObservations } from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export async function autoReviewNarratives() {
  if (process.env.NARRATIVE_AUTO_REVIEW_ENABLED !== "true") {
    const result = {
      enabled: false,
      approvedObservations: 0,
      narrativesTouched: 0
    };
    console.log(`[auto-review-narratives] ${JSON.stringify(result)}`);
    return result;
  }

  const result = await autoApproveNarrativeObservations();
  const summary = { enabled: true, ...result };
  console.log(`[auto-review-narratives] ${JSON.stringify(summary)}`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRecordedJob(
    "narrative_auto_review",
    () => autoReviewNarratives(),
    (value) => value.approvedObservations
  );
}
