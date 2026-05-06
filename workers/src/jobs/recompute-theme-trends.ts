import { calculateBaselineScore } from "@market-themes/analysis";
import { storyboards } from "@market-themes/db";

for (const storyboard of storyboards) {
  const currentWindow = storyboard.trend.slice(-3);
  const baselineWindow = storyboard.trend.slice(0, -3);
  const score = calculateBaselineScore(currentWindow, baselineWindow);

  console.log(
    `[recompute-theme-trends] ${storyboard.theme}: z=${score.zScore.toFixed(
      2
    )}, percentile=${score.percentileRank}`
  );
}
