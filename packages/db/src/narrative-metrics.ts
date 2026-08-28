export type NarrativeMetricObservation = {
  narrativeDefinitionId: string;
  date: string;
  documentId: string;
  matched: boolean;
  matchScore: number;
  riskTone: number;
  bullishTone: number;
  publisherId: string;
  publisherOwner: string;
  sourceClass: string;
  affectedEntities: string[];
};

export type NarrativeMetricPoint = {
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

export function calculateNarrativeTrendSeries(
  observations: NarrativeMetricObservation[],
  dates: string[],
  windowDays: number,
  lowHistoryDays: number
): NarrativeMetricPoint[] {
  const daily = dates.map((date) => dailySummary(observations.filter((row) => row.date === date), date));

  return daily.map((_, index) => {
    const current = summarizeWindow(daily, index, windowDays);
    const previous = summarizeWindow(daily, index - windowDays, windowDays);
    const prior = summarizeWindow(daily, index - windowDays * 2, windowDays);
    const baselineEnd = index - windowDays;
    const baselineValues: number[] = [];

    for (let end = windowDays - 1; end <= baselineEnd; end += 1) {
      const baseline = summarizeWindow(daily, end, windowDays);
      if (baseline.eligibleDocuments > 0) {
        baselineValues.push(baseline.density);
      }
    }

    const baselineMean = average(baselineValues);
    const baselineStddev = Math.max(standardDeviation(baselineValues, baselineMean), 0.01);
    const hasCoverage = current.eligibleDocuments > 0;
    const hasMatch = current.matchedDocuments > 0;
    const lowHistory = !hasCoverage || baselineValues.length < lowHistoryDays;
    const change =
      hasCoverage && previous.eligibleDocuments > 0
        ? current.density - previous.density
        : 0;
    const previousChange =
      previous.eligibleDocuments > 0 && prior.eligibleDocuments > 0
        ? previous.density - prior.density
        : 0;

    return {
      date: dates[index],
      density: round(current.density),
      baselineMean: round(baselineMean),
      baselineStddev: round(baselineStddev),
      zScore:
        hasCoverage && hasMatch && !lowHistory
          ? round((current.density - baselineMean) / baselineStddev)
          : 0,
      percentileRank:
        !hasCoverage || !hasMatch || lowHistory
          ? 0
          : Math.round(
              (baselineValues.filter((value) => value <= current.density).length /
                baselineValues.length) *
                100
            ),
      change: round(change),
      acceleration: hasCoverage ? round(change - previousChange) : 0,
      riskTone: round(current.riskTone),
      bullishTone: round(current.bullishTone),
      eligibleDocuments: current.eligibleDocuments,
      matchedDocuments: current.matchedDocuments,
      publisherBreadth: current.publisherBreadth,
      publisherOwnerBreadth: current.publisherOwnerBreadth,
      sourceClassBreadth: current.sourceClassBreadth,
      entityBreadth: current.entityBreadth,
      lowHistory
    };
  });
}

function dailySummary(rows: NarrativeMetricObservation[], date: string) {
  const eligible = new Set(rows.map((row) => row.documentId));
  const matchedRows = rows.filter((row) => row.matched);
  const matched = new Set(matchedRows.map((row) => row.documentId));
  const sourceClasses = new Set(rows.map((row) => row.sourceClass));
  const densityBySource = [...sourceClasses].map((sourceClass) => {
    const sourceRows = rows.filter((row) => row.sourceClass === sourceClass);
    const sourceEligible = new Set(sourceRows.map((row) => row.documentId)).size;
    const sourceMatched = new Set(
      sourceRows.filter((row) => row.matched).map((row) => row.documentId)
    ).size;
    return sourceEligible === 0 ? 0 : (sourceMatched / sourceEligible) * 100;
  });

  return {
    date,
    density: average(densityBySource),
    riskTone: average(matchedRows.map((row) => row.riskTone)),
    bullishTone: average(matchedRows.map((row) => row.bullishTone)),
    eligibleDocuments: eligible.size,
    matchedDocuments: matched.size,
    publisherIds: new Set(matchedRows.map((row) => row.publisherId).filter(Boolean)),
    publisherOwners: new Set(matchedRows.map((row) => row.publisherOwner).filter(Boolean)),
    sourceClasses: new Set(matchedRows.map((row) => row.sourceClass)),
    entities: new Set(matchedRows.flatMap((row) => row.affectedEntities))
  };
}

function summarizeWindow(
  daily: ReturnType<typeof dailySummary>[],
  endIndex: number,
  windowDays: number
) {
  const start = Math.max(0, endIndex - windowDays + 1);
  const rows = endIndex < 0 ? [] : daily.slice(start, endIndex + 1);
  return {
    density: average(rows.map((row) => row.density)),
    riskTone: average(rows.map((row) => row.riskTone).filter((value) => value > 0)),
    bullishTone: average(rows.map((row) => row.bullishTone).filter((value) => value > 0)),
    eligibleDocuments: sum(rows.map((row) => row.eligibleDocuments)),
    matchedDocuments: sum(rows.map((row) => row.matchedDocuments)),
    publisherBreadth: unionSize(rows.map((row) => row.publisherIds)),
    publisherOwnerBreadth: unionSize(rows.map((row) => row.publisherOwners)),
    sourceClassBreadth: unionSize(rows.map((row) => row.sourceClasses)),
    entityBreadth: unionSize(rows.map((row) => row.entities))
  };
}

function unionSize(sets: Set<string>[]) {
  return new Set(sets.flatMap((set) => [...set])).size;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) return 0;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1)
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
