export const narrativeMetricVersion = "reviewed_density_v2";

export type NarrativeMetricObservation = {
  narrativeDefinitionId: string;
  date: string;
  documentId: string;
  matched: boolean;
  reviewPending?: boolean;
  matchScore: number;
  riskTone: number;
  bullishTone: number;
  publisherId: string;
  publisherOwner: string;
  sourceClass: string;
  affectedEntities: string[];
};

export type NarrativeCorpusDay = { date: string; expectedDocuments: number };
export type NarrativeQuality = {
  coveredDays: number;
  expectedDocuments: number;
  pendingReview: number;
  coverageComplete: boolean;
  comparisonReady: boolean;
  accelerationReady: boolean;
  zScoreAvailable: boolean;
};
export type NarrativeMetricPoint = NarrativeQuality & {
  date: string;
  density: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  percentileRank: number;
  change: number;
  acceleration: number;
  riskTone: number;
  bullishTone: number;
  eligibleDocuments: number;
  matchedDocuments: number;
  publisherBreadth: number;
  publisherOwnerBreadth: number;
  sourceClassBreadth: number;
  entityBreadth: number;
  lowHistory: boolean;
};

/** Equal source-class weight, document weight within a source over the full window.
 * Missing days and pending reviews are never treated as measured absence.
 * A conservative comparison requires every calendar day covered, all ingested
 * eligible documents classified, no pending positives, and the same source classes.
 */
export function calculateNarrativeTrendSeries(
  observations: NarrativeMetricObservation[],
  dates: string[],
  windowDays: number,
  lowHistoryDays: number,
  corpus?: NarrativeCorpusDay[]
): NarrativeMetricPoint[] {
  if (!Number.isInteger(windowDays) || windowDays < 1 || lowHistoryDays < 1)
    throw new Error("Invalid narrative window configuration.");
  const byDate = new Map<string, NarrativeMetricObservation[]>();
  for (const row of observations) {
    const rows = byDate.get(row.date) ?? [];
    rows.push(row);
    byDate.set(row.date, rows);
  }
  const expected = new Map(
    corpus?.map((day) => [day.date, day.expectedDocuments])
  );
  const windows = dates.map((_, index) => {
    const windowDates = dates.slice(
      Math.max(0, index - windowDays + 1),
      index + 1
    );
    const rows = windowDates.flatMap((date) => byDate.get(date) ?? []);
    // One observation per document/definition is the measurement unit.
    const unique = [
      ...new Map(rows.map((row) => [row.documentId, row])).values()
    ];
    const matched = unique.filter((row) => row.matched);
    const sourceClasses = [
      ...new Set(unique.map((row) => row.sourceClass))
    ].sort();
    const pendingReview = unique.filter((row) => row.reviewPending).length;
    const expectedDocuments = windowDates.reduce(
      (total, date) =>
        total +
        (expected.get(date) ??
          new Set((byDate.get(date) ?? []).map((row) => row.documentId)).size),
      0
    );
    const coveredDays = windowDates.filter(
      (date) => (byDate.get(date)?.length ?? 0) > 0
    ).length;
    const density = average(
      sourceClasses.map((source) => {
        const eligible = unique.filter((row) => row.sourceClass === source);
        return (
          (100 * eligible.filter((row) => row.matched).length) / eligible.length
        );
      })
    );
    return {
      density,
      sourceSignature: sourceClasses.join(","),
      coveredDays,
      expectedDocuments,
      pendingReview,
      coverageComplete:
        coveredDays === windowDays &&
        unique.length >= expectedDocuments &&
        pendingReview === 0,
      eligibleDocuments: unique.length,
      matchedDocuments: matched.length,
      riskTone: average(matched.map((row) => row.riskTone)),
      bullishTone: average(matched.map((row) => row.bullishTone)),
      publisherBreadth: breadth(matched.map((row) => row.publisherId)),
      publisherOwnerBreadth: breadth(matched.map((row) => row.publisherOwner)),
      sourceClassBreadth: breadth(matched.map((row) => row.sourceClass)),
      entityBreadth: breadth(matched.flatMap((row) => row.affectedEntities))
    };
  });
  return windows.map((current, index) => {
    const previous = windows[index - windowDays];
    const prior = windows[index - windowDays * 2];
    const comparable = (other: typeof current | undefined) =>
      Boolean(
        current.coverageComplete &&
        other?.coverageComplete &&
        current.sourceSignature === other.sourceSignature
      );
    const baselineValues = windows
      .slice(0, Math.max(0, index - windowDays + 1))
      .filter(
        (row) =>
          row.coverageComplete &&
          row.sourceSignature === current.sourceSignature
      )
      .map((row) => row.density);
    const baselineMean = average(baselineValues);
    const baselineStddev = standardDeviation(baselineValues, baselineMean);
    const lowHistory = baselineValues.length < lowHistoryDays;
    const comparisonReady = !lowHistory && comparable(previous);
    const accelerationReady = comparisonReady && comparable(prior);
    // A flat or effectively flat baseline cannot support a standardized score.
    // Change and percentile still describe a genuine disappearance or appearance.
    const zScoreAvailable =
      current.coverageComplete && !lowHistory && baselineStddev >= 1;
    const change = comparisonReady ? current.density - previous.density : 0;
    const acceleration = accelerationReady
      ? change - (previous.density - prior.density)
      : 0;
    const below = baselineValues.filter(
      (value) => value < current.density
    ).length;
    const ties = baselineValues.filter(
      (value) => value === current.density
    ).length;
    return {
      date: dates[index],
      density: round(current.density),
      baselineMean: round(baselineMean),
      baselineStddev: round(baselineStddev),
      zScore: zScoreAvailable
        ? round((current.density - baselineMean) / baselineStddev)
        : 0,
      percentileRank:
        current.coverageComplete && !lowHistory
          ? Math.round((100 * (below + ties / 2)) / baselineValues.length)
          : 0,
      change: round(change),
      acceleration: round(acceleration),
      riskTone: round(current.riskTone),
      bullishTone: round(current.bullishTone),
      eligibleDocuments: current.eligibleDocuments,
      matchedDocuments: current.matchedDocuments,
      publisherBreadth: current.publisherBreadth,
      publisherOwnerBreadth: current.publisherOwnerBreadth,
      sourceClassBreadth: current.sourceClassBreadth,
      entityBreadth: current.entityBreadth,
      coveredDays: current.coveredDays,
      expectedDocuments: current.expectedDocuments,
      pendingReview: current.pendingReview,
      coverageComplete: current.coverageComplete,
      comparisonReady,
      accelerationReady,
      zScoreAvailable,
      lowHistory: lowHistory || !current.coverageComplete
    };
  });
}
function breadth(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}
function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function standardDeviation(values: number[], mean: number) {
  return values.length < 2
    ? 0
    : Math.sqrt(
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
          (values.length - 1)
      );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
