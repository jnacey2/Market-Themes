import { publicHttpsUrl, resolvePublicUrl } from "./public-fetch";
import type {
  PublicationFeed,
  PublicationFeedInput,
  PublicationFeedPlatform
} from "@market-themes/db";
import { resolvePublisherOwner } from "./publisher-owners";

export function normalizePublicationFeedInput(input: {
  name?: unknown;
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
  const name =
    String(input.name ?? "").trim() || inferPublicationNameFromUrl(rawUrl);
  if (!name) throw new Error("Publication name is required.");
  const homepageUrl = normalizeHomepageUrl(input.homepageUrl, parsed, platform);
  const feedUrl =
    platform === "substack" ? `${parsed.origin}/feed` : parsed.toString();
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
      input.termsNotes ??
        "Public feed/API content only; no paywall or authentication bypass."
    ).trim()
  };
}

export async function assertPublicNetworkUrl(value: string) {
  return (await resolvePublicUrl(value)).url;
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

export const validatePublicHttpsUrl = publicHttpsUrl;

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
    return homepage.pathname === "/"
      ? `${homepage.origin}/`
      : homepage.toString();
  }
  if (platform === "substack") {
    return `${feedUrl.origin}/`;
  }
  const path = feedUrl.pathname.toLowerCase();
  if (
    path.endsWith("/feed") ||
    path.endsWith(".xml") ||
    path.endsWith(".rss")
  ) {
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
