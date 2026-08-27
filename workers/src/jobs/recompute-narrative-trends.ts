import { recomputeNarrativeTrends } from "@market-themes/db";

const result = await recomputeNarrativeTrends({
  asOfDate: process.env.TREND_AS_OF_DATE || undefined,
  lookbackDays: Number(process.env.NARRATIVE_TREND_LOOKBACK_DAYS ?? 365),
  lowHistoryDays: Number(process.env.NARRATIVE_TREND_LOW_HISTORY_DAYS ?? 30),
  windows: ["7d", "30d"]
});

console.log(`[recompute-narrative-trends] ${JSON.stringify(result)}`);
