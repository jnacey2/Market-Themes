import { createHash } from "node:crypto";
import type { PersistableDocument } from "@market-themes/db";
import { SEC_SMOKE_TEST_TICKERS, SEC_TARGET_TICKERS } from "./sec-targets";

const FMP_BASE_URL_V3 = "https://financialmodelingprep.com/api/v3";
const FMP_BASE_URL_V4 = "https://financialmodelingprep.com/api/v4";
const DEFAULT_RATE_LIMIT_MS = 250;
const DEFAULT_LOOKBACK_HOURS = 6;
const DEFAULT_NEWS_LIMIT = 50;

const MACRO_PROXY_TICKERS = ["SPY", "QQQ", "TLT", "GLD"];

type FmpStockNewsItem = {
  symbol?: string;
  publishedDate?: string;
  title?: string;
  image?: string;
  site?: string;
  text?: string;
  url?: string;
};

type FmpGeneralNewsItem = {
  publishedDate?: string;
  title?: string;
  image?: string;
  site?: string;
  text?: string;
  url?: string;
};

export type FmpNewsOptions = {
  tickers?: string[];
  macroProxies?: string[];
  lookbackHours?: number;
  newsLimit?: number;
  apiKey?: string;
  rateLimitMs?: number;
  smokeTest?: boolean;
};

export function createFmpNewsConnector(options: FmpNewsOptions = {}) {
  return {
    id: "fmp-news",
    sourceClass: "newspaper" as const,
    description: "Financial Modeling Prep news connector (stock news + general market news).",
    async poll() {
      return fetchFmpNews({
        tickers:
          options.tickers ??
          parseTickers(process.env.FMP_NEWS_TICKERS) ??
          SEC_TARGET_TICKERS,
        macroProxies:
          options.macroProxies ??
          parseTickers(process.env.FMP_NEWS_MACRO_PROXIES) ??
          MACRO_PROXY_TICKERS,
        lookbackHours: Number(
          options.lookbackHours ??
            process.env.FMP_NEWS_LOOKBACK_HOURS ??
            DEFAULT_LOOKBACK_HOURS
        ),
        newsLimit: Number(
          options.newsLimit ?? process.env.FMP_NEWS_LIMIT ?? DEFAULT_NEWS_LIMIT
        ),
        apiKey: options.apiKey ?? process.env.FMP_API_KEY,
        rateLimitMs: Number(
          options.rateLimitMs ??
            process.env.FMP_NEWS_RATE_LIMIT_MS ??
            process.env.FMP_RATE_LIMIT_MS ??
            DEFAULT_RATE_LIMIT_MS
        )
      });
    }
  };
}

export async function fetchFmpSmokeNews(options: FmpNewsOptions = {}) {
  return fetchFmpNews({
    ...options,
    tickers: options.tickers ?? SEC_SMOKE_TEST_TICKERS,
    macroProxies: options.macroProxies ?? MACRO_PROXY_TICKERS,
    lookbackHours: options.lookbackHours ?? 48
  });
}

export async function fetchFmpNews({
  tickers,
  macroProxies = MACRO_PROXY_TICKERS,
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
  newsLimit = DEFAULT_NEWS_LIMIT,
  apiKey,
  rateLimitMs = DEFAULT_RATE_LIMIT_MS
}: FmpNewsOptions): Promise<PersistableDocument[]> {
  const resolvedApiKey = apiKey ?? process.env.FMP_API_KEY;

  if (!resolvedApiKey) {
    throw new Error("FMP_API_KEY is required for FMP news ingestion.");
  }

  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const allDocuments: PersistableDocument[] = [];
  const seenUrls = new Set<string>();

  const allTickers = dedupeTickers([
    ...(tickers ?? SEC_TARGET_TICKERS),
    ...macroProxies
  ]);

  for (const ticker of allTickers) {
    await sleep(rateLimitMs);

    const items = await fetchStockNews(ticker, newsLimit, resolvedApiKey);
    const recent = items.filter((item) => isAfterCutoff(item.publishedDate, cutoff));

    for (const item of recent) {
      const doc = stockNewsToDocument(ticker, item);

      if (doc && !seenUrls.has(doc.url)) {
        seenUrls.add(doc.url);
        allDocuments.push(doc);
      }
    }

    if (recent.length > 0) {
      console.log(`[fmp-news] ${ticker}: ${recent.length} articles`);
    }
  }

  await sleep(rateLimitMs);

  const generalItems = await fetchGeneralNews(newsLimit, resolvedApiKey);
  const recentGeneral = generalItems.filter((item) =>
    isAfterCutoff(item.publishedDate, cutoff)
  );

  for (const item of recentGeneral) {
    const doc = generalNewsToDocument(item);

    if (doc && !seenUrls.has(doc.url)) {
      seenUrls.add(doc.url);
      allDocuments.push(doc);
    }
  }

  console.log(
    `[fmp-news] general: ${recentGeneral.length} articles; total unique: ${allDocuments.length}`
  );

  return allDocuments;
}

async function fetchStockNews(
  ticker: string,
  limit: number,
  apiKey: string
): Promise<FmpStockNewsItem[]> {
  const url = buildV3Url("stock_news", {
    tickers: ticker,
    limit: String(limit),
    apikey: apiKey
  });

  try {
    const response = await fmpFetch(url);
    const data = (await response.json()) as FmpStockNewsItem[];
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(
      `[fmp-news] stock news fetch failed for ${ticker}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

async function fetchGeneralNews(
  limit: number,
  apiKey: string
): Promise<FmpGeneralNewsItem[]> {
  const url = buildV4Url("general_news", {
    page: "0",
    limit: String(limit),
    apikey: apiKey
  });

  try {
    const response = await fmpFetch(url);
    const data = (await response.json()) as FmpGeneralNewsItem[];
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(
      `[fmp-news] general news fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

function stockNewsToDocument(
  ticker: string,
  item: FmpStockNewsItem
): PersistableDocument | null {
  const url = item.url?.trim();
  const title = item.title?.trim();
  const body = item.text?.trim();
  const publishedAt = normalizeDate(item.publishedDate);
  const publisher = item.site?.trim() ?? "FMP News";

  if (!url || !title || !body || !publishedAt) {
    return null;
  }

  const contentHash = createHash("sha256").update(`${url}:${body}`).digest("hex");

  return {
    id: `fmp-news:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
    sourceId: "fmp-news",
    sourceClass: "newspaper",
    title,
    publisher,
    url,
    publishedAt,
    tickers: [ticker],
    summary: title,
    body,
    retrievalMethod: "api",
    contentHash,
    metadata: {
      ticker,
      site: item.site,
      fmpEndpoint: "stock_news"
    }
  };
}

function generalNewsToDocument(item: FmpGeneralNewsItem): PersistableDocument | null {
  const url = item.url?.trim();
  const title = item.title?.trim();
  const body = item.text?.trim();
  const publishedAt = normalizeDate(item.publishedDate);
  const publisher = item.site?.trim() ?? "FMP News";

  if (!url || !title || !body || !publishedAt) {
    return null;
  }

  const contentHash = createHash("sha256").update(`${url}:${body}`).digest("hex");

  return {
    id: `fmp-news:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
    sourceId: "fmp-news",
    sourceClass: "newspaper",
    title,
    publisher,
    url,
    publishedAt,
    tickers: [],
    summary: title,
    body,
    retrievalMethod: "api",
    contentHash,
    metadata: {
      site: item.site,
      fmpEndpoint: "general_news"
    }
  };
}

async function fmpFetch(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" }
      });

      if (response.ok) {
        return response;
      }

      lastError = new Error(
        `FMP request failed ${response.status} for ${redactApiKey(url)}`
      );
    } catch (error) {
      lastError = error;
    }

    await sleep(attempt * 1_000);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function buildV3Url(path: string, params: Record<string, string>) {
  const url = new URL(`${FMP_BASE_URL_V3}/${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function buildV4Url(path: string, params: Record<string, string>) {
  const url = new URL(`${FMP_BASE_URL_V4}/${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function isAfterCutoff(publishedDate: string | undefined, cutoff: Date): boolean {
  if (!publishedDate) {
    return false;
  }

  const parsed = new Date(publishedDate);
  return Number.isFinite(parsed.getTime()) && parsed >= cutoff;
}

function dedupeTickers(tickers: string[]) {
  return [...new Set(tickers.map((t) => t.toUpperCase().replace(".", "-")))];
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
    .map((t) => t.trim())
    .filter(Boolean);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
