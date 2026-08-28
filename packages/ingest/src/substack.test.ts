import assert from "node:assert/strict";
import test from "node:test";
import type { PublicationFeed } from "@market-themes/db";
import {
  normalizePublicationFeedInput,
  validatePublicHttpsUrl
} from "./publication-feed";
import {
  ARCHIVE_PAGE_SIZE,
  classifyHttpError,
  fetchArchiveMetadata,
  fetchSubstackPosts,
  isPreview,
  isValidSubstackSession,
  parseSubstackSession,
  resolveSubstackSession,
  sanitizeSlug,
  stripSubstackChrome,
  SubstackAccessError,
  cookieHeaderForUrl,
  loadSubstackSession,
  type CachedSubstackPost,
  type SubstackPost
} from "./substack";

test("infers newspaper owners and homepage URLs for RSS presets", () => {
  const input = normalizePublicationFeedInput({
    name: "NYT Business",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    homepageUrl: "https://www.nytimes.com/",
    platform: "rss",
    retentionPolicy: "snippet",
    tags: ["rss", "newspaper", "preset"],
    termsNotes: "Public RSS headline and summary only."
  });
  assert.equal(input.homepageUrl, "https://www.nytimes.com/");
  assert.equal(input.publisherOwner, "nyt");
  assert.equal(input.retentionPolicy, "snippet");
  assert.deepEqual(input.tags, ["rss", "newspaper", "preset"]);
});

test("normalizes Substack homepages and rejects private feed targets", () => {
  const input = normalizePublicationFeedInput({
    name: "Example Letter",
    url: "https://example.substack.com/about?utm_source=test",
    platform: "substack",
    termsNotes: "Public posts for internal research."
  });
  assert.equal(input.homepageUrl, "https://example.substack.com/");
  assert.equal(input.feedUrl, "https://example.substack.com/feed");
  assert.equal(input.rateLimitMs, 1500);
  assert.throws(() => validatePublicHttpsUrl("http://127.0.0.1/feed"), /must use HTTPS/);
  assert.throws(() => validatePublicHttpsUrl("https://localhost/feed"), /private network/);
});

test("classifies free, complete paid, and truncated paid previews", () => {
  assert.equal(isPreview({ audience: "everyone", wordcount: 200, body_html: "<p>short</p>" }), false);
  assert.equal(isPreview({ wordcount: 200, body_html: "<p>short</p>" }), false);
  assert.equal(
    isPreview({
      audience: "only_paid",
      wordcount: 10,
      body_html: `<p>${"word ".repeat(10)}</p>`
    }),
    false
  );
  assert.equal(
    isPreview({
      audience: "only_paid",
      wordcount: 100,
      body_html: `<p>${"word ".repeat(80)}</p>`
    }),
    true
  );
  assert.equal(isPreview({ audience: "only_paid", wordcount: 0, body_html: "" }), true);
  assert.equal(
    isPreview({ audience: "only_paid", wordcount: 0, body_html: "<p>full enough</p>" }),
    false
  );
});

test("treats the exact 90% preview boundary as full content", () => {
  assert.equal(
    isPreview({
      audience: "only_paid",
      wordcount: 100,
      body_html: `<p>${"word ".repeat(90)}</p>`
    }),
    false
  );
  assert.equal(
    isPreview({
      audience: "only_paid",
      wordcount: 100,
      body_html: `<p>${"word ".repeat(89)}</p>`
    }),
    true
  );
});

test("sanitizes slugs so path traversal cannot escape a publication directory", () => {
  assert.equal(sanitizeSlug("public-market-note"), "public-market-note");
  assert.equal(sanitizeSlug("../secret"), "secret");
  assert.equal(sanitizeSlug("a/b\\c"), "abc");
  assert.equal(sanitizeSlug(""), null);
  assert.equal(sanitizeSlug("..."), ".");
});

test("paginates newest-first archives and excludes the watermark boundary", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    requested.push(url.search);
    const offset = Number(url.searchParams.get("offset"));
    const page =
      offset === 0
        ? [archiveEntry("newer", "2026-08-20T12:00:00.000Z"), archiveEntry("boundary", "2026-08-10T12:00:00.000Z")]
        : [];
    return Response.json(page);
  }) as typeof fetch;

  const result = await fetchArchiveMetadata("https://example.substack.com", {
    fetchImpl,
    since: "2026-08-10T12:00:00.000Z",
    delayMs: 0,
    sleep: async () => undefined
  });

  assert.equal(result.stoppedAtWatermark, true);
  assert.deepEqual(
    result.entries.map((entry) => entry.slug),
    ["newer"]
  );
  assert.equal(requested.length, 1);
});

test("continues pagination through a short final archive page", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const offset = Number(new URL(String(input)).searchParams.get("offset"));
    if (offset === 0) {
      return Response.json(
        Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, index) =>
          archiveEntry(`page-one-${index}`, "2026-08-20T12:00:00.000Z")
        )
      );
    }
    return Response.json([archiveEntry("page-two", "2026-08-19T12:00:00.000Z")]);
  }) as typeof fetch;

  const result = await fetchArchiveMetadata("https://example.substack.com", {
    fetchImpl,
    delayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(result.stoppedAtWatermark, false);
  assert.equal(result.entries.length, ARCHIVE_PAGE_SIZE + 1);
  assert.equal(result.entries.at(-1)?.slug, "page-two");
});

test("skips cached posts unless refresh or authenticated preview upgrade is requested", async () => {
  const requested: string[] = [];
  const cachedPosts = new Map<string, CachedSubstackPost>([
    ["cached-full", { slug: "cached-full", preview: false }],
    ["cached-preview", { slug: "cached-preview", preview: true }]
  ]);
  const fetchImpl = archiveFetch(requested, [
    post("cached-full", { audience: "everyone" }),
    post("cached-preview", { audience: "only_paid", wordcount: 100, bodyHtml: "<p>short</p>" }),
    post("fresh-public", { audience: "everyone" })
  ]);

  const skipped = await fetchSubstackPosts(feed(), {
    fetchImpl,
    cachedPosts,
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.deepEqual(
    skipped.map((document) => document.metadata?.substackSlug),
    ["fresh-public"]
  );

  const refreshed = await fetchSubstackPosts(feed(), {
    fetchImpl,
    cachedPosts,
    refresh: true,
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(refreshed.length, 3);

  const upgraded = await fetchSubstackPosts(feed(), {
    fetchImpl,
    cachedPosts,
    session: { cookies: [{ name: "substack.sid", value: "abc" }] },
    upgradePreviews: true,
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.deepEqual(
    upgraded.map((document) => document.metadata?.substackSlug),
    ["cached-preview", "fresh-public"]
  );
});

test("refetches a corrupt cached post during an authenticated run", async () => {
  const requested: string[] = [];
  const documents = await fetchSubstackPosts(feed(), {
    fetchImpl: archiveFetch(requested, [post("corrupt-cache", { audience: "everyone" })]),
    cachedPosts: new Map([
      ["corrupt-cache", { slug: "corrupt-cache", preview: false, decodeFailed: true, post: null }]
    ]),
    session: { cookies: [{ name: "substack.sid", value: "abc" }] },
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(documents.length, 1);
  assert.equal(requested.some((url) => url.includes("/api/v1/posts/corrupt-cache")), true);
});

test("retries network, 429, 5xx, and invalid JSON, but not ordinary 4xx", async () => {
  const sleeps: number[] = [];
  let archiveAttempts = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/v1/archive")) {
      archiveAttempts += 1;
      if (archiveAttempts === 1) throw new Error("socket hang up");
      if (archiveAttempts === 2) return new Response("nope", { status: 429 });
      if (archiveAttempts === 3) return new Response("oops", { status: 503 });
      if (archiveAttempts === 4) return new Response("<html>", { status: 200 });
      return Response.json([archiveEntry("fresh", "2026-08-27T12:00:00.000Z")]);
    }
    return Response.json(post("fresh", { audience: "everyone" }));
  }) as typeof fetch;

  await assert.rejects(
    () =>
      fetchArchiveMetadata("https://example.substack.com", {
        fetchImpl,
        delayMs: 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        }
      }),
    /invalid JSON/
  );
  assert.equal(archiveAttempts, 4);
  assert.deepEqual(sleeps, [2_000, 4_000, 8_000]);

  const fourOhFour = (async () => new Response("missing", { status: 404 })) as typeof fetch;
  await assert.rejects(
    () =>
      fetchArchiveMetadata("https://example.substack.com", {
        fetchImpl: fourOhFour,
        delayMs: 0,
        sleep: async () => undefined
      }),
    /returned 404/
  );
});

test("classifies login failures separately from Cloudflare blocks", () => {
  const sessionError = classifyHttpError(401, "Please sign in to continue reading");
  const botError = classifyHttpError(403, "Just a moment... Cloudflare cf-error");
  assert(sessionError instanceof SubstackAccessError);
  assert(botError instanceof SubstackAccessError);
  assert.equal(sessionError.kind, "session");
  assert.equal(botError.kind, "bot_block");
});

test("continues after one isolated post failure and aborts on archive auth failure", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/api/v1/archive")) {
      return Response.json([
        archiveEntry("broken", "2026-08-27T13:00:00.000Z"),
        archiveEntry("healthy", "2026-08-27T12:00:00.000Z")
      ]);
    }
    if (url.includes("/posts/broken")) return new Response("missing", { status: 404 });
    return Response.json(post("healthy", { audience: "everyone" }));
  }) as typeof fetch;

  const documents = await fetchSubstackPosts(feed(), {
    fetchImpl,
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].metadata?.substackSlug, "healthy");

  const blocked = (async (input: string | URL | Request) => {
    if (String(input).includes("/api/v1/archive")) {
      return new Response("Just a moment attention required", { status: 403 });
    }
    throw new Error("should not fetch posts");
  }) as typeof fetch;
  await assert.rejects(
    () =>
      fetchSubstackPosts(feed(), {
        fetchImpl: blocked,
        now: () => Date.parse("2026-08-28T12:00:00.000Z"),
        skipNetworkValidation: true,
        requestDelayMs: 0,
        sleep: async () => undefined
      }),
    /Cloudflare/
  );
});

test("writes raw JSON fields into processed document metadata and preview markdown note", async () => {
  const documents = await fetchSubstackPosts(feed({ retentionPolicy: "full_text" }), {
    fetchImpl: archiveFetch([], [
      post("paid-preview", {
        audience: "only_paid",
        subtitle: "A paid argument",
        wordcount: 200,
        bodyHtml: "<p>Only a teaser.</p><div class='subscription-widget'>Subscribe</div>"
      })
    ]),
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].metadata?.content, "preview");
  assert.equal(documents[0].metadata?.audience, "only_paid");
  assert.equal(documents[0].metadata?.substackSlug, "paid-preview");
  assert.match(documents[0].body, /truncated preview/);
  assert.equal(documents[0].body.includes("Subscribe"), false);
});

test("stores a paid subscriber post as full text when the session returns the complete body", async () => {
  const body = `<p>${"Subscriber evidence about market conditions and corporate behavior. ".repeat(20)}</p>`;
  const documents = await fetchSubstackPosts(feed(), {
    fetchImpl: archiveFetch([], [
      post("paid-full", {
        audience: "only_paid",
        subtitle: "A paid subscriber argument",
        wordcount: 20,
        bodyHtml: body
      })
    ]),
    session: { cookies: [{ name: "substack.sid", value: "abc" }] },
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].metadata?.content, "full");
  assert.equal(documents[0].metadata?.audience, "only_paid");
  assert.equal(documents[0].retrievalMethod, "credentialed");
  assert.doesNotMatch(documents[0].body, /truncated preview/);
});

test("rejects a configured Substack session that has no subscriber cookie", () => {
  assert.throws(
    () =>
      resolveSubstackSession({
        SUBSTACK_STORAGE_STATE_B64: Buffer.from(
          JSON.stringify({ cookies: [{ name: "other", value: "x" }], origins: [] })
        ).toString("base64")
      }),
    /does not contain a Substack session cookie/
  );
});

test("incremental refresh is idempotent once a watermark is stored", async () => {
  const requested: string[] = [];
  const first = await fetchSubstackPosts(feed(), {
    fetchImpl: archiveFetch(requested, [post("fresh", { audience: "everyone" })]),
    now: () => Date.parse("2026-08-28T12:00:00.000Z"),
    skipNetworkValidation: true,
    requestDelayMs: 0,
    sleep: async () => undefined
  });
  assert.equal(first.length, 1);

  const second = await fetchSubstackPosts(
    feed({ lastPublishedAt: "2026-08-27T12:00:00.000Z" }),
    {
      fetchImpl: archiveFetch(requested, [post("fresh", { audience: "everyone" })]),
      since: "2026-08-27T12:00:00.000Z",
      now: () => Date.parse("2026-08-28T12:00:00.000Z"),
      skipNetworkValidation: true,
      requestDelayMs: 0,
      sleep: async () => undefined
    }
  );
  assert.equal(second.length, 0);
});

test("sends host-specific cookies to custom domains and not other publications", () => {
  const session = {
    cookies: [
      { name: "substack.sid", value: "sid", domain: ".substack.com" },
      { name: "connect.sid", value: "pine", domain: ".pinebrookcap.com" },
      { name: "connect.sid", value: "other", domain: ".fidenzamacro.com" }
    ]
  };
  const pinebrook = cookieHeaderForUrl(session, "https://www.pinebrookcap.com/api/v1/archive");
  assert.match(pinebrook, /connect\.sid=pine/);
  assert.doesNotMatch(pinebrook, /connect\.sid=other/);
  assert.doesNotMatch(pinebrook, /substack\.sid=sid/);

  const moontower = cookieHeaderForUrl(session, "https://moontower.substack.com/api/v1/posts/note");
  assert.match(moontower, /substack\.sid=sid/);
  assert.doesNotMatch(moontower, /connect\.sid=/);
});

test("selects the partition-matching cookie when several share a name", () => {
  const header = cookieHeaderForUrl(
    {
      cookies: [
        {
          name: "cf_clearance",
          value: "substack",
          domain: ".substack.com",
          partitionKey: "https://substack.com"
        },
        {
          name: "cf_clearance",
          value: "pinebrook",
          domain: ".substack.com",
          partitionKey: "https://pinebrookcap.com"
        },
        { name: "substack.sid", value: "sid", domain: ".substack.com" }
      ]
    },
    "https://moontower.substack.com/api/v1/archive"
  );
  assert.match(header, /cf_clearance=substack/);
  assert.doesNotMatch(header, /cf_clearance=pinebrook/);
  assert.match(header, /substack\.sid=sid/);
});

test("does not auto-load ignored .auth session files while tests run", () => {
  assert.equal(loadSubstackSession(), null);
});

test("loads a Playwright session from an explicit storage-state file", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "substack-session-"));
  const file = join(directory, "substack.storage-state.json");
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [{ name: "substack.sid", value: "from-file", domain: ".substack.com" }],
      origins: []
    })
  );
  const session = resolveSubstackSession({ SUBSTACK_STORAGE_STATE_PATH: file });
  assert.equal(session?.cookies[0]?.value, "from-file");
});

test("parses and validates Playwright Substack sessions", () => {
  const encoded = Buffer.from(
    JSON.stringify({
      cookies: [{ name: "substack.sid", value: "abc", domain: ".substack.com" }],
      origins: []
    })
  ).toString("base64");
  const session = parseSubstackSession(encoded);
  assert.equal(isValidSubstackSession(session), true);
  assert.equal(isValidSubstackSession({ cookies: [{ name: "other", value: "x" }] }), false);
  assert.throws(() => parseSubstackSession("nope"), /not valid/);
});

test("strips subscribe chrome before body extraction", () => {
  const html = stripSubstackChrome(
    `<p>Useful paragraph.</p><div class="share-dialog">Share this post with friends</div><p>Thanks for reading this note.</p>`
  );
  assert.match(html, /Useful paragraph/);
  assert.doesNotMatch(html, /Share this post with friends/i);
  assert.doesNotMatch(html, /Thanks for reading/i);
});

function archiveFetch(requested: string[], posts: SubstackPost[]) {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/api/v1/archive")) {
      return Response.json(
        posts.map((item) => archiveEntry(item.slug ?? "missing", item.post_date ?? "2026-08-27T12:00:00.000Z", item.audience))
      );
    }
    const slug = url.split("/api/v1/posts/")[1];
    const match = posts.find((item) => item.slug === slug);
    if (!match) throw new Error(`Unexpected request: ${url}`);
    return Response.json(match);
  }) as typeof fetch;
}

function archiveEntry(slug: string, postDate: string, audience = "everyone"): SubstackPost {
  return {
    id: slug.length,
    title: slug,
    slug,
    post_date: postDate,
    canonical_url: `https://example.substack.com/p/${slug}`,
    audience
  };
}

function post(
  slug: string,
  options: {
    audience?: string;
    subtitle?: string;
    wordcount?: number;
    bodyHtml?: string;
  } = {}
): SubstackPost {
  const body =
    options.bodyHtml ??
    `<p>${"Public evidence about market conditions and corporate behavior. ".repeat(3)}</p>`;
  return {
    id: slug.length,
    title: slug.replace(/-/g, " "),
    subtitle: options.subtitle ?? "A public macro argument",
    slug,
    post_date: "2026-08-27T12:00:00.000Z",
    canonical_url: `https://example.substack.com/p/${slug}?utm_source=email`,
    audience: options.audience ?? "everyone",
    body_html: body,
    wordcount: options.wordcount ?? 1_200
  };
}

function feed(overrides: Partial<PublicationFeed> = {}): PublicationFeed {
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
    lastError: null,
    ...overrides
  };
}
