import { createHash } from "node:crypto";
import { detectTranscriptSections, type PersistableDocument } from "@market-themes/db";
import { SEC_SMOKE_TEST_TICKERS } from "./sec-targets";
import { resolveTargetTickers } from "./ticker-universe";

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";
const DEFAULT_RATE_LIMIT_MS = 250;

type FmpTranscriptDate = {
  symbol?: string;
  quarter?: number | string;
  year?: number | string;
  fiscalYear?: number | string;
  date?: string;
};

type FmpTranscriptResponse = {
  symbol?: string;
  quarter?: number | string;
  year?: number | string;
  date?: string;
  title?: string;
  content?: string;
  transcript?: string;
};

type FmpTranscriptTarget = {
  ticker: string;
  year: number;
  quarter: number;
  date: string | null;
};

export type FmpTranscriptOptions = {
  tickers?: string[];
  quarters?: number;
  latestOnly?: boolean;
  apiKey?: string;
  rateLimitMs?: number;
};

export function createFmpTranscriptsConnector(options: FmpTranscriptOptions = {}) {
  return {
    id: "fmp-transcripts",
    sourceClass: "transcript" as const,
    description: "Financial Modeling Prep earnings call transcript connector.",
    async poll() {
      return fetchFmpTranscripts({
        tickers:
          options.tickers ??
          parseTickers(process.env.FMP_TARGET_TICKERS) ??
          (await resolveTargetTickers()),
        quarters: Number(
          options.quarters ?? process.env.FMP_BACKFILL_QUARTERS ?? 8
        ),
        latestOnly: options.latestOnly ?? false,
        apiKey: options.apiKey ?? process.env.FMP_API_KEY,
        rateLimitMs: Number(
          options.rateLimitMs ??
            process.env.FMP_RATE_LIMIT_MS ??
            DEFAULT_RATE_LIMIT_MS
        )
      });
    }
  };
}

export async function fetchFmpSmokeTranscripts(options: FmpTranscriptOptions = {}) {
  return fetchFmpTranscripts({
    ...options,
    tickers: options.tickers ?? SEC_SMOKE_TEST_TICKERS,
    quarters: options.quarters ?? 2
  });
}

export async function fetchFmpTranscripts({
  tickers,
  quarters = 8,
  latestOnly = false,
  apiKey,
  rateLimitMs = DEFAULT_RATE_LIMIT_MS
}: FmpTranscriptOptions): Promise<PersistableDocument[]> {
  const resolvedApiKey = apiKey ?? process.env.FMP_API_KEY;

  if (!resolvedApiKey) {
    throw new Error("FMP_API_KEY is required for FMP transcript ingestion.");
  }

  const documents: PersistableDocument[] = [];

  for (const ticker of normalizeTickers(tickers ?? (await resolveTargetTickers()))) {
    await sleep(rateLimitMs);
    const targets = await discoverTranscriptTargets(ticker, resolvedApiKey);
    const selectedTargets = targets
      .sort((left, right) => sortTranscriptTargets(left, right))
      .slice(0, latestOnly ? 1 : quarters);

    if (selectedTargets.length === 0) {
      console.log(`[fmp] no transcripts discovered for ${ticker}`);
      continue;
    }

    for (const target of selectedTargets) {
      await sleep(rateLimitMs);
      const transcript = await fetchTranscript(target, resolvedApiKey);

      if (!transcript) {
        console.log(
          `[fmp] missing transcript for ${target.ticker} ${target.year} Q${target.quarter}`
        );
        continue;
      }

      documents.push(toPersistableDocument(target, transcript));
    }
  }

  return documents;
}

async function discoverTranscriptTargets(ticker: string, apiKey: string) {
  const url = fmpUrl("earning-call-transcript-dates", {
    symbol: ticker,
    apikey: apiKey
  });
  const response = await fmpFetch(url);
  const data = (await response.json()) as FmpTranscriptDate[];

  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((item) => {
      const quarter = Number(item.quarter);
      const year = Number(item.year ?? item.fiscalYear);

      if (!Number.isFinite(quarter) || !Number.isFinite(year)) {
        return null;
      }

      return {
        ticker,
        year,
        quarter,
        date: item.date ?? null
      };
    })
    .filter((item): item is FmpTranscriptTarget => item !== null);
}

async function fetchTranscript(target: FmpTranscriptTarget, apiKey: string) {
  const url = fmpUrl("earning-call-transcript", {
    symbol: target.ticker,
    year: String(target.year),
    quarter: String(target.quarter),
    apikey: apiKey
  });
  const response = await fmpFetch(url);
  const data = (await response.json()) as FmpTranscriptResponse[];

  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }

  return data[0];
}

async function fmpFetch(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (response.ok) {
        return response;
      }

      lastError = new Error(`FMP request failed ${response.status} for ${redactApiKey(url)}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(attempt * 1_000);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function toPersistableDocument(
  target: FmpTranscriptTarget,
  transcript: FmpTranscriptResponse
): PersistableDocument {
  const content = transcript.content ?? transcript.transcript ?? "";
  const normalized = normalizeTranscriptText(content);
  const sections = detectLegacyTranscriptSections(normalized);
  const sectioning = detectTranscriptSections(normalized);
  const speakerCount = countDetectedSpeakers(normalized);
  const qaSpan = sectioning.sections.find((span) => span.label === "qa");
  const publishedAt = transcript.date ?? target.date ?? `${target.year}-01-01`;
  const title =
    transcript.title ??
    `${target.ticker} Q${target.quarter} ${target.year} earnings call transcript`;
  const url = fmpUrl("earning-call-transcript", {
    symbol: target.ticker,
    year: String(target.year),
    quarter: String(target.quarter),
    apikey: "redacted"
  });
  const contentHash = createHash("sha256")
    .update(`${target.ticker}:${target.year}:Q${target.quarter}:${normalized}`)
    .digest("hex");

  return {
    id: `fmp:${target.ticker}:${target.year}:Q${target.quarter}`,
    sourceId: "fmp-transcripts",
    sourceClass: "transcript",
    title,
    publisher: `${target.ticker} earnings call`,
    url,
    publishedAt,
    tickers: [target.ticker],
    summary: `${target.ticker} Q${target.quarter} ${target.year} earnings call transcript.`,
    body: normalized,
    retrievalMethod: "api",
    contentHash,
    metadata: {
      ticker: target.ticker,
      year: target.year,
      quarter: target.quarter,
      callDate: publishedAt,
      fmpEndpoint: "earning-call-transcript",
      sectionsDetected: sections,
      speakerCount,
      transcriptSections: sectioning,
      qaStartOffset: sectioning.qaStartOffset,
      preparedRemarksChars: qaSpan ? qaSpan.start : normalized.length,
      qaChars: qaSpan ? qaSpan.end - qaSpan.start : 0
    }
  };
}

/**
 * Body normalization is intentionally frozen: the content hash is derived from
 * this output, so any change would re-ingest every stored transcript as a new
 * revision and trigger a full re-extraction. Section boundaries are computed
 * separately (see detectTranscriptSections) and stored as metadata offsets.
 */
function normalizeTranscriptText(content: string) {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(question-and-answer session|questions and answers)/gi, "\n\n[Q&A]\n$1")
    .replace(/(prepared remarks|presentation)/gi, "\n\n[Prepared Remarks]\n$1")
    .trim();
}

function detectLegacyTranscriptSections(content: string) {
  const lower = content.toLowerCase();
  const sections: string[] = [];

  if (lower.includes("[prepared remarks]") || lower.includes("prepared remarks")) {
    sections.push("prepared_remarks");
  }

  if (lower.includes("[q&a]") || lower.includes("question-and-answer")) {
    sections.push("qa");
  }

  return sections;
}

function countDetectedSpeakers(content: string) {
  const matches = content.match(/(?:^|\n)[A-Z][A-Za-z .'-]{2,80}:/g);
  return new Set(matches ?? []).size;
}

function sortTranscriptTargets(left: FmpTranscriptTarget, right: FmpTranscriptTarget) {
  if (right.year !== left.year) {
    return right.year - left.year;
  }

  return right.quarter - left.quarter;
}

function fmpUrl(path: string, params: Record<string, string>) {
  const url = new URL(`${FMP_BASE_URL}/${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function redactApiKey(url: string) {
  return url.replace(/apikey=[^&]+/i, "apikey=redacted");
}

function parseTickers(value: string | undefined) {
  if (!value) {
    return null;
  }

  return value
    .split(",")
    .map((ticker) => ticker.trim())
    .filter(Boolean);
}

function normalizeTickers(tickers: string[]) {
  return [...new Set(tickers.map((ticker) => ticker.toUpperCase().replace(".", "-")))];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
