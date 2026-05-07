import { recomputeThemeTrends } from "@market-themes/db";

const asOfDate = process.env.TREND_AS_OF_DATE || undefined;
const lookbackDays = Number(process.env.TREND_LOOKBACK_DAYS ?? 120);
const lowHistoryDays = Number(process.env.TREND_LOW_HISTORY_DAYS ?? 14);

const result = await recomputeThemeTrends({
  asOfDate,
  lookbackDays,
  lowHistoryDays,
  windows: ["7d", "30d"],
  onProgress: (message) => {
    console.log(`[recompute-theme-trends] ${message}`);
  }
});

console.log(
  `[recompute-theme-trends] themes=${result.themesProcessed} rows=${result.trendRowsWritten} lowHistory=${result.lowHistoryRows}`
);

for (const trend of result.topTrends) {
  console.log(
    `[recompute-theme-trends] top window=${trend.trendWindow} theme="${trend.themeLabel}" z=${trend.zScore.toFixed(
      2
    )}`
  );
}
