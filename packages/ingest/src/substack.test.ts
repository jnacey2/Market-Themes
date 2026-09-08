import assert from "node:assert/strict";
import test from "node:test";
import type { PublicationFeed } from "@market-themes/db";
import {
  normalizePublicationFeedInput,
  validatePublicHttpsUrl
} from "./publication-feed";
import { fetchSubstackPosts } from "./substack";

test("normalizes Substack homepages and rejects private feed targets", () => {
  const input = normalizePublicationFeedInput({
    name: "Example Letter",
    url: "https://example.substack.com/about?utm_source=test",
    platform: "substack",
    termsNotes: "Public posts for internal research."
  });
  assert.equal(input.homepageUrl, "https://example.substack.com/");
  assert.equal(input.feedUrl, "https://example.substack.com/feed");
  assert.throws(
    () => validatePublicHttpsUrl("http://127.0.0.1/feed"),
    /must use HTTPS/
  );
  assert.throws(
    () => validatePublicHttpsUrl("https://localhost/feed"),
    /private network/
  );
});

test("backfills public Substack posts and skips paid-only bodies", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = input.toString();
    requested.push(url);
    if (url.includes("/api/v1/archive")) {
      return Response.json([
        {
          id: 1,
          title: "Public market note",
          slug: "public-market-note",
          post_date: "2026-08-27T12:00:00.000Z",
          canonical_url: "https://example.substack.com/p/public-market-note",
          audience: "everyone"
        },
        {
          id: 2,
          title: "Paid market note",
          slug: "paid-market-note",
          post_date: "2026-08-27T11:00:00.000Z",
          canonical_url: "https://example.substack.com/p/paid-market-note",
          audience: "only_paid"
        }
      ]);
    }
    if (url.endsWith("/api/v1/posts/public-market-note")) {
      return Response.json({
        id: 1,
        title: "Public market note",
        subtitle: "A public macro argument",
        slug: "public-market-note",
        post_date: "2026-08-27T12:00:00.000Z",
        canonical_url:
          "https://example.substack.com/p/public-market-note?utm_source=email",
        audience: "everyone",
        body_html: `<p>${"Public evidence about market conditions and corporate behavior. ".repeat(3)}</p>`,
        wordcount: 1200
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const documents = await fetchSubstackPosts(feed(), {
    fetchImpl,
    now: () => new Date("2026-08-28T12:00:00.000Z").getTime(),
    skipNetworkValidation: true
  });

  assert.equal(documents.length, 1);
  assert.equal(documents[0].title, "Public market note");
  assert.equal(
    documents[0].canonicalUrl,
    "https://example.substack.com/p/public-market-note"
  );
  assert.equal(documents[0].metadata?.audience, "everyone");
  assert.equal(
    requested.some((url) => url.includes("paid-market-note")),
    false
  );
});

function feed(): PublicationFeed {
  return {
    id: "publication:example",
    name: "Example Letter",
    homepageUrl: "https://example.substack.com/",
    feedUrl: "https://example.substack.com/feed",
    platform: "substack",
    sourceClass: "newspaper",
    publisherId: "example-letter",
    publisherOwner: "example-author",
    retentionPolicy: "full_text",
    enabled: true,
    backfillDays: 30,
    maxPostsPerPoll: 12,
    rateLimitMs: 0,
    tags: ["substack"],
    termsNotes: "Public posts only.",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastPublishedAt: null,
    lastError: null
  };
}

test("historical pagination continues beyond the newest poll even with a high-water mark", async () => {
  let progress:
    | {
        historyCursor: number;
        historyComplete: boolean;
        historyStartedAt: string;
      }
    | undefined;
  const posts = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    slug: `post-${i}`,
    title: `Post ${i}`,
    post_date: new Date(Date.UTC(2026, 7, 27 - i)).toISOString(),
    canonical_url: `https://example.substack.com/p/post-${i}`,
    audience: "everyone",
    body_html: `<p>${"Market evidence. ".repeat(10)} ${i}</p>`
  }));
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    return Response.json(
      url.pathname.endsWith("archive")
        ? posts.slice(
            Number(url.searchParams.get("offset")),
            Number(url.searchParams.get("offset")) +
              Number(url.searchParams.get("limit"))
          )
        : posts.find((p) => url.pathname.endsWith(p.slug))
    );
  }) as typeof fetch;
  const options = {
    fetchImpl,
    skipNetworkValidation: true,
    now: () => Date.UTC(2026, 7, 28),
    onProgress: (value: NonNullable<typeof progress>) => {
      progress = value;
    }
  };
  const first = await fetchSubstackPosts(feed(), options);
  assert.equal(first.length, 12);
  assert.equal(progress?.historyCursor, 12);
  const second = await fetchSubstackPosts(
    { ...feed(), ...progress, lastPublishedAt: first[0].publishedAt },
    options
  );
  assert.equal(second.length, 12);
  assert.equal(progress?.historyCursor, 24);
  assert.equal(new Set([...first, ...second].map((doc) => doc.id)).size, 24);
});
