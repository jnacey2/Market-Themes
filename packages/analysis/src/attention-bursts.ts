/**
 * Corpus-level attention burst detection.
 *
 * Narrative discovery in this system is per-document: the model only sees one article at
 * a time and cannot know that fourteen unrelated publishers all started talking about the
 * same thing this week. This module looks at the whole corpus instead. It counts, per day,
 * how many unique stories mention each term (title n-grams, extracted entities, canonical
 * theme labels) and flags terms whose current-window count is unusual versus their own
 * trailing history, or that have no history at all. No model calls are involved.
 */

export type BurstTermKind = "title_ngram" | "entity" | "theme_label";

export type BurstCorpusDocument = {
  documentId: string;
  /** ISO date (YYYY-MM-DD) in UTC. */
  date: string;
  title: string;
  storyFingerprint: string;
  publisherOwner: string;
  entities?: string[];
  themeLabels?: string[];
};

export type AttentionBurst = {
  term: string;
  kind: BurstTermKind;
  currentStories: number;
  currentOwners: number;
  baselineMean: number;
  baselineScale: number;
  baselineWindows: number;
  zScore: number;
  novel: boolean;
  score: number;
  sampleDocumentIds: string[];
  sampleTitles: string[];
};

export type BurstDetectionOptions = {
  windowDays?: number;
  baselineDays?: number;
  minimumStories?: number;
  minimumOwners?: number;
  minimumZ?: number;
  maxResults?: number;
};

export const DEFAULT_BURST_OPTIONS: Required<BurstDetectionOptions> = {
  windowDays: 7,
  baselineDays: 84,
  minimumStories: 3,
  minimumOwners: 2,
  minimumZ: 2,
  maxResults: 60
};

const STOPWORDS = new Set(
  `a an and are as at be but by for from has have in is it its of on or that the this to was were will with
   after amid over under into onto than then their there these those they them he she his her we our you your
   about above across against along among around before behind below beneath beside between beyond during
   except inside near off out outside since through throughout till toward until up upon within without
   how what when where which who whom why would could should may might must can shall
   says said say new news report reports reported update updates live latest today week year years month months
   day days q1 q2 q3 q4 first second third fourth quarter quarterly annual fiscal results earnings call transcript
   inc corp co ltd plc llc group holdings company companies stock stocks shares share market markets
   million billion trillion percent pct vs versus more most less least very just also still yet even
   here now one two three four five six seven eight nine ten
   analysis opinion exclusive breaking wall street journal bloomberg reuters cnbc barrons financial times`
    .split(/\s+/)
    .filter(Boolean)
);

const GENERIC_ENTITIES = new Set([
  "the company",
  "company",
  "management",
  "investors",
  "the market",
  "market",
  "the fed",
  "wall street",
  "the economy",
  "analysts",
  "consumers",
  "customers"
]);

export function normalizeTerm(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9&%$.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleNgrams(title: string): string[] {
  const tokens = normalizeTerm(title)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token) && !/^\d+(\.\d+)?%?$/.test(token));
  const grams = new Set<string>();
  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const gram = tokens.slice(index, index + size);
      // require at least one alphabetic token of 3+ chars so grams like "$5 10" do not qualify
      if (!gram.some((token) => /[a-z]{3,}/.test(token))) continue;
      grams.add(gram.join(" "));
    }
  }
  return [...grams];
}

export function extractBurstTerms(
  document: BurstCorpusDocument
): Array<{ term: string; kind: BurstTermKind }> {
  const terms = new Map<string, BurstTermKind>();
  for (const gram of titleNgrams(document.title)) {
    terms.set(gram, "title_ngram");
  }
  for (const entity of document.entities ?? []) {
    const normalized = normalizeTerm(entity);
    if (normalized.length < 3 || GENERIC_ENTITIES.has(normalized) || STOPWORDS.has(normalized)) continue;
    terms.set(normalized, "entity");
  }
  for (const label of document.themeLabels ?? []) {
    const normalized = normalizeTerm(label);
    if (normalized.length < 4) continue;
    terms.set(normalized, "theme_label");
  }
  return [...terms.entries()].map(([term, kind]) => ({ term, kind }));
}

type TermDay = {
  stories: Set<string>;
  owners: Set<string>;
  documentIds: string[];
  titles: string[];
};

type TermSeries = {
  kind: BurstTermKind;
  days: Map<string, TermDay>;
};

export function detectAttentionBursts(
  documents: BurstCorpusDocument[],
  asOfDate: string,
  options: BurstDetectionOptions = {}
): AttentionBurst[] {
  const settings = { ...DEFAULT_BURST_OPTIONS, ...options };
  const series = new Map<string, TermSeries>();
  for (const document of documents) {
    if (document.date > asOfDate) continue;
    for (const { term, kind } of extractBurstTerms(document)) {
      let entry = series.get(term);
      if (!entry) {
        entry = { kind, days: new Map() };
        series.set(term, entry);
      } else if (kind !== "title_ngram" && entry.kind === "title_ngram") {
        // Prefer the structured kind when the same string appears as both.
        entry.kind = kind;
      }
      let day = entry.days.get(document.date);
      if (!day) {
        day = { stories: new Set(), owners: new Set(), documentIds: [], titles: [] };
        entry.days.set(document.date, day);
      }
      if (!day.stories.has(document.storyFingerprint)) {
        day.stories.add(document.storyFingerprint);
        if (day.documentIds.length < 5) {
          day.documentIds.push(document.documentId);
          day.titles.push(document.title);
        }
      }
      if (document.publisherOwner) day.owners.add(document.publisherOwner);
    }
  }

  const currentDates = enumerateDates(asOfDate, settings.windowDays);
  const baselineWindowCount = Math.floor(settings.baselineDays / settings.windowDays);
  const baselineWindows: string[][] = [];
  for (let index = 1; index <= baselineWindowCount; index += 1) {
    const end = shiftDate(asOfDate, -settings.windowDays * index);
    baselineWindows.push(enumerateDates(end, settings.windowDays));
  }

  const bursts: AttentionBurst[] = [];
  for (const [term, entry] of series) {
    const current = summarizeWindow(entry, currentDates);
    if (current.stories < settings.minimumStories) continue;
    if (current.owners < settings.minimumOwners) continue;
    const history = baselineWindows.map((dates) => summarizeWindow(entry, dates).stories);
    const baselineMean = average(history);
    const baselineScale = Math.max(1, Math.sqrt(Math.max(baselineMean, 0)), robustScale(history));
    const zScore = (current.stories - baselineMean) / baselineScale;
    const novel = history.every((value) => value === 0);
    if (!novel && zScore < settings.minimumZ) continue;
    bursts.push({
      term,
      kind: entry.kind,
      currentStories: current.stories,
      currentOwners: current.owners,
      baselineMean: round(baselineMean),
      baselineScale: round(baselineScale),
      baselineWindows: history.length,
      zScore: round(zScore),
      novel,
      score: round(novel ? current.stories + zScore : zScore),
      sampleDocumentIds: current.documentIds.slice(0, 5),
      sampleTitles: current.titles.slice(0, 5)
    });
  }

  return dedupeNestedTerms(
    bursts.sort(
      (left, right) =>
        right.score - left.score ||
        right.currentOwners - left.currentOwners ||
        wordCount(right.term) - wordCount(left.term) ||
        left.term.localeCompare(right.term)
    )
  ).slice(0, settings.maxResults);
}

/**
 * When a trigram bursts, its two constituent bigrams burst too. Keep the most specific
 * term and drop shorter terms fully contained in a higher-ranked one with the same sample.
 */
function dedupeNestedTerms(bursts: AttentionBurst[]) {
  const kept: AttentionBurst[] = [];
  for (const burst of bursts) {
    const dominated = kept.some(
      (other) =>
        other.kind === "title_ngram" &&
        burst.kind === "title_ngram" &&
        other.term !== burst.term &&
        (other.term.includes(burst.term) || burst.term.includes(other.term)) &&
        other.currentStories === burst.currentStories
    );
    if (!dominated) kept.push(burst);
  }
  return kept;
}

function summarizeWindow(entry: TermSeries, dates: string[]) {
  const stories = new Set<string>();
  const owners = new Set<string>();
  const documentIds: string[] = [];
  const titles: string[] = [];
  for (const date of dates) {
    const day = entry.days.get(date);
    if (!day) continue;
    for (const story of day.stories) stories.add(story);
    for (const owner of day.owners) owners.add(owner);
    for (let index = 0; index < day.documentIds.length; index += 1) {
      if (documentIds.length < 5) {
        documentIds.push(day.documentIds[index]);
        titles.push(day.titles[index]);
      }
    }
  }
  return { stories: stories.size, owners: owners.size, documentIds, titles };
}

function enumerateDates(end: string, days: number) {
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    dates.push(shiftDate(end, -offset));
  }
  return dates;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function average(values: number[]) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function robustScale(values: number[]) {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const center = median(sorted);
  const mad = median(sorted.map((value) => Math.abs(value - center)).sort((left, right) => left - right));
  return mad * 1.4826;
}

function median(sorted: number[]) {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function wordCount(term: string) {
  return term.split(" ").length;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
