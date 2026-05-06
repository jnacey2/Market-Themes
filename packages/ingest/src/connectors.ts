import type { SourceClass } from "@market-themes/db";

export type RawDocument = {
  sourceId: string;
  sourceClass: SourceClass;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  tickers: string[];
  body: string;
  retrievalMethod: "api" | "rss" | "credentialed" | "scrape" | "manual";
};

export type SourceConnector = {
  id: string;
  sourceClass: SourceClass;
  description: string;
  poll: () => Promise<RawDocument[]>;
};

export function createManualConnector(documents: RawDocument[]): SourceConnector {
  return {
    id: "manual",
    sourceClass: "manual",
    description: "User-provided article text, transcripts, or notes.",
    async poll() {
      return documents;
    }
  };
}

export function createPlaceholderConnector(
  id: string,
  sourceClass: SourceClass,
  description: string
): SourceConnector {
  return {
    id,
    sourceClass,
    description,
    async poll() {
      return [];
    }
  };
}

export const defaultConnectors: SourceConnector[] = [
  createPlaceholderConnector(
    "sec-filings",
    "filing",
    "SEC filing connector for S&P 500 and Nasdaq-100 backfills."
  ),
  createPlaceholderConnector(
    "company-ir",
    "press_release",
    "Company investor-relations press release connector."
  ),
  createPlaceholderConnector(
    "earnings-transcripts",
    "transcript",
    "Earnings call transcript connector for licensed or public sources."
  ),
  createPlaceholderConnector(
    "credentialed-news",
    "newspaper",
    "Credentialed news connector with controlled scraping fallback."
  )
];
