export type IntensityPoint = {
  date: string;
  intensity: number;
};

export type BaselineScore = {
  currentIntensity: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  percentileRank: number;
};

export function calculateBaselineScore(
  currentWindow: IntensityPoint[],
  baselineWindow: IntensityPoint[]
): BaselineScore {
  const currentIntensity = average(currentWindow.map((point) => point.intensity));
  const baselineValues = baselineWindow.map((point) => point.intensity);
  const baselineMean = average(baselineValues);
  const baselineStddev = standardDeviation(baselineValues, baselineMean);
  const safeStddev = baselineStddev === 0 ? 1 : baselineStddev;
  const zScore = (currentIntensity - baselineMean) / safeStddev;

  return {
    currentIntensity,
    baselineMean,
    baselineStddev: safeStddev,
    zScore,
    percentileRank: percentileRank(currentIntensity, baselineValues)
  };
}

export function shouldPromoteTheme(score: BaselineScore, evidenceCount: number) {
  return score.zScore >= 1.8 && score.percentileRank >= 90 && evidenceCount >= 2;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) {
    return 0;
  }

  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function percentileRank(value: number, values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const belowOrEqual = values.filter((candidate) => candidate <= value).length;
  return Math.round((belowOrEqual / values.length) * 100);
}
