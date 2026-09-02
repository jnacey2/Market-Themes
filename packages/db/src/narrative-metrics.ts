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
  storyFingerprint: string;
  sourceClass: string;
  affectedEntities: string[];
};

export type NarrativeCorpusDocument = {
  date: string;
  documentId: string;
  sourceClass: string;
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
  storyBreadth: number;
  sourceClassBreadth: number;
  entityBreadth: number;
  corpusEligibleDocuments: number;
  classifiedDocuments: number;
  classificationCoveragePercent: number;
  coverageState: "no_corpus" | "backfill_pending" | "measured_zero" | "measured";
  lowHistory: boolean;
};

export function calculateNarrativeTrendSeries(
  observations: NarrativeMetricObservation[],
  dates: string[],
  windowDays: number,
  lowHistoryDays: number,
  corpusDocuments: NarrativeCorpusDocument[] = observations.map((row) => ({
    date: row.date,
    documentId: row.documentId,
    sourceClass: row.sourceClass
  }))
): NarrativeMetricPoint[] {
  const daily = dates.map((date) =>
    dailySummary(
      observations.filter((row) => row.date === date),
      corpusDocuments.filter((row) => row.date === date),
      date
    )
  );

  return daily.map((_, index) => {
    const current = summarizeWindow(daily, index, windowDays);
    const previous = summarizeWindow(daily, index - windowDays, windowDays);
    const prior = summarizeWindow(daily, index - windowDays * 2, windowDays);
    const baselineEnd = index - windowDays;
    const baselineValues: number[] = [];

    for (let end = windowDays - 1; end <= baselineEnd; end += 1) {
      const baseline = summarizeWindow(daily, end, windowDays);
      if (
        baseline.coverageState === "measured" ||
        baseline.coverageState === "measured_zero"
      ) {
        baselineValues.push(baseline.density);
      }
    }

    const baselineMean = average(baselineValues);
    const baselineStddev = Math.max(standardDeviation(baselineValues, baselineMean), 0.01);
    const hasCoverage =
      current.coverageState === "measured" ||
      current.coverageState === "measured_zero";
    const hasMatch = current.matchedDocuments > 0;
    const lowHistory = !hasCoverage || baselineValues.length < lowHistoryDays;
    const change =
      hasCoverage &&
      (previous.coverageState === "measured" ||
        previous.coverageState === "measured_zero")
        ? current.density - previous.density
        : 0;
    const previousChange =
      (previous.coverageState === "measured" ||
        previous.coverageState === "measured_zero") &&
      (prior.coverageState === "measured" ||
        prior.coverageState === "measured_zero")
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
      storyBreadth: current.storyBreadth,
      sourceClassBreadth: current.sourceClassBreadth,
      entityBreadth: current.entityBreadth,
      corpusEligibleDocuments: current.corpusEligibleDocuments,
      classifiedDocuments: current.classifiedDocuments,
      classificationCoveragePercent: current.classificationCoveragePercent,
      coverageState: current.coverageState,
      lowHistory
    };
  });
}

function dailySummary(
  rows: NarrativeMetricObservation[],
  corpusRows: NarrativeCorpusDocument[],
  date: string
) {
  const eligible = new Set(rows.map((row) => row.documentId));
  const corpusEligible = new Set(corpusRows.map((row) => row.documentId));
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
    storyFingerprints: new Set(
      matchedRows.map((row) => row.storyFingerprint || row.documentId)
    ),
    sourceClasses: new Set(matchedRows.map((row) => row.sourceClass)),
    entities: new Set(matchedRows.flatMap((row) => row.affectedEntities)),
    corpusDocumentIds: corpusEligible,
    classifiedDocumentIds: eligible,
    matchedDocumentIds: matched
  };
}

function summarizeWindow(
  daily: ReturnType<typeof dailySummary>[],
  endIndex: number,
  windowDays: number
) {
  const start = Math.max(0, endIndex - windowDays + 1);
  const rows = endIndex < 0 ? [] : daily.slice(start, endIndex + 1);
  const corpusDocumentIds = union(
    rows.map((row) => row.corpusDocumentIds)
  );
  const classifiedDocumentIds = union(
    rows.map((row) => row.classifiedDocumentIds)
  );
  const matchedDocumentIds = union(
    rows.map((row) => row.matchedDocumentIds)
  );
  const coverage = deriveNarrativeCoverageState({
    corpusEligibleDocuments: corpusDocumentIds.size,
    classifiedDocuments: classifiedDocumentIds.size,
    matchedDocuments: matchedDocumentIds.size
  });
  return {
    density: average(rows.map((row) => row.density)),
    riskTone: average(rows.map((row) => row.riskTone).filter((value) => value > 0)),
    bullishTone: average(rows.map((row) => row.bullishTone).filter((value) => value > 0)),
    eligibleDocuments: classifiedDocumentIds.size,
    matchedDocuments: matchedDocumentIds.size,
    publisherBreadth: unionSize(rows.map((row) => row.publisherIds)),
    publisherOwnerBreadth: unionSize(rows.map((row) => row.publisherOwners)),
    storyBreadth: unionSize(rows.map((row) => row.storyFingerprints)),
    sourceClassBreadth: unionSize(rows.map((row) => row.sourceClasses)),
    entityBreadth: unionSize(rows.map((row) => row.entities)),
    corpusEligibleDocuments: corpusDocumentIds.size,
    classifiedDocuments: classifiedDocumentIds.size,
    classificationCoveragePercent: coverage.classificationCoveragePercent,
    coverageState: coverage.coverageState
  };
}

function unionSize(sets: Set<string>[]) {
  return union(sets).size;
}

function union(sets: Set<string>[]) {
  return new Set(sets.flatMap((set) => [...set]));
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

export function deriveNarrativeCoverageState(input: {
  corpusEligibleDocuments: number;
  classifiedDocuments: number;
  matchedDocuments: number;
}) {
  const corpusEligibleDocuments = Math.max(
    0,
    input.corpusEligibleDocuments
  );
  const classifiedDocuments = Math.min(
    corpusEligibleDocuments,
    Math.max(0, input.classifiedDocuments)
  );
  const classificationCoveragePercent =
    corpusEligibleDocuments === 0
      ? 0
      : round((classifiedDocuments / corpusEligibleDocuments) * 100);
  const coverageState =
    corpusEligibleDocuments === 0
      ? ("no_corpus" as const)
      : classifiedDocuments < corpusEligibleDocuments
        ? ("backfill_pending" as const)
        : input.matchedDocuments === 0
          ? ("measured_zero" as const)
          : ("measured" as const);
  return { classificationCoveragePercent, coverageState };
}
