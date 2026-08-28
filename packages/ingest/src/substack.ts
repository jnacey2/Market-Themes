import { createHash } from "node:crypto";
import type { PersistableDocument, PublicationFeed } from "@market-themes/db";
import type { SourceConnector } from "./connectors";
import { assertPublicNetworkUrl } from "./publication-feed";
import { cleanHtml } from "./rss";

export const ARCHIVE_PAGE_SIZE = 25;
export const REQUEST_DELAY_SECONDS = 1.5;
export const REQUEST_TIMEOUT_SECONDS = 30;
export const RETRY_ATTEMPTS = 4;
export const RETRY_MIN_MS = 2_000;
export const RETRY_MAX_MS = 30_000;
export const PREVIEW_WORD_RATIO = 0.9;

export const CHROME_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
} as const;

const CLOUDFLARE_MARKERS = ["just a moment", "attention required", "cf-error", "cloudflare"];

export type SubstackPost = {
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

export type SubstackCookie = {
  name: string;
  value: string;
  domain?: string;
};

export type SubstackSession = {
  cookies: SubstackCookie[];
};

export type CachedSubstackPost = {
  slug: string;
  preview: boolean;
  decodeFailed?: boolean;
  post?: SubstackPost | null;
};

export type SubstackConnectorOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  skipNetworkValidation?: boolean;
  session?: SubstackSession | null;
  since?: string | null;
  refresh?: boolean;
  upgradePreviews?: boolean;
  cachedPosts?: Map<string, CachedSubstackPost>;
  requestDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class SubstackAccessError extends Error {
  readonly kind: "session" | "bot_block";

  constructor(kind: "session" | "bot_block", message: string) {
    super(message);
    this.kind = kind;
  }
}

export function createSubstackConnector(
  feed: PublicationFeed,
  options: SubstackConnectorOptions = {}
): SourceConnector {
  return {
    id: feed.id,
    sourceClass: "newspaper",
    description: `${feed.name} Substack archive.`,
    async poll() {
      return fetchSubstackPosts(feed, {
        ...options,
        session: options.session === undefined ? resolveSubstackSession() : options.session
      });
    }
  };
}

export async function fetchSubstackPosts(
  feed: PublicationFeed,
  options: SubstackConnectorOptions = {}
): Promise<PersistableDocument[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now?.() ?? Date.now();
  const sleepImpl = options.sleep ?? sleepFn;
  const delayMs = options.requestDelayMs ?? feed.rateLimitMs;
  const session = options.session === undefined ? resolveSubstackSession() : options.session;
  const origin = options.skipNetworkValidation
    ? stripTrailingSlash(new URL(feed.homepageUrl).origin)
    : stripTrailingSlash((await assertPublicNetworkUrl(feed.homepageUrl)).origin);
  const since = resolveSince(feed, options.since, now);
  const cachedPosts = options.cachedPosts ?? new Map<string, CachedSubstackPost>();
  const upgradePreviews = options.upgradePreviews ?? Boolean(session);
  const documents: PersistableDocument[] = [];
  const seen = new Set<string>();

  const { entries } = await fetchArchiveMetadata(origin, {
    fetchImpl,
    session,
    since,
    delayMs,
    sleep: sleepImpl,
    maxEntries: feed.maxPostsPerPoll
  });

  for (const preview of entries) {
    const slug = sanitizeSlug(preview.slug);
    if (!slug) continue;

    const cached = cachedPosts.get(slug);
    const shouldUpgrade = Boolean(
      session &&
        upgradePreviews &&
        cached &&
        (cached.preview || cached.decodeFailed || cached.post === null)
    );
    if (cached && !options.refresh && !shouldUpgrade) {
      continue;
    }

    if (delayMs > 0) await sleepImpl(delayMs);
    try {
      const detailUrl = new URL(`/api/v1/posts/${encodeURIComponent(slug)}`, `${origin}/`);
      const post = await fetchJson<SubstackPost>(fetchImpl, detailUrl, {
        session,
        delayMs,
        sleep: sleepImpl
      });
      const document = toSubstackDocument(feed, { ...preview, ...post, slug }, Boolean(session));
      const key = document.canonicalUrl ?? document.url;
      if (!seen.has(key)) {
        seen.add(key);
        documents.push(document);
      }
    } catch (error) {
      if (error instanceof SubstackAccessError) throw error;
      console.warn(
        `[substack] feed=${feed.id} slug=${slug} failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return documents.sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
}

export async function fetchArchiveMetadata(
  baseUrl: string,
  options: {
    fetchImpl?: typeof fetch;
    session?: SubstackSession | null;
    since?: string | null;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    maxEntries?: number;
  } = {}
): Promise<{ entries: SubstackPost[]; stoppedAtWatermark: boolean }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleep ?? sleepFn;
  const delayMs = options.delayMs ?? REQUEST_DELAY_SECONDS * 1_000;
  const origin = stripTrailingSlash(baseUrl);
  const sinceMs = parseUtcMs(options.since);
  const entries: SubstackPost[] = [];
  let offset = 0;
  let stoppedAtWatermark = false;

  while (entries.length < (options.maxEntries ?? Number.POSITIVE_INFINITY)) {
    const archiveUrl = new URL("/api/v1/archive", `${origin}/`);
    archiveUrl.searchParams.set("sort", "new");
    archiveUrl.searchParams.set("offset", String(offset));
    archiveUrl.searchParams.set("limit", String(ARCHIVE_PAGE_SIZE));
    const page = await fetchJson<SubstackPost[]>(fetchImpl, archiveUrl, {
      session: options.session,
      delayMs,
      sleep: sleepImpl
    });
    if (!Array.isArray(page) || page.length === 0) break;

    let reachedWatermark = false;
    for (const entry of page) {
      const entryMs = parseUtcMs(entry.post_date);
      if (sinceMs !== null && entryMs !== null && entryMs <= sinceMs) {
        reachedWatermark = true;
        break;
      }
      entries.push(entry);
      if (entries.length >= (options.maxEntries ?? Number.POSITIVE_INFINITY)) break;
    }

    if (reachedWatermark) {
      stoppedAtWatermark = true;
      break;
    }
    if (page.length < ARCHIVE_PAGE_SIZE) break;
    offset += page.length;
    if (delayMs > 0) await sleepImpl(delayMs);
  }

  return { entries, stoppedAtWatermark };
}

export function isPreview(post: SubstackPost): boolean {
  const audience = post.audience;
  if (!audience || audience === "everyone") return false;

  const reportedWords = Number.parseInt(String(post.wordcount ?? 0), 10) || 0;
  const deliveredWords = htmlToText(post.body_html ?? "").split(/\s+/).filter(Boolean).length;

  if (reportedWords > 0) {
    return deliveredWords < reportedWords * PREVIEW_WORD_RATIO;
  }
  return deliveredWords === 0;
}

export function sanitizeSlug(value: string | undefined): string | null {
  if (!value) return null;
  const slug = value.trim().replace(/[/\\]/g, "").replace(/\.\./g, "");
  return slug.length > 0 ? slug : null;
}

export function stripSubstackChrome(html: string): string {
  const withoutWidgets = html.replace(
    /<([a-z0-9]+)([^>]*class=["'][^"']*(?:subscribe|button-wrapper|post-ufi|digest|share-dialog|paywall|subscription-widget)[^"']*["'][^>]*)>[\s\S]*?<\/\1>/gi,
    " "
  );
  return withoutWidgets.replace(
    /<(p|div)([^>]*)>\s*(?:thanks for reading|share this post)[\s\S]*?<\/\1>/gi,
    " "
  );
}

export function htmlToText(html: string): string {
  return cleanHtml(stripSubstackChrome(html));
}

export function classifyHttpError(status: number, body: string): Error {
  if (status !== 401 && status !== 403) {
    return new Error(`Substack returned ${status}`);
  }
  const snippet = body.slice(0, 4_000).toLowerCase();
  if (CLOUDFLARE_MARKERS.some((marker) => snippet.includes(marker))) {
    return new SubstackAccessError(
      "bot_block",
      "Substack returned a Cloudflare or bot-check challenge; aborting scrape."
    );
  }
  return new SubstackAccessError(
    "session",
    "Substack session is missing or expired; aborting scrape."
  );
}

export function loadSubstackSession(
  env: NodeJS.ProcessEnv = process.env
): SubstackSession | null {
  const encoded = env.SUBSTACK_STORAGE_STATE_B64?.trim();
  if (!encoded) return null;
  return parseSubstackSession(encoded);
}

export function resolveSubstackSession(
  env: NodeJS.ProcessEnv = process.env
): SubstackSession | null {
  const encoded = env.SUBSTACK_STORAGE_STATE_B64?.trim();
  if (!encoded) return null;
  const session = parseSubstackSession(encoded);
  if (!isValidSubstackSession(session)) {
    throw new Error(
      "SUBSTACK_STORAGE_STATE_B64 is present but does not contain a Substack session cookie. Recapture with npm run substack:capture-session."
    );
  }
  return session;
}

export function parseSubstackSession(encoded: string): SubstackSession {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      cookies?: SubstackCookie[];
    };
    if (!Array.isArray(parsed.cookies)) {
      throw new Error("missing cookies");
    }
    return {
      cookies: parsed.cookies
        .filter((cookie) => cookie && typeof cookie.name === "string" && typeof cookie.value === "string")
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain
        }))
    };
  } catch {
    throw new Error("SUBSTACK_STORAGE_STATE_B64 is not valid base64 Playwright JSON.");
  }
}

export function isValidSubstackSession(session: SubstackSession | null): boolean {
  return Boolean(
    session &&
      session.cookies.length > 0 &&
      session.cookies.some((cookie) => /sid|substack/i.test(cookie.name))
  );
}

function toSubstackDocument(
  feed: PublicationFeed,
  post: SubstackPost,
  authenticated: boolean
): PersistableDocument {
  const slug = sanitizeSlug(post.slug) ?? "unknown";
  const preview = isPreview(post);
  const cleanedBody = htmlToText(post.body_html ?? "");
  const previewBody = cleanHtml(
    post.truncated_body_text ?? post.description ?? post.subtitle ?? ""
  );
  const fallback = previewBody || cleanedBody || post.title || "";
  const rawBody =
    feed.retentionPolicy === "snippet"
      ? (preview ? previewBody || cleanedBody : cleanedBody || previewBody).slice(0, 2_000)
      : cleanedBody || fallback;
  const body = preview
    ? `${rawBody}\n\nThis is a truncated preview; full subscriber content was not available.`.trim()
    : rawBody;
  const title = cleanHtml(post.title ?? slug);
  const canonicalUrl = canonicalizeUrl(
    post.canonical_url ?? `${stripTrailingSlash(new URL(feed.homepageUrl).origin)}/p/${slug}`
  );
  const publishedAt = parseUtcIso(post.post_date) ?? new Date().toISOString();

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
    publishedAt,
    tickers: [],
    summary: cleanHtml(post.subtitle ?? post.description ?? title).slice(0, 500),
    body,
    retrievalMethod: authenticated ? "credentialed" : "api",
    retentionPolicy: feed.retentionPolicy,
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateKey: createHash("sha256")
      .update(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .digest("hex"),
    metadata: {
      sourceName: feed.name,
      termsNotes: feed.termsNotes,
      platform: "substack",
      audience: post.audience ?? "everyone",
      content: preview ? "preview" : "full",
      substackSlug: slug,
      substackPostId: post.id,
      wordCount: post.wordcount,
      authors: post.publishedBylines?.map((author) => author.name).filter(Boolean) ?? [],
      tags: post.postTags?.map((tag) => tag.name).filter(Boolean) ?? [],
      authenticated
    }
  };
}

async function fetchJson<T>(
  fetchImpl: typeof fetch,
  url: URL,
  options: {
    session?: SubstackSession | null;
    delayMs: number;
    sleep: (ms: number) => Promise<void>;
  }
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: requestHeaders(url, options.session),
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_SECONDS * 1_000)
      });
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw classifyHttpError(response.status, text);
      }
      if (response.ok) {
        try {
          return JSON.parse(text) as T;
        } catch {
          lastError = new Error(`Substack returned invalid JSON for ${url.pathname}`);
        }
      } else if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`Substack returned ${response.status} for ${url.pathname}`);
      } else {
        throw new Error(`Substack returned ${response.status} for ${url.pathname}`);
      }
    } catch (error) {
      if (error instanceof SubstackAccessError) throw error;
      if (error instanceof Error && /returned [1-5]\d\d/.test(error.message) && !/429|5\d\d/.test(error.message)) {
        throw error;
      }
      lastError = error;
    }
    if (attempt < RETRY_ATTEMPTS) {
      await options.sleep(backoffMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function requestHeaders(url: URL, session: SubstackSession | null | undefined) {
  const headers: Record<string, string> = session
    ? { ...CHROME_HEADERS }
    : {
        Accept: "application/json",
        "User-Agent": process.env.SCRAPER_USER_AGENT ?? "MarketThemesBot/0.1"
      };
  const cookie = cookieHeader(session ?? null, url);
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function cookieHeader(session: SubstackSession | null, url: URL): string {
  if (!session) return "";
  return session.cookies
    .filter((cookie) => !cookie.domain || hostMatches(url.hostname, cookie.domain))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

function hostMatches(hostname: string, domain: string) {
  const normalized = domain.replace(/^\./, "").toLowerCase();
  const host = hostname.toLowerCase();
  return host === normalized || host.endsWith(`.${normalized}`);
}

function resolveSince(feed: PublicationFeed, since: string | null | undefined, now: number) {
  if (since) return parseUtcIso(since);
  if (feed.lastPublishedAt) return parseUtcIso(feed.lastPublishedAt);
  return new Date(now - feed.backfillDays * 86_400_000).toISOString();
}

function parseUtcMs(value: string | null | undefined): number | null {
  const iso = parseUtcIso(value);
  return iso ? new Date(iso).getTime() : null;
}

function parseUtcIso(value: string | null | undefined): string | null {
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

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function backoffMs(attempt: number) {
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, RETRY_MIN_MS * 2 ** (attempt - 1)));
}

function sleepFn(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
