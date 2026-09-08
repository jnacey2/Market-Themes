import { publicHttpsUrl, resolvePublicUrl } from "./public-fetch";
import type {
  PublicationFeed,
  PublicationFeedInput,
  PublicationFeedPlatform
} from "@market-themes/db";

export function normalizePublicationFeedInput(input: {
  name: unknown;
  url: unknown;
  platform: unknown;
  publisherOwner?: unknown;
  retentionPolicy?: unknown;
  backfillDays?: unknown;
  maxPostsPerPoll?: unknown;
  termsNotes?: unknown;
}): PublicationFeedInput {
  const name = String(input.name ?? "").trim();
  const platform = String(input.platform ?? "") as PublicationFeedPlatform;
  const rawUrl = String(input.url ?? "").trim();

  if (!name) throw new Error("Publication name is required.");
  if (platform !== "substack" && platform !== "rss") {
    throw new Error("Platform must be substack or rss.");
  }

  const parsed = validatePublicHttpsUrl(rawUrl);
  const homepageUrl =
    platform === "substack"
      ? `${parsed.origin}/`
      : parsed.pathname.endsWith("/feed") || parsed.pathname.endsWith(".xml")
        ? `${parsed.origin}/`
        : parsed.toString();
  const feedUrl =
    platform === "substack" ? `${parsed.origin}/feed` : parsed.toString();
  const retentionPolicy =
    input.retentionPolicy === "snippet" ? "snippet" : "full_text";

  return {
    name,
    homepageUrl,
    feedUrl,
    platform,
    publisherOwner: String(input.publisherOwner ?? "").trim() || name,
    retentionPolicy,
    backfillDays: boundedInteger(input.backfillDays, 30, 1, 3650),
    maxPostsPerPoll: boundedInteger(input.maxPostsPerPoll, 50, 1, 250),
    rateLimitMs: 500,
    tags: platform === "substack" ? ["substack"] : ["rss"],
    termsNotes: String(
      input.termsNotes ??
        "Public feed/API content only; no paywall or authentication bypass."
    ).trim()
  };
}

export async function assertPublicNetworkUrl(value: string) {
  return (await resolvePublicUrl(value)).url;
}
export const validatePublicHttpsUrl = publicHttpsUrl;

export function publicationLookbackHours(feed: PublicationFeed, now = Date.now()) {
  if (!feed.lastPublishedAt) return feed.backfillDays * 24;
  const elapsed = Math.max(now - new Date(feed.lastPublishedAt).getTime(), 0);
  return Math.max(Math.ceil(elapsed / 3_600_000) + 6, 12);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}
