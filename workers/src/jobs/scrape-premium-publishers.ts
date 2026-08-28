import { createHash } from "node:crypto";
import {
  chromium,
  type BrowserContext,
  type Page
} from "playwright";
import {
  persistDocuments,
  recordConnectorCheckpoint,
  type PersistableDocument
} from "@market-themes/db";
import { createRssConnector } from "@market-themes/ingest";
import {
  decodeStorageState,
  isAllowedPublisherUrl,
  parsePremiumPublisherIds,
  premiumPublisherProfiles,
  type PremiumPublisherProfile
} from "../premium-publishers";

const publisherIds = parsePremiumPublisherIds(process.env.PREMIUM_PUBLISHERS);
const maxArticles = Number(process.env.PREMIUM_SCRAPER_MAX_ARTICLES ?? 5);
const lookbackHours = Number(process.env.PREMIUM_SCRAPER_LOOKBACK_HOURS ?? 24);
const rateLimitMs = Number(process.env.PREMIUM_SCRAPER_RATE_LIMIT_MS ?? 2_000);

if (process.env.SCRAPING_ENABLED !== "true") {
  console.log("[premium-scraper] SCRAPING_ENABLED is not true; exiting");
  process.exit(0);
}

if (publisherIds.length === 0) {
  console.log("[premium-scraper] no publishers enabled");
  process.exit(0);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage"]
});
let failedPublishers = 0;

try {
  for (const publisherId of publisherIds) {
    const profile = premiumPublisherProfiles[publisherId];
    const connectorId = `premium-${profile.id}`;
    const encodedState = process.env[profile.sessionEnvKey];

    if (!encodedState) {
      failedPublishers += 1;
      const error = `${profile.sessionEnvKey} is required. Capture and add the publisher session before enabling this source.`;
      console.error(`[premium-scraper] publisher=${profile.id} ${error}`);
      await recordConnectorCheckpoint({ connectorId, success: false, error });
      continue;
    }

    let context: BrowserContext | null = null;
    try {
      const configuredUserAgent = process.env.PREMIUM_SCRAPER_USER_AGENT?.trim();
      context = await browser.newContext({
        storageState: decodeStorageState(encodedState) as Awaited<
          ReturnType<BrowserContext["storageState"]>
        >,
        ...(configuredUserAgent ? { userAgent: configuredUserAgent } : {})
      });
      const discovered = await discoverArticles(profile);
      const documents: PersistableDocument[] = [];
      const page = await context.newPage();

      for (const article of discovered.slice(0, maxArticles)) {
        await sleep(rateLimitMs);
        try {
          documents.push(await scrapeArticle(page, article, profile));
        } catch (error) {
          if (error instanceof PublisherAccessError) {
            throw error;
          }
          console.warn(
            `[premium-scraper] publisher=${profile.id} article=${article.url} skipped: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      const persisted = await persistDocuments(documents);
      await recordConnectorCheckpoint({
        connectorId,
        success: true,
        documentsFetched: documents.length,
        documentsInserted: persisted.insertedDocuments,
        lastDocumentAt: newestDate(documents),
        metadata: {
          discovered: discovered.length,
          skipped: discovered.length - documents.length,
          chunks: persisted.insertedChunks
        }
      });
      console.log(
        `[premium-scraper] publisher=${profile.id} discovered=${discovered.length} fetched=${documents.length} inserted=${persisted.insertedDocuments} skipped=${persisted.skippedDocuments} chunks=${persisted.insertedChunks}`
      );
    } catch (error) {
      failedPublishers += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[premium-scraper] publisher=${profile.id} failed: ${message}`);
      await recordConnectorCheckpoint({ connectorId, success: false, error: message });
    } finally {
      await context?.close();
    }
  }
} finally {
  await browser.close();
}

if (failedPublishers > 0) {
  throw new Error(`${failedPublishers} premium publisher scrape(s) failed.`);
}

async function discoverArticles(profile: PremiumPublisherProfile) {
  const articles = new Map<string, { title: string; url: string; publishedAt: string }>();

  for (const feedUrl of profile.feedUrls) {
    const connector = createRssConnector({
      id: `discovery-${profile.id}`,
      name: profile.name,
      url: feedUrl,
      sourceClass: "newspaper",
      publisherOwner: profile.publisherOwner,
      retentionPolicy: "snippet",
      lookbackHours
    });
    for (const item of await connector.poll()) {
      if (!isAllowedPublisherUrl(item.url, profile)) continue;
      articles.set(item.canonicalUrl ?? item.url, {
        title: item.title,
        url: item.canonicalUrl ?? item.url,
        publishedAt: item.publishedAt
      });
    }
  }

  return [...articles.values()].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt)
  );
}

async function scrapeArticle(
  page: Page,
  article: { title: string; url: string; publishedAt: string },
  profile: PremiumPublisherProfile
): Promise<PersistableDocument> {
  if (!isAllowedPublisherUrl(article.url, profile)) {
    throw new Error("Article URL is outside the publisher allowlist.");
  }

  const response = await page.goto(article.url, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });
  if (response && [401, 403, 429].includes(response.status())) {
    throw new PublisherAccessError(
      `Publisher returned HTTP ${response.status()}; session or rate limit requires attention.`
    );
  }
  if (!response?.ok()) {
    throw new Error(`Article returned HTTP ${response?.status() ?? "unknown"}.`);
  }
  if (!isAllowedPublisherUrl(page.url(), profile)) {
    throw new PublisherAccessError(
      "Article redirected outside the publisher allowlist; session may be expired."
    );
  }
  if (
    profile.id === "ft" &&
    ((await response.headerValue("ft-access-decision"))?.toUpperCase() === "DENIED" ||
      ["ABSENT", "EXPIRED", "REVOKED", "CONCURRENCY", "CORRUPT"].includes(
        (await response.headerValue("ft-session-status"))?.toUpperCase() ?? ""
      ))
  ) {
    throw new PublisherAccessError("Financial Times session is absent, expired, or denied.");
  }

  const snapshot = await readArticleSnapshot(page, profile);
  const body = normalizeParagraphs(snapshot.paragraphs);
  if (body.length < 500 || snapshot.paragraphs.length < 3) {
    const reason = sessionFailureReason(snapshot.pageText);
    if (reason) throw new PublisherAccessError(reason);
    throw new Error("Article body was unavailable, too short, or insufficiently structured.");
  }

  const canonicalUrl =
    snapshot.canonicalUrl && isAllowedPublisherUrl(snapshot.canonicalUrl, profile)
      ? canonicalizeUrl(snapshot.canonicalUrl)
      : canonicalizeUrl(page.url());
  const title = snapshot.title || article.title;
  return {
    id: `premium-${profile.id}:${createHash("sha256")
      .update(canonicalUrl)
      .digest("hex")
      .slice(0, 24)}`,
    sourceId: `premium-${profile.id}`,
    sourceClass: "newspaper",
    title,
    publisher: profile.name,
    publisherId: profile.id,
    publisherOwner: profile.publisherOwner,
    url: canonicalUrl,
    canonicalUrl,
    publishedAt: article.publishedAt,
    tickers: [],
    summary: body.slice(0, 500),
    body,
    retrievalMethod: "credentialed",
    retentionPolicy: "full_text",
    contentHash: createHash("sha256").update(body).digest("hex"),
    nearDuplicateKey: createHash("sha256")
      .update(title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .digest("hex"),
    metadata: {
      sourceName: profile.name,
      termsNotes: "Authenticated retrieval under user-confirmed machine-use and LLM-processing rights.",
      accessMethod: "authenticated_playwright",
      browserProfile: profile.id
    }
  };
}

async function readArticleSnapshot(page: Page, profile: PremiumPublisherProfile) {
  const title = (await page.locator("h1").first().textContent().catch(() => null))?.trim() ?? "";
  const canonicalUrl =
    (await page.locator("link[rel='canonical']").first().getAttribute("href").catch(() => null)) ??
    "";
  let paragraphs: string[] = [];

  for (const selector of profile.bodySelectors) {
    const values = (await page.locator(selector).evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            !element.closest(
              "aside, figure, figcaption, nav, [role='navigation'], [data-testid*='ad'], [data-qa*='ad']"
            )
        )
        .map((element) => (element as HTMLElement).innerText)
    ))
      .map((value) => value.trim())
      .filter((value) => value.length >= 20);
    if (values.length >= 3 && normalizeParagraphs(values).length >= 500) {
      paragraphs = values;
      break;
    }
  }

  if (paragraphs.length === 0) {
    paragraphs = await articleBodyFromJsonLd(page);
  }

  return {
    title,
    canonicalUrl,
    paragraphs,
    pageText: (await page.locator("body").innerText().catch(() => "")).slice(0, 5_000)
  };
}

async function articleBodyFromJsonLd(page: Page) {
  const scripts = await page.locator("script[type='application/ld+json']").allTextContents();
  for (const script of scripts) {
    try {
      const value = JSON.parse(script) as unknown;
      for (const candidate of flattenJsonLd(value)) {
        if (
          candidate &&
          typeof candidate === "object" &&
          "articleBody" in candidate &&
          typeof candidate.articleBody === "string"
        ) {
          return candidate.articleBody.split(/\n{2,}/);
        }
      }
    } catch {
      // Ignore unrelated or malformed structured-data blocks.
    }
  }
  return [];
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...flattenJsonLd(record["@graph"])];
}

function sessionFailureReason(pageText: string) {
  const text = pageText.toLowerCase();
  if (
    /sign in to continue|subscribe to continue|already a subscriber|subscription required|log in to continue/.test(
      text
    )
  ) {
    return "Publisher session is missing or expired.";
  }
  if (/captcha|verify you are human|unusual traffic/.test(text)) {
    return "Publisher presented a human-verification challenge; no bypass was attempted.";
  }
  return null;
}

function normalizeParagraphs(paragraphs: string[]) {
  return paragraphs
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function canonicalizeUrl(value: string) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.startsWith("utm_") ||
      ["mod", "reflink", "st", "shareToken", "syn-25a6b1a6"].includes(key)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hash = "";
  return url.toString();
}

function newestDate(documents: PersistableDocument[]) {
  return documents.reduce<string | null>(
    (latest, document) =>
      !latest || document.publishedAt > latest ? document.publishedAt : latest,
    null
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PublisherAccessError extends Error {}
