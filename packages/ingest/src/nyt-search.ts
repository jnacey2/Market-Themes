import { createHash } from "node:crypto";
import type { PersistableDocument } from "@market-themes/db";
import type { SourceConnector } from "./connectors";
import { resolvePublisherOwner } from "./publisher-owners";

const NYT_SEARCH_URL = "https://api.nytimes.com/svc/search/v2/articlesearch.json";
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_PAGE_LIMIT = 1;

type NytSearchDoc = {
  web_url?: string;
  snippet?: string;
  abstract?: string;
  headline?: { main?: string };
  pub_date?: string;
  source?: string;
};

export type NytSearchOptions = {
  apiKey?: string;
  lookbackHours?: number;
  pageLimit?: number;
  fetchImpl?: typeof fetch;
};

export function createNytSearchConnector(options: NytSearchOptions = {}): SourceConnector {
  return {
    id: "nyt-article-search",
    sourceClass: "newspaper",
    description: "NYT Article Search API abstracts.",
    async poll() {
      return fetchNytSearchArticles(options);
    }
  };
}

export async function fetchNytSearchArticles(
  options: NytSearchOptions = {}
): Promise<PersistableDocument[]> {
  const apiKey = options.apiKey ?? process.env.NYT_API_KEY;
  if (!apiKey) {
    return [];
  }

  const lookbackHours = Number(
    options.lookbackHours ?? process.env.NYT_SEARCH_LOOKBACK_HOURS ?? DEFAULT_LOOKBACK_HOURS
  );
  const pageLimit = Math.min(
    5,
    Math.max(1, Number(options.pageLimit ?? process.env.NYT_SEARCH_PAGE_LIMIT ?? DEFAULT_PAGE_LIMIT))
  );
  const beginDate = formatNytDate(new Date(Date.now() - lookbackHours * 3_600_000));
  const documents: PersistableDocument[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < pageLimit; page += 1) {
    const url = new URL(NYT_SEARCH_URL);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("sort", "newest");
    url.searchParams.set("begin_date", beginDate);
    url.searchParams.set("page", String(page));
    url.searchParams.set("fl", "web_url,headline,abstract,snippet,pub_date,source");

    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw new Error(`NYT Article Search returned ${response.status}`);
    }

    const payload = (await response.json()) as { response?: { docs?: NytSearchDoc[] } };
    const docs = payload.response?.docs ?? [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      const mapped = toDocument(doc);
      if (!mapped || seen.has(mapped.canonicalUrl ?? mapped.url)) continue;
      seen.add(mapped.canonicalUrl ?? mapped.url);
      documents.push(mapped);
    }
  }

  return documents;
}

function toDocument(doc: NytSearchDoc): PersistableDocument | null {
  const url = doc.web_url?.trim();
  const title = doc.headline?.main?.trim();
  const body = (doc.abstract || doc.snippet || "").trim();
  const publishedAt = normalizeDate(doc.pub_date);

  if (!url || !title || !body || !publishedAt) {
    return null;
  }

  const canonicalUrl = canonicalizeUrl(url);
  return {
    id: `nyt-article-search:${createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 24)}`,
    sourceId: "nyt-article-search",
    sourceClass: "newspaper",
    title,
    publisher: "The New York Times",
    publisherId: "nyt",
    publisherOwner: resolvePublisherOwner({
      url,
      name: doc.source ?? "The New York Times",
      fallback: "nyt"
    }),
    url,
    canonicalUrl,
    publishedAt,
    tickers: [],
    summary: body.slice(0, 500),
    body: body.slice(0, 2_000),
    retrievalMethod: "api",
    retentionPolicy: "snippet",
    contentHash: createHash("sha256").update(`${canonicalUrl}:${body}`).digest("hex"),
    nearDuplicateKey: createHash("sha256")
      .update(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 180))
      .digest("hex"),
    metadata: {
      sourceName: "The New York Times",
      nytSource: doc.source,
      termsNotes: "Official NYT Article Search abstracts; snippet retention only."
    }
  };
}

function formatNytDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function normalizeDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
