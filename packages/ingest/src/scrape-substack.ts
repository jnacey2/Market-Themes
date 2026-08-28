import {
  createPublicationFeed,
  listSubstackCachedPosts,
  persistDocuments,
  recordPublicationFeedPoll
} from "@market-themes/db";
import { fetchSubstackPosts, resolveSubstackSession, SubstackAccessError } from "./substack";
import {
  feedFromSubstackUrl,
  loadSubstackPublications,
  type SubstackPublication
} from "./substack-publications";

export type SubstackScrapeArgs = {
  urls: string[];
  all: boolean;
  yaml?: string;
  name?: string;
  limit: number;
  persist: boolean;
};

export type SubstackScrapeSummary = {
  name: string;
  baseUrl: string;
  registered: boolean;
  persisted: boolean;
  fetched: number;
  full: number;
  preview: number;
  error?: string;
  errorKind?: "session" | "bot_block" | "other";
  posts: Array<{
    slug: string;
    title: string;
    audience: string;
    content: string;
    wordCount: number | null;
    bodyChars: number;
  }>;
};

export function parseSubstackScrapeArgs(argv: string[]): SubstackScrapeArgs {
  const args: SubstackScrapeArgs = {
    urls: [],
    all: false,
    limit: 12,
    persist: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") args.all = true;
    else if (arg === "--no-persist") args.persist = false;
    else if (
      arg === "--url" ||
      arg === "--name" ||
      arg === "--yaml" ||
      arg === "--config" ||
      arg === "--limit"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === "--url") args.urls.push(value);
      else if (arg === "--name") args.name = value;
      else if (arg === "--yaml" || arg === "--config") args.yaml = value;
      else args.limit = Number.parseInt(value, 10);
    } else if (/^https:\/\//i.test(arg)) {
      args.urls.push(arg);
    }
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return args;
}

export async function scrapeSubstackPublications(
  args: SubstackScrapeArgs,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    now?: () => number;
    skipNetworkValidation?: boolean;
    requestDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<SubstackScrapeSummary[]> {
  const env = options.env ?? process.env;
  const session = resolveSubstackSession(env);
  const publications = resolveTargets(args, env);
  if (publications.length === 0) {
    throw new Error(
      "Pass --url https://example.substack.com, --config config/substacks.yaml, or --all."
    );
  }
  if (!session) {
    console.warn(
      "[substack:scrape] No subscriber session loaded. Paid posts will be previews. Capture one with npm run substack:capture-session or place it in .auth/."
    );
  } else {
    console.log(`[substack:scrape] Subscriber session loaded for ${publications.length} publication(s).`);
  }

  const summaries: SubstackScrapeSummary[] = [];
  for (const publication of publications) {
    summaries.push(
      await scrapeOne(publication, args, session, env, options).catch((error) =>
        failedSummary(publication, error)
      )
    );
  }
  return summaries;
}

async function scrapeOne(
  publication: SubstackPublication,
  args: SubstackScrapeArgs,
  session: ReturnType<typeof resolveSubstackSession>,
  env: NodeJS.ProcessEnv,
  options: {
    fetchImpl?: typeof fetch;
    now?: () => number;
    skipNetworkValidation?: boolean;
    requestDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
  }
): Promise<SubstackScrapeSummary> {
  const feed = feedFromSubstackUrl(publication.baseUrl, {
    name: publication.name,
    maxPostsPerPoll: args.limit
  });
  let registered = false;
  const canPersist = args.persist && Boolean(env.DATABASE_URL);
  if (canPersist) {
    const created = await createPublicationFeed(
      {
        name: feed.name,
        homepageUrl: feed.homepageUrl,
        feedUrl: feed.feedUrl,
        platform: feed.platform,
        publisherOwner: feed.publisherOwner,
        retentionPolicy: feed.retentionPolicy,
        backfillDays: feed.backfillDays,
        maxPostsPerPoll: feed.maxPostsPerPoll,
        rateLimitMs: feed.rateLimitMs,
        tags: feed.tags,
        termsNotes: feed.termsNotes
      },
      env.DATABASE_URL
    );
    feed.id = created.id;
    registered = true;
  }

  const documents = await fetchSubstackPosts(feed, {
    session,
    fetchImpl: options.fetchImpl,
    now: options.now,
    skipNetworkValidation: options.skipNetworkValidation,
    requestDelayMs: options.requestDelayMs,
    sleep: options.sleep,
    cachedPosts: canPersist ? await listSubstackCachedPosts(feed.id, env.DATABASE_URL) : undefined,
    upgradePreviews: Boolean(session)
  });

  let persisted = false;
  if (canPersist) {
    if (documents.length > 0) {
      await persistDocuments(documents);
    }
    await recordPublicationFeedPoll(
      feed.id,
      {
        success: true,
        lastPublishedAt: documents.reduce<string | null>(
          (latest, document) =>
            !latest || document.publishedAt > latest ? document.publishedAt : latest,
          null
        )
      },
      env.DATABASE_URL
    );
    persisted = documents.length > 0;
  }

  const posts = documents.map((document) => ({
    slug: String(document.metadata?.substackSlug ?? ""),
    title: document.title,
    audience: String(document.metadata?.audience ?? "everyone"),
    content: String(document.metadata?.content ?? ""),
    wordCount: typeof document.metadata?.wordCount === "number" ? document.metadata.wordCount : null,
    bodyChars: document.body.length
  }));
  const full = posts.filter((post) => post.content === "full").length;
  const preview = posts.filter((post) => post.content === "preview").length;
  const summary: SubstackScrapeSummary = {
    name: feed.name,
    baseUrl: publication.baseUrl,
    registered,
    persisted,
    fetched: documents.length,
    full,
    preview,
    posts
  };
  console.log(
    `[substack:scrape] ${feed.name} ${publication.baseUrl} session=${session ? "yes" : "no"} fetched=${documents.length} full=${full} preview=${preview} registered=${registered} persisted=${persisted}`
  );
  return summary;
}

function failedSummary(publication: SubstackPublication, error: unknown): SubstackScrapeSummary {
  const message = error instanceof Error ? error.message : String(error);
  const errorKind =
    error instanceof SubstackAccessError
      ? error.kind
      : /session is missing or expired|does not contain a Substack session/i.test(message)
        ? "session"
        : /Cloudflare|bot-check/i.test(message)
          ? "bot_block"
          : "other";
  console.error(`[substack:scrape] ${publication.name} ${publication.baseUrl} failed kind=${errorKind}: ${message}`);
  return {
    name: publication.name,
    baseUrl: publication.baseUrl,
    registered: false,
    persisted: false,
    fetched: 0,
    full: 0,
    preview: 0,
    error: message,
    errorKind,
    posts: []
  };
}

function resolveTargets(args: SubstackScrapeArgs, env: NodeJS.ProcessEnv): SubstackPublication[] {
  if (args.urls.length > 0) {
    return args.urls.map((url) => {
      const feed = feedFromSubstackUrl(url, { name: args.name });
      return { name: feed.name, baseUrl: feed.homepageUrl.replace(/\/+$/, "") };
    });
  }
  const sourceEnv = args.yaml ? { ...env, SUBSTACK_PUBLICATIONS_YAML: args.yaml } : env;
  if (args.all || args.yaml) {
    return loadSubstackPublications(sourceEnv);
  }
  return [];
}
