import { createHash } from "node:crypto";
import type { PersistableDocument, PublicationFeed } from "@market-themes/db";
import type { SourceConnector } from "./connectors";
import { assertPublicNetworkUrl, publicationLookbackHours } from "./publication-feed";
import { cleanHtml } from "./rss";

type SubstackPost = {
  id?: number;
  title?: string;
  subtitle?: string;
  slug?: string;
  post_date?: string;
  canonical_url?: string;
  audience?: string;
  body_html?: string | null;
  truncated_body_text?: string;
  description?: string;
  wordcount?: number;
  postTags?: Array<{ name?: string }>;
  publishedBylines?: Array<{ name?: string }>;
};

type SubstackConnectorOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  skipNetworkValidation?: boolean;
};

const ARCHIVE_PAGE_SIZE = 12;

export function createSubstackConnector(
  feed: PublicationFeed,
  options: SubstackConnectorOptions = {}
): SourceConnector {
  return {
    id: feed.id,
    sourceClass: "newspaper",
    description: `${feed.name} public Substack archive.`,
    async poll() {
      return fetchSubstackPosts(feed, options);
    }
  };
}

export async function fetchSubstackPosts(
  feed: PublicationFeed,
  options: SubstackConnectorOptions = {}
): Promise<PersistableDocument[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now?.() ?? Date.now();
  const origin = options.skipNetworkValidation
    ? new URL(feed.homepageUrl).origin
    : (await assertPublicNetworkUrl(feed.homepageUrl)).origin;
  const cutoff = now - publicationLookbackHours(feed, now) * 3_600_000;
  const documents: PersistableDocument[] = [];
  const seen = new Set<string>();

  for (
    let offset = 0;
    offset < feed.maxPostsPerPoll && documents.length < feed.maxPostsPerPoll;
    offset += ARCHIVE_PAGE_SIZE
  ) {
    const limit = Math.min(ARCHIVE_PAGE_SIZE, feed.maxPostsPerPoll - offset);
    const archiveUrl = new URL("/api/v1/archive", origin);
    archiveUrl.searchParams.set("sort", "new");
    archiveUrl.searchParams.set("offset", String(offset));
    archiveUrl.searchParams.set("limit", String(limit));
    const archive = await fetchJson<SubstackPost[]>(fetchImpl, archiveUrl, feed.rateLimitMs);
    if (!Array.isArray(archive) || archive.length === 0) break;

    let reachedCutoff = false;
    for (const preview of archive) {
      const publishedAt = normalizeDate(preview.post_date);
      if (!publishedAt || new Date(publishedAt).getTime() < cutoff) {
        reachedCutoff = true;
        continue;
      }
      if (preview.audience !== "everyone" || !preview.slug) {
        continue;
      }

      await sleep(feed.rateLimitMs);
      try {
        const detailUrl = new URL(`/api/v1/posts/${encodeURIComponent(preview.slug)}`, origin);
        const post = await fetchJson<SubstackPost>(fetchImpl, detailUrl, feed.rateLimitMs);
        const document = toSubstackDocument(feed, { ...preview, ...post });
        if (document && !seen.has(document.canonicalUrl ?? document.url)) {
          seen.add(document.canonicalUrl ?? document.url);
          documents.push(document);
        }
      } catch (error) {
        console.warn(
          `[substack] feed=${feed.id} slug=${preview.slug} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    if (reachedCutoff || archive.length < limit) break;
  }

  return documents;
}

function toSubstackDocument(
  feed: PublicationFeed,
  post: SubstackPost
): PersistableDocument | null {
  if (
    post.audience !== "everyone" ||
    !post.title ||
    !post.slug ||
    !post.canonical_url ||
    !post.post_date
  ) {
    return null;
  }

  const fullBody = cleanHtml(post.body_html ?? "");
  const previewBody = cleanHtml(
    post.truncated_body_text ?? post.description ?? post.subtitle ?? ""
  );
  const body =
    feed.retentionPolicy === "snippet"
      ? previewBody.slice(0, 2_000)
      : fullBody;
  if (body.length < 80) return null;

  const canonicalUrl = canonicalizeUrl(post.canonical_url);
  const title = cleanHtml(post.title);
  return {
    id: `${feed.id}:${post.id ?? createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16)}`,
    sourceId: feed.id,
    sourceClass: "newspaper",
    title,
    publisher: feed.name,
    publisherId: feed.publisherId,
    publisherOwner: feed.publisherOwner,
    url: canonicalUrl,
    canonicalUrl,
    publishedAt: new Date(post.post_date).toISOString(),
    tickers: [],
    summary: cleanHtml(post.subtitle ?? post.description ?? title).slice(0, 500),
    body,
    retrievalMethod: "api",
    retentionPolicy: feed.retentionPolicy,
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateKey: createHash("sha256")
      .update(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .digest("hex"),
    metadata: {
      sourceName: feed.name,
      termsNotes: feed.termsNotes,
      platform: "substack",
      audience: post.audience,
      substackPostId: post.id,
      wordCount: post.wordcount,
      authors: post.publishedBylines?.map((author) => author.name).filter(Boolean) ?? [],
      tags: post.postTags?.map((tag) => tag.name).filter(Boolean) ?? []
    }
  };
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: URL,
  rateLimitMs: number,
  attempts = 3
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": process.env.SCRAPER_USER_AGENT ?? "MarketThemesBot/0.1"
        },
        signal: AbortSignal.timeout(20_000)
      });
      if (response.ok) return (await response.json()) as T;
      lastError = new Error(`Substack returned ${response.status} for ${url.pathname}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.max(rateLimitMs, attempt * 1_000));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function normalizeDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function canonicalizeUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || ["ref", "source", "campaign"].includes(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
