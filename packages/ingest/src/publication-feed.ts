import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type {
  PublicationFeed,
  PublicationFeedInput,
  PublicationFeedPlatform
} from "@market-themes/db";
import { resolvePublisherOwner } from "./publisher-owners";

export function normalizePublicationFeedInput(input: {
  name: unknown;
  url: unknown;
  platform: unknown;
  publisherOwner?: unknown;
  retentionPolicy?: unknown;
  backfillDays?: unknown;
  maxPostsPerPoll?: unknown;
  homepageUrl?: unknown;
  tags?: unknown;
  termsNotes?: unknown;
}): PublicationFeedInput {
  const platform = String(input.platform ?? "") as PublicationFeedPlatform;
  const rawUrl = String(input.url ?? "").trim();

  if (platform !== "substack" && platform !== "rss") {
    throw new Error("Platform must be substack or rss.");
  }

  const parsed = validatePublicHttpsUrl(rawUrl);
  const name = String(input.name ?? "").trim() || inferPublicationNameFromUrl(rawUrl);
  if (!name) throw new Error("Publication name is required.");
  const homepageUrl = normalizeHomepageUrl(input.homepageUrl, parsed, platform);
  const feedUrl =
    platform === "substack"
      ? `${parsed.origin}/feed`
      : parsed.toString();
  const retentionPolicy =
    input.retentionPolicy === "snippet" ? "snippet" : "full_text";
  const explicitOwner = String(input.publisherOwner ?? "").trim();

  return {
    name,
    homepageUrl,
    feedUrl,
    platform,
    publisherOwner:
      explicitOwner ||
      resolvePublisherOwner({
        url: feedUrl,
        name,
        fallback: name
      }),
    retentionPolicy,
    backfillDays: boundedInteger(input.backfillDays, 30, 1, 3650),
    maxPostsPerPoll: boundedInteger(input.maxPostsPerPoll, 50, 1, 250),
    rateLimitMs: platform === "substack" ? 1_500 : 500,
    tags: normalizeTags(input.tags, platform),
    termsNotes: String(
      input.termsNotes ?? "Public feed/API content only; no paywall or authentication bypass."
    ).trim()
  };
}

export async function assertPublicNetworkUrl(value: string) {
  const url = validatePublicHttpsUrl(value);
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Feed URL must not target a private network.");
  }

  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address.address))) {
    throw new Error("Feed URL resolved to a private or unavailable network.");
  }
  return url;
}

export function inferPublicationNameFromUrl(value: string): string {
  let hostname: string;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  if (hostname.endsWith(".substack.com")) {
    return hostname.slice(0, -".substack.com".length) || "substack";
  }
  return hostname.split(".")[0] || hostname;
}

export function validatePublicHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid publication URL is required.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Publication feeds must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Publication URLs must not contain credentials.");
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error("Publication URL must not target a private network.");
  }
  url.hash = "";
  return url;
}

export function publicationLookbackHours(feed: PublicationFeed, now = Date.now()) {
  if (!feed.lastPublishedAt) return feed.backfillDays * 24;
  const elapsed = Math.max(now - new Date(feed.lastPublishedAt).getTime(), 0);
  return Math.max(Math.ceil(elapsed / 3_600_000) + 6, 12);
}

function normalizeHomepageUrl(
  value: unknown,
  feedUrl: URL,
  platform: PublicationFeedPlatform
) {
  if (typeof value === "string" && value.trim()) {
    const homepage = validatePublicHttpsUrl(value.trim());
    return homepage.pathname === "/" ? `${homepage.origin}/` : homepage.toString();
  }
  if (platform === "substack") {
    return `${feedUrl.origin}/`;
  }
  const path = feedUrl.pathname.toLowerCase();
  if (path.endsWith("/feed") || path.endsWith(".xml") || path.endsWith(".rss")) {
    return `${feedUrl.origin}/`;
  }
  return feedUrl.toString();
}

function normalizeTags(value: unknown, platform: PublicationFeedPlatform) {
  if (Array.isArray(value)) {
    const tags = value.map((item) => String(item).trim()).filter(Boolean);
    if (tags.length > 0) return tags;
  }
  return platform === "substack" ? ["substack"] : ["rss"];
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    (isIP(normalized) > 0 && isPrivateAddress(normalized))
  );
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  ) {
    return true;
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return false;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}
