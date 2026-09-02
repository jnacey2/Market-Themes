import { createHash } from "node:crypto";
import type { PersistableDocument } from "@market-themes/db";
import { resolveTargetTickers } from "./ticker-universe";

const SEC_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const SEC_ARCHIVES_BASE_URL = "https://www.sec.gov/Archives/edgar/data";
const DEFAULT_USER_AGENT = "MarketThemesBot/0.1 contact@example.com";
const DEFAULT_RATE_LIMIT_MS = 220;
const coreNarrativeForms = new Set(["10-K", "10-Q", "8-K"]);
const proxyForms = new Set(["DEF 14A", "DEFA14A", "PRE 14A"]);
const capitalMarketsForms = new Set([
  "S-1",
  "S-1/A",
  "S-3",
  "S-3/A",
  "S-4",
  "S-4/A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5"
]);
const ownershipForms = new Set(["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"]);
const stressForms = new Set(["NT 10-K", "NT 10-Q", "10-K/A", "10-Q/A", "8-K/A"]);
const structuredOwnershipForms = new Set(["13F-HR", "4"]);
const relevantExhibitTypes = new Set([
  "EX-99.1",
  "EX-99.2",
  "EX-99",
  "EX-10.1",
  "EX-10.2",
  "EX-2.1"
]);
const relevantExhibitExtensions = [".htm", ".html", ".txt"];

type FilingCategory =
  | "core"
  | "exhibit"
  | "proxy"
  | "capital_markets"
  | "ownership"
  | "stress"
  | "structured_ownership";

type SecFormConfig = {
  includeCoreForms: boolean;
  includeProxyForms: boolean;
  includeCapitalMarketsForms: boolean;
  includeOwnershipForms: boolean;
  includeStressForms: boolean;
  includeStructuredOwnershipForms: boolean;
  include8kExhibits: boolean;
};

export type SecConnectorOptions = {
  tickers?: string[];
  lookbackMonths?: number;
  lookbackDays?: number;
  maxFilingsPerTicker?: number;
  userAgent?: string;
  rateLimitMs?: number;
  formConfig?: Partial<SecFormConfig>;
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

type SecFilingTarget = {
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
  documentFile: string;
  documentType: string;
  documentDescription: string;
  documentKind: "primary" | "exhibit";
  archiveUrl: string;
  relevanceTier: "high" | "medium" | "low";
  filingCategory: FilingCategory;
  themeUseCase: string;
  parentAccessionNumber?: string;
  parentForm?: string;
  exhibitType?: string;
  exhibitDescription?: string;
};

type SecFilingIndexResponse = {
  directory?: {
    item?: Array<{
      name: string;
      type?: string;
      size?: string;
      "last-modified"?: string;
    }>;
  };
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
  const formConfig = resolveSecFormConfig(options.formConfig);

  return {
    id: "sec-filings",
    sourceClass: "filing" as const,
    description: "Official SEC submissions and filing document connector.",
    async poll() {
      const tickers = await resolveTargetTickers({ explicit: options.tickers });
      return fetchSecFilings({
        tickers,
        userAgent,
        rateLimitMs,
        maxFilingsPerTicker,
        formConfig,
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
  formConfig = resolveSecFormConfig(),
  since
}: {
  tickers: string[];
  userAgent: string;
  rateLimitMs?: number;
  maxFilingsPerTicker?: number;
  formConfig?: SecFormConfig;
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
      maxFilings: maxFilingsPerTicker,
      formConfig
    });

    for (const filing of filings) {
      await sleep(rateLimitMs);
      const body = await fetchFilingText(filing.archiveUrl, userAgent);

      if (!body.trim()) {
        continue;
      }

      documents.push(toPersistableDocument(filing, body));

      if (formConfig.include8kExhibits && filing.form === "8-K") {
        const exhibits = await fetchRelevantExhibits(filing, userAgent);

        for (const exhibit of exhibits) {
          await sleep(rateLimitMs);
          const exhibitBody = await fetchFilingText(exhibit.archiveUrl, userAgent);

          if (!exhibitBody.trim()) {
            continue;
          }

          documents.push(toPersistableDocument(exhibit, exhibitBody));
        }
      }
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
  maxFilings,
  formConfig
}: {
  ticker: string;
  cik: string;
  companyName: string;
  submission: SecSubmissionResponse;
  since: Date;
  maxFilings: number;
  formConfig: SecFormConfig;
}) {
  const recent = submission.filings.recent;
  const filings: SecFilingTarget[] = [];
  const enabledForms = getEnabledForms(formConfig);

  for (let index = 0; index < recent.accessionNumber.length; index += 1) {
    const form = recent.form[index];
    const filingDate = recent.filingDate[index];

    if (!enabledForms.has(form) || new Date(filingDate) < since) {
      continue;
    }

    const accessionNumber = recent.accessionNumber[index];
    const accessionNumberNoDashes = accessionNumber.replaceAll("-", "");
    const primaryDocument = recent.primaryDocument[index];
    const cikNoLeadingZeros = String(Number(cik));
    const items = recent.items[index] ?? "";
    const filingCategory = categorizeForm(form);

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
      documentFile: primaryDocument,
      documentType: form,
      documentDescription: recent.primaryDocDescription[index] ?? "",
      documentKind: "primary",
      archiveUrl: `${SEC_ARCHIVES_BASE_URL}/${cikNoLeadingZeros}/${accessionNumberNoDashes}/${primaryDocument}`,
      relevanceTier: classifyRelevance(form, items, recent.primaryDocDescription[index] ?? ""),
      filingCategory,
      themeUseCase: themeUseCaseForCategory(filingCategory)
    });

    if (filings.length >= maxFilings) {
      break;
    }
  }

  return filings;
}

async function fetchRelevantExhibits(
  filing: SecFilingTarget,
  userAgent: string
): Promise<SecFilingTarget[]> {
  const indexUrl = `${SEC_ARCHIVES_BASE_URL}/${String(Number(filing.cik))}/${filing.accessionNumberNoDashes}/index.json`;
  const response = await secFetch(indexUrl, userAgent);
  const data = (await response.json()) as SecFilingIndexResponse;
  const items = data.directory?.item ?? [];
  const exhibits: SecFilingTarget[] = [];

  for (const item of items) {
    if (!isRelevantExhibit(item, filing.primaryDocument)) {
      continue;
    }

    const exhibitType = normalizeExhibitType(item.type ?? inferExhibitType(item.name));

    exhibits.push({
      ...filing,
      documentFile: item.name,
      documentType: exhibitType,
      documentDescription: item.type ?? item.name,
      documentKind: "exhibit",
      archiveUrl: `${SEC_ARCHIVES_BASE_URL}/${String(Number(filing.cik))}/${filing.accessionNumberNoDashes}/${item.name}`,
      filingCategory: "exhibit",
      themeUseCase: "market_narrative",
      parentAccessionNumber: filing.accessionNumber,
      parentForm: filing.form,
      exhibitType,
      exhibitDescription: item.type ?? item.name,
      relevanceTier: classifyExhibitRelevance(exhibitType, item.name)
    });
  }

  return exhibits;
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
  filing: SecFilingTarget,
  body: string
): PersistableDocument {
  const sectionLabel = detectSectionLabel(body);
  const contentHash = createHash("sha256")
    .update(`${filing.accessionNumber}:${filing.documentFile}:${body}`)
    .digest("hex");

  return {
    id: `sec:${filing.accessionNumber}:${filing.documentFile}`.replaceAll(
      /[^a-zA-Z0-9:._-]/g,
      "-"
    ),
    sourceId: "sec-filings",
    sourceClass: "filing",
    title: filing.documentKind === "exhibit"
      ? `${filing.ticker} ${filing.form} ${filing.exhibitType} exhibit filed ${filing.filingDate}`
      : `${filing.ticker} ${filing.form} filed ${filing.filingDate}`,
    publisher: filing.companyName,
    url: filing.archiveUrl,
    publishedAt: filing.filingDate,
    tickers: [filing.ticker],
    summary: `${filing.companyName} ${filing.form} ${filing.documentKind}${sectionLabel ? `; detected section focus: ${sectionLabel}` : ""}.`,
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
      documentFile: filing.documentFile,
      documentType: filing.documentType,
      documentDescription: filing.documentDescription,
      documentKind: filing.documentKind,
      secUrl: filing.archiveUrl,
      relevanceTier: filing.relevanceTier,
      filingCategory: filing.filingCategory,
      themeUseCase: filing.themeUseCase,
      parentAccessionNumber: filing.parentAccessionNumber,
      parentForm: filing.parentForm,
      exhibitType: filing.exhibitType,
      exhibitDescription: filing.exhibitDescription,
      detectedSection: sectionLabel
    }
  };
}

function classifyRelevance(
  form: string,
  items: string,
  description: string
): "high" | "medium" | "low" {
  const filingCategory = categorizeForm(form);

  if (form === "10-K" || form === "10-Q" || filingCategory === "stress") {
    return "high";
  }

  if (filingCategory === "proxy" || filingCategory === "capital_markets") {
    return "medium";
  }

  if (filingCategory === "ownership") {
    return "medium";
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

function classifyExhibitRelevance(
  exhibitType: string,
  name: string
): "high" | "medium" | "low" {
  const haystack = `${exhibitType} ${name}`.toLowerCase();

  if (
    haystack.includes("99.1") ||
    haystack.includes("99.2") ||
    haystack.includes("earnings") ||
    haystack.includes("presentation") ||
    haystack.includes("investor")
  ) {
    return "high";
  }

  if (haystack.includes("10.") || haystack.includes("2.1")) {
    return "medium";
  }

  return "low";
}

function resolveSecFormConfig(
  overrides: Partial<SecFormConfig> = {}
): SecFormConfig {
  return {
    includeCoreForms: envFlag("SEC_INCLUDE_CORE_FORMS", true),
    includeProxyForms: envFlag("SEC_INCLUDE_PROXY_FORMS", true),
    includeCapitalMarketsForms: envFlag("SEC_INCLUDE_CAPITAL_MARKETS_FORMS", true),
    includeOwnershipForms: envFlag("SEC_INCLUDE_OWNERSHIP_FORMS", true),
    includeStressForms: envFlag("SEC_INCLUDE_STRESS_FORMS", true),
    includeStructuredOwnershipForms: envFlag(
      "SEC_INCLUDE_STRUCTURED_OWNERSHIP_FORMS",
      false
    ),
    include8kExhibits: envFlag("SEC_INCLUDE_8K_EXHIBITS", true),
    ...overrides
  };
}

function getEnabledForms(config: SecFormConfig) {
  const forms = new Set<string>();

  if (config.includeCoreForms) {
    addForms(forms, coreNarrativeForms);
  }

  if (config.includeProxyForms) {
    addForms(forms, proxyForms);
  }

  if (config.includeCapitalMarketsForms) {
    addForms(forms, capitalMarketsForms);
  }

  if (config.includeOwnershipForms) {
    addForms(forms, ownershipForms);
  }

  if (config.includeStressForms) {
    addForms(forms, stressForms);
  }

  if (config.includeStructuredOwnershipForms) {
    addForms(forms, structuredOwnershipForms);
  }

  return forms;
}

function addForms(target: Set<string>, source: Set<string>) {
  for (const form of source) {
    target.add(form);
  }
}

function categorizeForm(form: string): FilingCategory {
  if (coreNarrativeForms.has(form)) {
    return "core";
  }

  if (proxyForms.has(form)) {
    return "proxy";
  }

  if (capitalMarketsForms.has(form)) {
    return "capital_markets";
  }

  if (ownershipForms.has(form)) {
    return "ownership";
  }

  if (stressForms.has(form)) {
    return "stress";
  }

  if (structuredOwnershipForms.has(form)) {
    return "structured_ownership";
  }

  return "core";
}

function themeUseCaseForCategory(category: FilingCategory) {
  switch (category) {
    case "exhibit":
      return "market_narrative";
    case "proxy":
      return "governance_political_regulatory";
    case "capital_markets":
      return "capital_markets_risk_appetite";
    case "ownership":
      return "activism_ownership_change";
    case "stress":
      return "accounting_operational_stress";
    case "structured_ownership":
      return "structured_positioning";
    case "core":
    default:
      return "formal_disclosure";
  }
}

function isRelevantExhibit(
  item: { name: string; type?: string },
  primaryDocument: string
) {
  const name = item.name.toLowerCase();

  if (
    item.name === primaryDocument ||
    name.endsWith(".xml") ||
    name.endsWith(".xsd") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".gif")
  ) {
    return false;
  }

  if (!relevantExhibitExtensions.some((extension) => name.endsWith(extension))) {
    return false;
  }

  const exhibitType = normalizeExhibitType(item.type ?? inferExhibitType(item.name));

  if (relevantExhibitTypes.has(exhibitType)) {
    return true;
  }

  return [
    "earnings",
    "presentation",
    "investor",
    "merger",
    "restructuring",
    "financing",
    "guidance",
    "impairment"
  ].some((signal) => name.includes(signal));
}

function normalizeExhibitType(type: string) {
  return type.trim().toUpperCase().replace(/\s+/g, "");
}

function inferExhibitType(name: string) {
  const lower = name.toLowerCase();

  if (lower.includes("ex99") || lower.includes("ex-99")) {
    return "EX-99";
  }

  if (lower.includes("ex10") || lower.includes("ex-10")) {
    return "EX-10";
  }

  if (lower.includes("ex2") || lower.includes("ex-2")) {
    return "EX-2";
  }

  return name;
}

function envFlag(name: string, defaultValue: boolean) {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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
