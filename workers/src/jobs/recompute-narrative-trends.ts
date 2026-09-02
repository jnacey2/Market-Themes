import { pathToFileURL } from "node:url";
import {
  reconcileNarrativeDefinitionLifecycle,
  recomputeNarrativeTrends
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export async function recomputeScheduledNarrativeTrends() {
  const lifecycle = await reconcileNarrativeDefinitionLifecycle();
  const trends = await recomputeNarrativeTrends({
    asOfDate: process.env.TREND_AS_OF_DATE || undefined,
    lookbackDays: Number(process.env.NARRATIVE_TREND_LOOKBACK_DAYS ?? 365),
    lowHistoryDays: Number(process.env.NARRATIVE_TREND_LOW_HISTORY_DAYS ?? 30),
    windows: ["7d", "30d"]
  });
  return { ...trends, ...lifecycle };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRecordedJob(
    "narrative_trends",
    () => recomputeScheduledNarrativeTrends(),
    (value) => value.definitionsProcessed
  );
  console.log(`[recompute-narrative-trends] ${JSON.stringify(result)}`);
}
