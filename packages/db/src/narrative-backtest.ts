import { createDatabaseClient } from "./persistence";
import type { NarrativeLifecycleState, TrendWindow } from "./types";

/**
 * Emergence backtest.
 *
 * For every tracked narrative we reconstruct, from stored trend rows, the first
 * date each detector would have fired, and compare those dates to (a) when the
 * narrative was actually defined and (b) an optional human-asserted
 * "first emergence" date. This answers the two questions that matter for an
 * early-warning product: how much earlier could we have known, and how much
 * of a narrative's arc did we miss before it was defined.
 */

export type NarrativeEmergenceTimeline = {
  definitionId: string;
  slug: string;
  name: string;
  status: string;
  kind: string | null;
  createdAt: string;
  activatedAt: string | null;
  /** Earliest published date of any non-rejected matched document. */
  firstEvidenceDate: string | null;
  /** First date raw attention z-score cleared the signal threshold. */
  firstAttentionSignalDate: string | null;
  /** First date reviewed z-score cleared the signal threshold. */
  firstReviewedSignalDate: string | null;
  /** First date the lifecycle state entered emerging / rising / peaking. */
  firstEmergingDate: string | null;
  /** First date the lifecycle state entered rising / peaking. */
  firstRisingDate: string | null;
  /** First fading date recorded after the peak. */
  firstFadingDate: string | null;
  peakDate: string | null;
  latestDate: string | null;
  latestState: NarrativeLifecycleState | null;
  trendDays: number;
};

export type EmergenceBacktestRow = NarrativeEmergenceTimeline & {
  truthDate: string | null;
  /** Days between the first attention signal and the definition date (positive = signal preceded definition). */
  attentionLeadVsDefinitionDays: number | null;
  /** Days between the first emerging state and the definition date. */
  emergingLeadVsDefinitionDays: number | null;
  /** Days from truth date to the first attention signal (negative = early). */
  attentionLagVsTruthDays: number | null;
  /** Days from truth date to the first emerging state (negative = early). */
  emergingLagVsTruthDays: number | null;
  /** Days from truth date to the first reviewed signal (negative = early). */
  reviewedLagVsTruthDays: number | null;
};

export type EmergenceBacktestSummary = {
  window: TrendWindow;
  signalZ: number;
  narratives: number;
  withTruth: number;
  withAttentionSignal: number;
  withEmergingState: number;
  medianAttentionLeadVsDefinitionDays: number | null;
  medianEmergingLeadVsDefinitionDays: number | null;
  medianAttentionLagVsTruthDays: number | null;
  medianEmergingLagVsTruthDays: number | null;
  medianReviewedLagVsTruthDays: number | null;
  /** Share of truth-labeled narratives whose attention signal fired within 7 days of the truth date. */
  attentionWithin7DaysOfTruth: number | null;
  attentionWithin14DaysOfTruth: number | null;
  emergingWithin14DaysOfTruth: number | null;
  rows: EmergenceBacktestRow[];
};

export type LoadEmergenceTimelinesOptions = {
  window?: TrendWindow;
  promptVersion?: string;
  /** Z threshold that counts as a detector firing. */
  signalZ?: number;
  /** Minimum matched documents for a z-score to count. */
  minMatchedDocuments?: number;
  statuses?: string[];
};

export const DEFAULT_BACKTEST_SIGNAL_Z = 2;

export async function loadNarrativeEmergenceTimelines(
  options: LoadEmergenceTimelinesOptions = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeEmergenceTimeline[]> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the emergence backtest.");
  }

  const window = options.window ?? "7d";
  const signalZ = options.signalZ ?? DEFAULT_BACKTEST_SIGNAL_Z;
  const minMatched = options.minMatchedDocuments ?? 2;
  const statuses = options.statuses ?? ["active", "probationary", "expired", "retracted"];

  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const promptVersion =
      options.promptVersion ??
      (
        await client.query<{ prompt_version: string }>(
          `select prompt_version
           from narrative_trends
           where trend_window = $1
           group by prompt_version
           order by max(date) desc, count(*) desc
           limit 1`,
          [window]
        )
      ).rows[0]?.prompt_version ??
      null;

    const result = await client.query<{
      id: string;
      slug: string;
      name: string;
      status: string;
      kind: string | null;
      created_at: string;
      activated_at: string | null;
      first_evidence_date: string | null;
      first_attention_signal_date: string | null;
      first_reviewed_signal_date: string | null;
      first_emerging_date: string | null;
      first_rising_date: string | null;
      first_fading_date: string | null;
      peak_date: string | null;
      latest_date: string | null;
      latest_state: NarrativeLifecycleState | null;
      trend_days: number;
    }>(
      `with trends as (
         select nt.*
         from narrative_trends nt
         where nt.trend_window = $1
           and ($2::text is null or nt.prompt_version = $2)
       ),
       latest as (
         select distinct on (narrative_definition_id)
                narrative_definition_id, date, lifecycle_state, peak_date
         from trends
         order by narrative_definition_id, date desc
       ),
       firsts as (
         select narrative_definition_id,
                min(date) filter (
                  where attention_z_score >= $3 and attention_matched_documents >= $4
                ) as first_attention_signal_date,
                min(date) filter (
                  where z_score >= $3 and matched_documents >= $4
                ) as first_reviewed_signal_date,
                min(date) filter (
                  where lifecycle_state in ('emerging', 'rising', 'peaking')
                ) as first_emerging_date,
                min(date) filter (
                  where lifecycle_state in ('rising', 'peaking')
                ) as first_rising_date,
                count(*) as trend_days
         from trends
         group by narrative_definition_id
       ),
       fading as (
         select t.narrative_definition_id, min(t.date) as first_fading_date
         from trends t
         join latest l on l.narrative_definition_id = t.narrative_definition_id
         where t.lifecycle_state = 'fading'
           and (l.peak_date is null or t.date > l.peak_date)
         group by t.narrative_definition_id
       ),
       evidence as (
         select no.narrative_definition_id,
                min(d.published_at::date) as first_evidence_date
         from narrative_observations no
         join documents d on d.id = no.document_id
         where no.matched
           and no.review_status <> 'rejected'
           and coalesce(no.metadata->>'promotionSeed', 'false') <> 'true'
         group by no.narrative_definition_id
       )
       select nd.id, nd.slug, nd.name, nd.status, nd.kind,
              nd.created_at::text, nd.activated_at::text,
              e.first_evidence_date::text,
              f.first_attention_signal_date::text,
              f.first_reviewed_signal_date::text,
              f.first_emerging_date::text,
              f.first_rising_date::text,
              fd.first_fading_date::text,
              l.peak_date::text,
              l.date::text as latest_date,
              l.lifecycle_state as latest_state,
              coalesce(f.trend_days, 0)::int as trend_days
       from narrative_definitions nd
       left join firsts f on f.narrative_definition_id = nd.id
       left join latest l on l.narrative_definition_id = nd.id
       left join fading fd on fd.narrative_definition_id = nd.id
       left join evidence e on e.narrative_definition_id = nd.id
       where nd.status = any($5::text[])
         and nd.merged_into_definition_id is null
       order by nd.created_at, nd.slug`,
      [window, promptVersion, signalZ, minMatched, statuses]
    );

    return result.rows.map((row) => ({
      definitionId: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      kind: row.kind,
      createdAt: row.created_at,
      activatedAt: row.activated_at,
      firstEvidenceDate: row.first_evidence_date,
      firstAttentionSignalDate: row.first_attention_signal_date,
      firstReviewedSignalDate: row.first_reviewed_signal_date,
      firstEmergingDate: row.first_emerging_date,
      firstRisingDate: row.first_rising_date,
      firstFadingDate: row.first_fading_date,
      peakDate: row.peak_date,
      latestDate: row.latest_date,
      latestState: row.latest_state,
      trendDays: row.trend_days
    }));
  } finally {
    await client.end();
  }
}

/**
 * Pure scoring of emergence timelines against an optional truth map of
 * slug -> ISO date (the date a human asserts the narrative first emerged).
 */
export function summarizeEmergenceBacktest(
  timelines: NarrativeEmergenceTimeline[],
  truth: Record<string, string> = {},
  options: { window?: TrendWindow; signalZ?: number } = {}
): EmergenceBacktestSummary {
  const rows: EmergenceBacktestRow[] = timelines.map((timeline) => {
    const truthDate = normalizeDate(truth[timeline.slug]) ?? null;
    const definitionDate = normalizeDate(timeline.createdAt);
    return {
      ...timeline,
      truthDate,
      attentionLeadVsDefinitionDays: dayDiff(timeline.firstAttentionSignalDate, definitionDate),
      emergingLeadVsDefinitionDays: dayDiff(timeline.firstEmergingDate, definitionDate),
      attentionLagVsTruthDays: dayDiff(truthDate, timeline.firstAttentionSignalDate),
      emergingLagVsTruthDays: dayDiff(truthDate, timeline.firstEmergingDate),
      reviewedLagVsTruthDays: dayDiff(truthDate, timeline.firstReviewedSignalDate)
    };
  });

  const withTruth = rows.filter((row) => row.truthDate !== null);

  return {
    window: options.window ?? "7d",
    signalZ: options.signalZ ?? DEFAULT_BACKTEST_SIGNAL_Z,
    narratives: rows.length,
    withTruth: withTruth.length,
    withAttentionSignal: rows.filter((row) => row.firstAttentionSignalDate !== null).length,
    withEmergingState: rows.filter((row) => row.firstEmergingDate !== null).length,
    medianAttentionLeadVsDefinitionDays: median(rows.map((row) => row.attentionLeadVsDefinitionDays)),
    medianEmergingLeadVsDefinitionDays: median(rows.map((row) => row.emergingLeadVsDefinitionDays)),
    medianAttentionLagVsTruthDays: median(withTruth.map((row) => row.attentionLagVsTruthDays)),
    medianEmergingLagVsTruthDays: median(withTruth.map((row) => row.emergingLagVsTruthDays)),
    medianReviewedLagVsTruthDays: median(withTruth.map((row) => row.reviewedLagVsTruthDays)),
    attentionWithin7DaysOfTruth: share(withTruth, (row) => within(row.attentionLagVsTruthDays, 7)),
    attentionWithin14DaysOfTruth: share(withTruth, (row) => within(row.attentionLagVsTruthDays, 14)),
    emergingWithin14DaysOfTruth: share(withTruth, (row) => within(row.emergingLagVsTruthDays, 14)),
    rows
  };
}

export function formatEmergenceBacktestTable(summary: EmergenceBacktestSummary) {
  const header = [
    "slug",
    "defined",
    "evidence",
    "attention",
    "emerging",
    "reviewed",
    "peak",
    "fading",
    "state",
    "lead(def)",
    "lag(truth)"
  ];
  const lines = summary.rows.map((row) => [
    row.slug,
    normalizeDate(row.createdAt) ?? "-",
    row.firstEvidenceDate ?? "-",
    row.firstAttentionSignalDate ?? "-",
    row.firstEmergingDate ?? "-",
    row.firstReviewedSignalDate ?? "-",
    row.peakDate ?? "-",
    row.firstFadingDate ?? "-",
    row.latestState ?? "-",
    formatDays(row.attentionLeadVsDefinitionDays),
    formatDays(row.attentionLagVsTruthDays)
  ]);
  const widths = header.map((column, index) =>
    Math.max(column.length, ...lines.map((line) => line[index].length))
  );
  const render = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [
    render(header),
    render(widths.map((width) => "-".repeat(width))),
    ...lines.map(render),
    "",
    `narratives=${summary.narratives} attentionSignal=${summary.withAttentionSignal} emergingState=${summary.withEmergingState} truthLabels=${summary.withTruth}`,
    `median attention lead vs definition: ${formatDays(summary.medianAttentionLeadVsDefinitionDays)} (positive = signal visible before the narrative was defined)`,
    summary.withTruth > 0
      ? `median lag vs truth: attention ${formatDays(summary.medianAttentionLagVsTruthDays)}, emerging ${formatDays(summary.medianEmergingLagVsTruthDays)}, reviewed ${formatDays(summary.medianReviewedLagVsTruthDays)}; attention within 7d ${formatShare(summary.attentionWithin7DaysOfTruth)}, within 14d ${formatShare(summary.attentionWithin14DaysOfTruth)}`
      : "no truth dates supplied; pass --truth <file.json> mapping slug to YYYY-MM-DD to score detection lag"
  ].join("\n");
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** Days from `from` to `to`; null when either side is missing. */
function dayDiff(from: string | null, to: string | null) {
  const start = normalizeDate(from);
  const end = normalizeDate(to);
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.round((endMs - startMs) / 86_400_000);
}

function median(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const middle = Math.floor(present.length / 2);
  return present.length % 2 === 1
    ? present[middle]
    : (present[middle - 1] + present[middle]) / 2;
}

function share<T>(rows: T[], predicate: (row: T) => boolean) {
  if (rows.length === 0) return null;
  return Math.round((rows.filter(predicate).length / rows.length) * 1_000) / 1_000;
}

function within(lag: number | null, days: number) {
  return lag !== null && lag <= days;
}

function formatDays(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${value}d`;
}

function formatShare(value: number | null) {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}
