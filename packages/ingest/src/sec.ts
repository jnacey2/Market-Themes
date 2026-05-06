import { createHash } from "node:crypto";
import type { PersistableDocument } from "@market-themes/db";
import { SEC_TARGET_TICKERS } from "./sec-targets";

const SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data";
const DEFAULT_USER_AGENT = "MarketThemesBot/0.1 contact@example.com";
const DEFAULT_RATE_LIMIT_MS = 220;
const CORE_FORMS = new Set(["10-K", "10-Q", "8-K"]);

export type SecConnectorOptions = {
  tickers?: string[];
  lookbackMonths?: number;
  lookbackDays?: number;
  maxFilingsPerTicker?: number;
  userAgent?: string;
  rateLimitMs?: number;
};

type SecTickerRecord = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecCompanyMap = Record<string, SecTickerRecord>;

type SecSubmissionResponse = {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      acceptanceDateTime: string[];
      act: string[];
      form: string[];
      fileNumber: string[];
      filmNumber: string[];
      items: string[];
      size: number[];
      isXBRL: number[];
      isInlineXBRL: number[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
};

type SecFiling = {
  ticker: string;
  cik: string;
  companyName: string;
  accessionNumber: string;
  accessionNumberNoDashes: string;
  form: string;
  filingDate: string;
  reportDate: string;
  items: string;
  primaryDocument: string;
  primaryDocDescription: string;
  archiveUrl: string;
  relevanceTier: "high" | "medium" | "low";
};

export function createSecFilingsConnector(options: SecConnectorOptions = {}) {
  const userAgent =
    options.userAgent ?? process.env.SEC_USER_AGENT ?? DEFAULT_USER_AGENT;
  const lookbackMonths = Number(
    options.lookbackMonths ?? process.env.SEC_BACKFILL_MONTHS ?? 0
  );
  const lookbackDays = Number(
    options.lookbackDays ?? process.env.SEC_POLL_LOOKBACK_DAYS ?? 7
  );
  const rateLimitMs = Number(
    options.rateLimitMs ?? process.env.SEC_RATE_LIMIT_MS ?? DEFAULT_RATE_LIMIT_MS
  );
  const maxFilingsPerTicker = Number(
    options.maxFilingsPerTicker ?? process.env.SEC_MAX_FILINGS_PER_TICKER ?? 10
  );
  const tickers =
    options.tickers ?? parseTickers(process.env.SEC_TARGET_TICKERS) ?? SEC_TARGET_TICKERS;

  return {
    id: "sec-filings",
    sourceClass: "filing" as const,
    description: "Official SEC submissions and filing document connector.",
    async poll() {
      return fetchSecFilings({
        tickers,
        userAgent,
        rateLimitMs,
        maxFilingsPerTicker,
        since: lookbackMonths > 0
          ? monthsAgo(lookbackMonths)
          : daysAgo(lookbackDays)
      });
    }
  };
}

export async function fetchSecFilings({
  tickers,
  userAgent,
  rateLimitMs = DEFAULT_RATE_LIMIT_MS,
  maxFilingsPerTicker = 10,
  since
}: {
  tickers: string[];
  userAgent: string;
  rateLimitMs?: number;
  maxFilingsPerTicker?: number;
  since: Date;
}): Promise<PersistableDocument[]> {
  const tickerMap = await fetchTickerMap(userAgent);
  const documents: PersistableDocument[] = [];

  for (const ticker of normalizeTickers(tickers)) {
    const company = tickerMap.get(normalizeTicker(ticker));

    if (!company) {
      console.warn(`[sec] no CIK mapping found for ${ticker}`);
      continue;
    }

    await sleep(rateLimitMs);
    const submission = await fetchCompanySubmission(company.cik, userAgent);
    const filings = selectFilings({
      ticker,
      companyName: company.companyName,
      cik: company.cik,
      submission,
      since,
      maxFilings: maxFilingsPerTicker
    });

    for (const filing of filings) {
      await sleep(rateLimitMs);
      const body = await fetchFilingText(filing.archiveUrl, userAgent);

      if (!body.trim()) {
        continue;
      }

      documents.push(toPersistableDocument(filing, body));
    }
  }

  return documents;
}

async function fetchTickerMap(userAgent: string) {
  const response = await secFetch(SEC_TICKER_MAP_URL, userAgent);
  const data = (await response.json()) as SecCompanyMap;
  const map = new Map<string, { cik: string; companyName: string }>();

  for (const record of Object.values(data)) {
    map.set(normalizeTicker(record.ticker), {
      cik: String(record.cik_str).padStart(10, "0"),
      companyName: record.title
    });
  }

  return map;
}

async function fetchCompanySubmission(cik: string, userAgent: string) {
  const response = await secFetch(
    `${SEC_SUBMISSIONS_BASE_URL}/CIK${cik}.json`,
    userAgent
  );

  return (await response.json()) as SecSubmissionResponse;
}

function selectFilings({
  ticker,
  cik,
  companyName,
  submission,
  since,
  maxFilings
}: {
  ticker: string;
  cik: string;
  companyName: string;
  submission: SecSubmissionResponse;
  since: Date;
  maxFilings: number;
}) {
  const recent = submission.filings.recent;
  const filings: SecFiling[] = [];

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const form = recent.form[index];
    const filingDate = recent.filingDate[index];

    if (!CORE_FORMS.has(form) || new Date(filingDate) < since) {
      continue;
    }

    const accessionNumber = recent.accessionNumber[index];
    const accessionNumberNoDashes = accessionNumber.replaceAll("-", "");
    const primaryDocument = recent.primaryDocument[index];
    const cikNoLeadingZeros = String(Number(cik));
    const items = recent.items[index] ?? "";

    filings.push({
      ticker: normalizeTicker(ticker),
      cik,
      companyName,
      accessionNumber,
      accessionNumberNoDashes,
      form,
      filingDate,
      reportDate: recent.reportDate[index] || filingDate,
      items,
      primaryDocument,
      primaryDocDescription: recent.primaryDocDescription[index] ?? "",
      archiveUrl: `${SEC_ARCHIVES_BASE_URL}/${cikNoLeadingZeros}/${accessionNumberNoDashes}/${primaryDocument}`,
      relevanceTier: classifyRelevance(form, items, recent.primaryDocDescription[index] ?? "")
    });

    if (filings.length >= maxFilings) {
      break;
    }
  }

  return filings;
}

async function fetchFilingText(url: string, userAgent: string) {
  const response = await secFetch(url, userAgent);
  const text = await response.text();
  return normalizeFilingText(text);
}

async function secFetch(url: string, userAgent: string, attempts = 3): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/json,text/html,text/plain,*/*",
          "Accept-Encoding": "gzip, deflate, br"
        }
      });

      if (response.ok) {
        return response;
      }

      lastError = new Error(`SEC request failed ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(attempt * 1_000);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function toPersistableDocument(
  filing: SecFiling,
  body: string
): PersistableDocument {
  const sectionLabel = detectSectionLabel(body);
  const contentHash = createHash("sha256")
    .update(`${filing.accessionNumber}:${filing.primaryDocument}:${body}`)
    .digest("hex");

  return {
    id: `sec:${filing.accessionNumber}:${filing.primaryDocument}`.replaceAll(
      /[^a-zA-Z0-9:._-]/g,
      "-"
    ),
    sourceId: "sec-filings",
    sourceClass: "filing",
    title: `${filing.ticker} ${filing.form} filed ${filing.filingDate}`,
    publisher: filing.companyName,
    url: filing.archiveUrl,
    publishedAt: filing.filingDate,
    tickers: [filing.ticker],
    summary: `${filing.companyName} ${filing.form} filing${sectionLabel ? `; detected section focus: ${sectionLabel}` : ""}.`,
    body,
    retrievalMethod: "api",
    contentHash,
    metadata: {
      cik: filing.cik,
      ticker: filing.ticker,
      companyName: filing.companyName,
      form: filing.form,
      accessionNumber: filing.accessionNumber,
      filingDate: filing.filingDate,
      reportDate: filing.reportDate,
      items: filing.items,
      primaryDocument: filing.primaryDocument,
      primaryDocDescription: filing.primaryDocDescription,
      secUrl: filing.archiveUrl,
      relevanceTier: filing.relevanceTier,
      detectedSection: sectionLabel
    }
  };
}

function classifyRelevance(
  form: string,
  items: string,
  description: string
): "high" | "medium" | "low" {
  if (form === "10-K" || form === "10-Q") {
    return "high";
  }

  const haystack = `${items} ${description}`.toLowerCase();
  const highSignals = [
    "2.02",
    "results of operations",
    "financial condition",
    "7.01",
    "regulation fd",
    "8.01",
    "other events",
    "9.01",
    "99.1",
    "earnings"
  ];
  const mediumSignals = [
    "1.01",
    "material definitive agreement",
    "2.01",
    "acquisition",
    "2.05",
    "exit",
    "2.06",
    "impairment",
    "3.02",
    "unregistered sales",
    "5.02",
    "departure"
  ];

  if (highSignals.some((signal) => haystack.includes(signal))) {
    return "high";
  }

  if (mediumSignals.some((signal) => haystack.includes(signal))) {
    return "medium";
  }

  return "low";
}

function normalizeFilingText(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSectionLabel(text: string) {
  const lower = text.slice(0, 50_000).toLowerCase();

  if (lower.includes("management's discussion and analysis")) {
    return "MD&A";
  }

  if (lower.includes("risk factors")) {
    return "Risk Factors";
  }

  if (lower.includes("results of operations")) {
    return "Results of Operations";
  }

  if (lower.includes("business")) {
    return "Business";
  }

  return null;
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
  return [...new Set(tickers.map(normalizeTicker))];
}

function normalizeTicker(ticker: string) {
  return ticker.toUpperCase().replace(".", "-");
}

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
