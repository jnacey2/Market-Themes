import type { NarrativeLifecycleState } from "./types";

export type NarrativeMetricObservation = {
  narrativeDefinitionId: string;
  date: string;
  documentId: string;
  /** Publishable match: classifier matched, human/auto review approved, evidence still current. */
  matched: boolean;
  /**
   * Raw classifier match regardless of review state (rejected matches excluded by the caller).
   * Defaults to `matched` when omitted so older callers keep the reviewed-only behaviour.
   */
  rawMatched?: boolean;
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

export type { NarrativeLifecycleState };

export type NarrativeMetricPoint = {
  date: string;
  density: number;
  baselineMean: number;
  baselineStddev: number;
  baselineWindows: number;
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
  attentionDensity: number;
  attentionMatchedDocuments: number;
  attentionZScore: number;
  peakDensity: number;
  peakDate: string | null;
  daysSincePeak: number | null;
  percentOfPeak: number;
  lifecycleState: NarrativeLifecycleState;
};

/** Minimum robust scale, in density percentage points, so near-constant baselines cannot explode z-scores. */
export const MINIMUM_BASELINE_SCALE = 0.5;
/** Trailing span used to locate a narrative's recent peak. */
export const PEAK_LOOKBACK_DAYS = 90;
/** Fewer than this many baseline windows always counts as low history. */
export const MINIMUM_BASELINE_WINDOWS = 3;

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
  const observationsByDate = groupBy(observations, (row) => row.date);
  const corpusByDate = groupBy(corpusDocuments, (row) => row.date);
  const daily = dates.map((date) =>
    dailySummary(observationsByDate.get(date) ?? [], corpusByDate.get(date) ?? [], date)
  );
  const stride = baselineStride(windowDays);
  const minimumWindows = Math.max(
    MINIMUM_BASELINE_WINDOWS,
    Math.ceil(lowHistoryDays / stride)
  );
  const windows = daily.map((_, index) => summarizeWindow(daily, index, windowDays));

  return daily.map((_, index) => {
    const current = windows[index];
    const previous = summarizeWindow(daily, index - windowDays, windowDays);
    const prior = summarizeWindow(daily, index - windowDays * 2, windowDays);
    const baseline = collectBaseline(windows, index, windowDays, stride);
    const hasCoverage = isMeasured(current.coverageState);
    const enoughBaseline = baseline.density.length >= 2;
    const lowHistory = !hasCoverage || baseline.density.length < minimumWindows;
    const baselineMean = average(baseline.density);
    const baselineScale = robustScale(baseline.density, baselineMean);
    const attentionMean = average(baseline.attention);
    const attentionScale = robustScale(baseline.attention, attentionMean);
    const change =
      hasCoverage && isMeasured(previous.coverageState)
        ? current.density - previous.density
        : 0;
    const previousChange =
      isMeasured(previous.coverageState) && isMeasured(prior.coverageState)
        ? previous.density - prior.density
        : 0;
    const peak = locatePeak(windows, dates, index, hasCoverage);
    const percentOfPeak =
      hasCoverage && peak.density > 0
        ? round((current.density / peak.density) * 100)
        : 0;
    const lifecycleState = deriveLifecycleState({
      hasCoverage,
      lowHistory,
      density: current.density,
      previousDensity: isMeasured(previous.coverageState) ? previous.density : null,
      change,
      previousChange,
      peakDensity: peak.density,
      daysSincePeak: peak.daysSincePeak,
      windowDays
    });

    return {
      date: dates[index],
      density: round(current.density),
      baselineMean: round(baselineMean),
      baselineStddev: round(baselineScale),
      baselineWindows: baseline.density.length,
      zScore:
        hasCoverage && enoughBaseline
          ? round((current.density - baselineMean) / baselineScale)
          : 0,
      percentileRank:
        hasCoverage && enoughBaseline
          ? percentile(current.density, baseline.density)
          : 0,
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
      lowHistory,
      attentionDensity: round(current.attentionDensity),
      attentionMatchedDocuments: current.attentionMatchedDocuments,
      attentionZScore:
        hasCoverage && enoughBaseline
          ? round((current.attentionDensity - attentionMean) / attentionScale)
          : 0,
      peakDensity: round(peak.density),
      peakDate: peak.date,
      daysSincePeak: peak.daysSincePeak,
      percentOfPeak,
      lifecycleState
    };
  });
}

export function deriveLifecycleState(input: {
  hasCoverage: boolean;
  lowHistory: boolean;
  density: number;
  previousDensity: number | null;
  change: number;
  previousChange: number;
  peakDensity: number;
  daysSincePeak: number | null;
  windowDays: number;
}): NarrativeLifecycleState {
  if (!input.hasCoverage) return "unmeasured";
  const zeroNow = input.density <= 0;
  const zeroBefore = input.previousDensity !== null && input.previousDensity <= 0;
  if (zeroNow && (zeroBefore || input.previousDensity === null)) return "dormant";
  const noise = Math.max(MINIMUM_BASELINE_SCALE, input.peakDensity * 0.1);
  const percentOfPeak =
    input.peakDensity > 0 ? (input.density / input.peakDensity) * 100 : 0;
  const pastPeak =
    input.daysSincePeak !== null && input.daysSincePeak >= input.windowDays;
  if (
    zeroNow ||
    (input.change <= -noise && input.previousChange <= 0) ||
    (pastPeak && percentOfPeak < 50)
  ) {
    return "fading";
  }
  if (input.lowHistory) return "emerging";
  if (input.change > noise) return "rising";
  if (percentOfPeak >= 85 && !pastPeak) return "peaking";
  return "steady";
}

export function baselineStride(windowDays: number) {
  return Math.max(1, Math.floor(windowDays / 2));
}

type DailySummary = ReturnType<typeof dailySummary>;

function dailySummary(
  rows: NarrativeMetricObservation[],
  corpusRows: NarrativeCorpusDocument[],
  date: string
) {
  const eligible = new Set(rows.map((row) => row.documentId));
  const corpusEligible = new Set(corpusRows.map((row) => row.documentId));
  const matchedRows = rows.filter((row) => row.matched);
  const matched = new Set(matchedRows.map((row) => row.documentId));
  const rawMatchedRows = rows.filter((row) => row.rawMatched ?? row.matched);
  const rawMatched = new Set(rawMatchedRows.map((row) => row.documentId));
  const bySourceClass = groupBy(rows, (row) => row.sourceClass);
  const classDensities = [...bySourceClass.values()].map((sourceRows) => {
    const sourceEligible = new Set(sourceRows.map((row) => row.documentId)).size;
    const sourceMatched = new Set(
      sourceRows.filter((row) => row.matched).map((row) => row.documentId)
    ).size;
    const attentionWeight = sum(
      dedupeByDocument(sourceRows.filter((row) => row.rawMatched ?? row.matched)).map(
        (row) => Math.min(Math.max(row.matchScore, 0), 100) / 100
      )
    );
    return {
      weight: Math.log1p(sourceEligible),
      density: sourceEligible === 0 ? 0 : (sourceMatched / sourceEligible) * 100,
      attention: sourceEligible === 0 ? 0 : (attentionWeight / sourceEligible) * 100
    };
  });

  return {
    date,
    density: weightedAverage(classDensities.map((row) => [row.density, row.weight])),
    attentionDensity: weightedAverage(
      classDensities.map((row) => [row.attention, row.weight])
    ),
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
    matchedDocumentIds: matched,
    rawMatchedDocumentIds: rawMatched
  };
}

function summarizeWindow(daily: DailySummary[], endIndex: number, windowDays: number) {
  const start = Math.max(0, endIndex - windowDays + 1);
  const rows = endIndex < 0 ? [] : daily.slice(start, endIndex + 1);
  const corpusDocumentIds = union(rows.map((row) => row.corpusDocumentIds));
  const classifiedDocumentIds = union(rows.map((row) => row.classifiedDocumentIds));
  const matchedDocumentIds = union(rows.map((row) => row.matchedDocumentIds));
  const coverage = deriveNarrativeCoverageState({
    corpusEligibleDocuments: corpusDocumentIds.size,
    classifiedDocuments: classifiedDocumentIds.size,
    matchedDocuments: matchedDocumentIds.size
  });
  return {
    density: average(rows.map((row) => row.density)),
    attentionDensity: average(rows.map((row) => row.attentionDensity)),
    riskTone: average(rows.map((row) => row.riskTone).filter((value) => value > 0)),
    bullishTone: average(rows.map((row) => row.bullishTone).filter((value) => value > 0)),
    eligibleDocuments: classifiedDocumentIds.size,
    matchedDocuments: matchedDocumentIds.size,
    attentionMatchedDocuments: unionSize(rows.map((row) => row.rawMatchedDocumentIds)),
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

type WindowSummary = ReturnType<typeof summarizeWindow>;

/**
 * Baseline windows end at least one full window before the current one and are spaced
 * by `stride` days so consecutive samples are not near-duplicates of each other.
 */
function collectBaseline(
  windows: WindowSummary[],
  index: number,
  windowDays: number,
  stride: number
) {
  const density: number[] = [];
  const attention: number[] = [];
  for (let end = index - windowDays; end >= windowDays - 1; end -= stride) {
    const window = windows[end];
    if (isMeasured(window.coverageState)) {
      density.push(window.density);
      attention.push(window.attentionDensity);
    }
  }
  return { density, attention };
}

function locatePeak(
  windows: WindowSummary[],
  dates: string[],
  index: number,
  hasCoverage: boolean
) {
  if (!hasCoverage) return { density: 0, date: null, daysSincePeak: null };
  let peakDensity = -1;
  let peakIndex = index;
  for (let cursor = index; cursor >= Math.max(0, index - PEAK_LOOKBACK_DAYS + 1); cursor -= 1) {
    const window = windows[cursor];
    if (!isMeasured(window.coverageState)) continue;
    if (window.density > peakDensity) {
      peakDensity = window.density;
      peakIndex = cursor;
    }
  }
  if (peakDensity < 0) return { density: 0, date: null, daysSincePeak: null };
  return {
    density: peakDensity,
    date: dates[peakIndex] ?? null,
    daysSincePeak: index - peakIndex
  };
}

function isMeasured(state: NarrativeMetricPoint["coverageState"]) {
  return state === "measured" || state === "measured_zero";
}

function dedupeByDocument(rows: NarrativeMetricObservation[]) {
  const seen = new Map<string, NarrativeMetricObservation>();
  for (const row of rows) {
    const existing = seen.get(row.documentId);
    if (!existing || row.matchScore > existing.matchScore) seen.set(row.documentId, row);
  }
  return [...seen.values()];
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
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

function weightedAverage(pairs: Array<[value: number, weight: number]>) {
  const totalWeight = sum(pairs.map(([, weight]) => weight));
  if (totalWeight === 0) return 0;
  return sum(pairs.map(([value, weight]) => value * weight)) / totalWeight;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Scaled median absolute deviation, falling back to the sample standard deviation when
 * the MAD collapses (more than half the baseline is identical), floored so that a flat
 * baseline cannot turn a small move into an enormous z-score.
 */
export function robustScale(values: number[], mean = average(values)) {
  if (values.length < 2) return MINIMUM_BASELINE_SCALE;
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center))) * 1.4826;
  const scale = mad > 0 ? mad : standardDeviation(values, mean);
  return Math.max(scale, MINIMUM_BASELINE_SCALE);
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) return 0;
  return Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1)
  );
}

function percentile(value: number, values: number[]) {
  if (values.length === 0) return 0;
  return Math.round((values.filter((candidate) => candidate <= value).length / values.length) * 100);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export const DEFAULT_COVERAGE_MEASURED_PERCENT = 100;

/**
 * Share of the window's corpus that must be classified before a narrative is measured.
 * 100 means one unclassified document keeps the whole narrative at "backfill pending";
 * a lower value trades a small amount of denominator noise for a board that stays
 * measured while ingestion runs ahead of classification.
 */
export function resolveCoverageMeasuredPercent(
  value: number | string | undefined = process.env.NARRATIVE_COVERAGE_MEASURED_PERCENT
) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 && parsed <= 100
    ? parsed
    : DEFAULT_COVERAGE_MEASURED_PERCENT;
}

export function deriveNarrativeCoverageState(
  input: {
    corpusEligibleDocuments: number;
    classifiedDocuments: number;
    matchedDocuments: number;
  },
  minimumCoveragePercent = resolveCoverageMeasuredPercent()
) {
  const corpusEligibleDocuments = Math.max(0, input.corpusEligibleDocuments);
  const classifiedDocuments = Math.min(
    corpusEligibleDocuments,
    Math.max(0, input.classifiedDocuments)
  );
  const rawCoveragePercent =
    corpusEligibleDocuments === 0
      ? 0
      : (classifiedDocuments / corpusEligibleDocuments) * 100;
  const classificationCoveragePercent = round(rawCoveragePercent);
  const coverageState =
    corpusEligibleDocuments === 0
      ? ("no_corpus" as const)
      : rawCoveragePercent < minimumCoveragePercent
        ? ("backfill_pending" as const)
        : input.matchedDocuments === 0
          ? ("measured_zero" as const)
          : ("measured" as const);
  return { classificationCoveragePercent, coverageState };
}
