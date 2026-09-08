import { createHash } from "node:crypto";
import type { PersistableDocument } from "@market-themes/db";
import type { SourceConnector } from "./connectors";
import { resolvePublisherOwner } from "./publisher-owners";

export const DEFAULT_GDELT_QUERY =
  '(markets OR economy OR inflation OR "interest rates" OR earnings) sourcelang:english';

export const DEFAULT_GDELT_DOMAINS = [
  "wsj.com",
  "nytimes.com",
  "bloomberg.com",
  "washingtonpost.com",
  "ft.com",
  "reuters.com"
];

export function parseGdeltDomains(
  value: string | undefined,
  fallback = DEFAULT_GDELT_DOMAINS
) {
  if (value === undefined) return fallback;
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

export function buildGdeltQuery(options: { query?: string; domains?: string[] } = {}) {
  const query = options.query?.trim() || DEFAULT_GDELT_QUERY;
  const domains = options.domains ?? DEFAULT_GDELT_DOMAINS;
  if (domains.length === 0) return query;
  return `${query} (${domains.map((domain) => `domain:${domain}`).join(" OR ")})`;
}

type GdeltArticle = {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

export function createGdeltConnector(): SourceConnector {
  return {
    id: "gdelt-news",
    sourceClass: "newspaper",
    description: "GDELT global news discovery metadata.",
    async poll() {
      if (process.env.GDELT_ENABLED !== "true") {
        return [];
      }

      const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
      url.searchParams.set(
        "query",
        buildGdeltQuery({
          query: process.env.GDELT_QUERY,
          domains: parseGdeltDomains(process.env.GDELT_DOMAINS)
        })
      );
      url.searchParams.set("mode", "ArtList");
      url.searchParams.set("format", "json");
      url.searchParams.set("maxrecords", process.env.GDELT_MAX_RECORDS ?? "100");
      url.searchParams.set("timespan", process.env.GDELT_TIMESPAN ?? "6h");
      url.searchParams.set("sort", "datedesc");

      const response = await fetch(url, {
        headers: { "User-Agent": process.env.SCRAPER_USER_AGENT ?? "MarketThemesBot/0.1" }
      });

      if (!response.ok) {
        throw new Error(`GDELT request returned ${response.status}`);
      }

      const payload = (await response.json()) as { articles?: GdeltArticle[] };
      return (payload.articles ?? [])
        .map(toDocument)
        .filter((document): document is PersistableDocument => Boolean(document));
    }
  };
}

function toDocument(article: GdeltArticle): PersistableDocument | null {
  const url = article.url?.trim() || article.url_mobile?.trim();
  const title = article.title?.trim();
  const publishedAt = parseGdeltDate(article.seendate);

  if (!url || !title || !publishedAt) {
    return null;
  }

  const domain = article.domain?.trim() || new URL(url).hostname;
  const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return {
    id: `gdelt-news:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`,
    sourceId: "gdelt-news",
    sourceClass: "newspaper",
    title,
    publisher: domain,
    publisherId: domain.toLowerCase(),
    publisherOwner: resolvePublisherOwner({
      url,
      site: domain,
      name: domain,
      fallback: domain
    }),
    url,
    canonicalUrl: url,
    publishedAt,
    tickers: [],
    summary: title,
    body: title,
    retrievalMethod: "api",
    retentionPolicy: "metadata_only",
    contentHash: createHash("sha256").update(url).digest("hex"),
    nearDuplicateKey: createHash("sha256").update(normalizedTitle.slice(0, 180)).digest("hex"),
    metadata: {
      discoveryOnly: true,
      language: article.language,
      sourceCountry: article.sourcecountry
    }
  };
}

function parseGdeltDate(value: string | undefined) {
  if (!value) return null;
  const normalized = value.includes("T")
    ? value
    : value.replace(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
        "$1-$2-$3T$4:$5:$6Z"
      );
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
