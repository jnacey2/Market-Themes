import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { PersistableDocument, SourceClass } from "@market-themes/db";
import type { SourceConnector } from "./connectors";

export type RssFeedConfig = {
  id: string;
  name: string;
  url: string;
  sourceClass: Extract<SourceClass, "press_release" | "government" | "central_bank" | "newspaper">;
  publisherOwner?: string;
  tickers?: string[];
  retentionPolicy?: "full_text" | "snippet";
};

type FeedItem = {
  title?: string;
  link?: string | { "#text"?: string; "@_href"?: string };
  guid?: string | { "#text"?: string };
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  summary?: string;
  "content:encoded"?: string;
  content?: string | { "#text"?: string };
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text"
});

export function createRssConnector(config: RssFeedConfig): SourceConnector {
  return {
    id: config.id,
    sourceClass: config.sourceClass,
    description: `${config.name} RSS feed.`,
    async poll() {
      const response = await fetch(config.url, {
        headers: {
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
          "User-Agent": process.env.SCRAPER_USER_AGENT ?? "MarketThemesBot/0.1"
        }
      });

      if (!response.ok) {
        throw new Error(`${config.id} feed returned ${response.status}`);
      }

      const parsed = parser.parse(await response.text()) as Record<string, unknown>;
      const items = extractItems(parsed);
      const cutoff = Date.now() - Number(process.env.RSS_LOOKBACK_HOURS ?? 48) * 3_600_000;

      return items
        .map((item) => toDocument(config, item))
        .filter((document): document is PersistableDocument => document !== null)
        .filter((document) => new Date(document.publishedAt).getTime() >= cutoff);
    }
  };
}

export function createConfiguredRssConnectors(
  value: string | undefined,
  fallback: RssFeedConfig[] = []
) {
  if (!value) {
    return fallback.map(createRssConnector);
  }

  try {
    const configs = JSON.parse(value) as RssFeedConfig[];
    return configs.map(createRssConnector);
  } catch (error) {
    throw new Error(
      `Invalid RSS feed configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function extractItems(parsed: Record<string, unknown>): FeedItem[] {
  const rss = object(parsed.rss);
  const channel = object(rss?.channel);
  const feed = object(parsed.feed);
  const value = channel?.item ?? feed?.entry ?? [];
  return (Array.isArray(value) ? value : [value]).filter(isFeedItem);
}

function toDocument(config: RssFeedConfig, item: FeedItem): PersistableDocument | null {
  const title = text(item.title);
  const url = text(item.link) || text(item.guid);
  const publishedAt = normalizeDate(item.pubDate ?? item.published ?? item.updated);
  const body = cleanHtml(
    text(item["content:encoded"]) || text(item.content) || text(item.description) || text(item.summary)
  );

  if (!title || !url || !publishedAt || !body) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(url);
  const publisherId = slug(config.name);
  return {
    id: `${config.id}:${createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24)}`,
    sourceId: config.id,
    sourceClass: config.sourceClass,
    title,
    publisher: config.name,
    publisherId,
    publisherOwner: slug(config.publisherOwner ?? config.name),
    url,
    canonicalUrl,
    publishedAt,
    tickers: config.tickers ?? [],
    summary: cleanHtml(text(item.description) || title).slice(0, 500),
    body,
    retrievalMethod: "rss",
    retentionPolicy: config.retentionPolicy ?? "full_text",
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateKey: createHash("sha256").update(normalizeTitle(title)).digest("hex"),
    metadata: { feedUrl: config.url, publisherOwner: config.publisherOwner ?? config.name }
  };
}

function object(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isFeedItem(value: unknown): value is FeedItem {
  return Boolean(value) && typeof value === "object";
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  const record = object(value);
  return record ? text(record["#text"] ?? record["@_href"]) : "";
}

function cleanHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function canonicalizeUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["ref", "source", "campaign"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
