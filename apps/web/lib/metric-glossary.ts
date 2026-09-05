/**
 * One-sentence definitions for every metric the board shows. Rendered as
 * tooltips next to metric labels and in full on /how-to-read, so a reader only
 * has to learn each term once.
 */
export const METRIC_GLOSSARY = {
  density: {
    label: "Reviewed density",
    short: "Density",
    description:
      "Share of this week's readable documents that human or automatic review approved as evidence for the narrative, averaged across source classes so a busy news feed cannot drown out filings and transcripts."
  },
  attentionDensity: {
    label: "Raw attention",
    short: "Attention",
    description:
      "Same share as reviewed density, but counting every classifier match, including ones still waiting for review. It moves first; reviewed density confirms it."
  },
  zScore: {
    label: "z-score",
    short: "z",
    description:
      "How unusual this week is versus the narrative's own history, in standard deviations. Roughly: above 2 is rare, above 3 is exceptional, near 0 is normal. Provisional while the history is thin."
  },
  attentionZScore: {
    label: "Attention z-score",
    short: "attention z",
    description:
      "The z-score of raw attention rather than reviewed density; the earliest sign that something is moving."
  },
  change: {
    label: "7-day change",
    short: "7d change",
    description:
      "Reviewed density this week minus the previous seven-day window, in density points."
  },
  acceleration: {
    label: "Acceleration",
    short: "accel",
    description:
      "This week's change minus last week's change. Positive means the move is speeding up."
  },
  percentile: {
    label: "Percentile",
    short: "pct",
    description:
      "Where this week's reviewed density ranks against the narrative's own past windows. 100th means the highest reading in its history."
  },
  uniqueStories: {
    label: "Unique stories",
    short: "stories",
    description:
      "Approved documents after collapsing syndicated copies of the same story."
  },
  publisherGroups: {
    label: "Publisher groups",
    short: "publisher groups",
    description:
      "Independent owners behind the approved evidence. Ten outlets owned by one wire service count once."
  },
  coverage: {
    label: "Classification coverage",
    short: "coverage",
    description:
      "Share of this week's readable documents the classifier has processed. Below the threshold the narrative is unmeasured and no movement is reported."
  },
  peak: {
    label: "90-day peak",
    short: "peak",
    description:
      "Highest reviewed density in the trailing 90 days. 'At 90-day peak' means this week is the high; '40% of peak' means this week is well below it."
  },
  thinEvidence: {
    label: "Thin evidence",
    short: "thin evidence",
    description:
      "Fewer than three unique stories or fewer than two publisher groups this week. The reading is real but too narrow to be called rising or peaking."
  },
  thinBaseline: {
    label: "Thin baseline",
    short: "thin baseline",
    description:
      "The narrative has too few past windows to compare against, so z-scores and percentiles are provisional."
  },
  probationary: {
    label: "Probationary",
    short: "probationary",
    description:
      "Promoted automatically from discovery and not yet corroborated by enough independent stories to become an active definition."
  },
  corpusBurst: {
    label: "Corpus burst",
    short: "burst",
    description:
      "A phrase, entity or extracted theme that several independent publisher groups started covering this week, found by counting across the whole corpus without a model. Its z-score compares this week's story count with the prior twelve weeks."
  }
} as const;

export type MetricKey = keyof typeof METRIC_GLOSSARY;

export const METRIC_ORDER: MetricKey[] = [
  "density",
  "attentionDensity",
  "zScore",
  "attentionZScore",
  "change",
  "acceleration",
  "percentile",
  "peak",
  "uniqueStories",
  "publisherGroups",
  "coverage",
  "thinEvidence",
  "thinBaseline",
  "probationary",
  "corpusBurst"
];

export function metricTitle(key: MetricKey) {
  return METRIC_GLOSSARY[key].description;
}

/**
 * Measurement dates are UTC day buckets; make the timezone explicit wherever a
 * bare date would otherwise read as local time.
 */
export function formatMeasurementDate(date: string | null | undefined) {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return `${date} UTC`;
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC"
  }).format(parsed);
  return `${weekday} ${date} UTC`;
}
