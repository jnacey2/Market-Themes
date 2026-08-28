import { createHash } from "node:crypto";
import { createDatabaseClient } from "./persistence";
import type {
  PublicationFeed,
  PublicationFeedInput,
  PublicationFeedPlatform,
  SourceClass
} from "./types";

type PublicationFeedRow = {
  id: string;
  name: string;
  homepage_url: string;
  feed_url: string;
  platform: PublicationFeedPlatform;
  source_class: SourceClass;
  publisher_id: string;
  publisher_owner: string;
  retention_policy: "full_text" | "snippet";
  enabled: boolean;
  backfill_days: number;
  max_posts_per_poll: number;
  rate_limit_ms: number;
  tags: string[];
  terms_notes: string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_published_at: string | null;
  last_error: string | null;
};

export async function listPublicationFeeds(
  options: { enabledOnly?: boolean } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<PublicationFeed[]> {
  if (!databaseUrl) return [];
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<PublicationFeedRow>(
      `select id, name, homepage_url, feed_url, platform, source_class,
              publisher_id, publisher_owner, retention_policy, enabled,
              backfill_days, max_posts_per_poll, rate_limit_ms, tags, terms_notes,
              last_attempt_at::text, last_success_at::text,
              last_published_at::text, last_error
       from publication_feeds
       where ($1::boolean = false or enabled)
       order by platform, name`,
      [options.enabledOnly ?? false]
    );
    return result.rows.map(mapPublicationFeed);
  } finally {
    await client.end();
  }
}

export async function findPublicationFeedByFeedUrl(
  feedUrl: string,
  databaseUrl = process.env.DATABASE_URL
): Promise<PublicationFeed | null> {
  if (!databaseUrl) return null;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<PublicationFeedRow>(
      `select id, name, homepage_url, feed_url, platform, source_class,
              publisher_id, publisher_owner, retention_policy, enabled,
              backfill_days, max_posts_per_poll, rate_limit_ms, tags, terms_notes,
              last_attempt_at::text, last_success_at::text,
              last_published_at::text, last_error
       from publication_feeds
       where feed_url = $1
       limit 1`,
      [feedUrl]
    );
    return result.rows[0] ? mapPublicationFeed(result.rows[0]) : null;
  } finally {
    await client.end();
  }
}

export async function createPublicationFeed(
  input: PublicationFeedInput,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  const id = `publication:${createHash("sha256")
    .update(input.feedUrl)
    .digest("hex")
    .slice(0, 24)}`;
  const publisherId = slug(input.name);
  await client.connect();
  try {
    const result = await client.query<PublicationFeedRow>(
      `insert into publication_feeds (
         id, name, homepage_url, feed_url, platform, source_class,
         publisher_id, publisher_owner, retention_policy, backfill_days,
         max_posts_per_poll, rate_limit_ms, tags, terms_notes
       ) values (
         $1, $2, $3, $4, $5, 'newspaper', $6, $7, $8, $9, $10, $11, $12, $13
       )
       on conflict (feed_url) do update set
         name = excluded.name,
         homepage_url = excluded.homepage_url,
         platform = excluded.platform,
         publisher_id = excluded.publisher_id,
         publisher_owner = excluded.publisher_owner,
         retention_policy = excluded.retention_policy,
         backfill_days = excluded.backfill_days,
         max_posts_per_poll = excluded.max_posts_per_poll,
         rate_limit_ms = excluded.rate_limit_ms,
         tags = excluded.tags,
         terms_notes = excluded.terms_notes,
         enabled = true,
         updated_at = now()
       returning id, name, homepage_url, feed_url, platform, source_class,
                 publisher_id, publisher_owner, retention_policy, enabled,
                 backfill_days, max_posts_per_poll, rate_limit_ms, tags, terms_notes,
                 last_attempt_at::text, last_success_at::text,
                 last_published_at::text, last_error`,
      [
        id,
        input.name.trim(),
        input.homepageUrl,
        input.feedUrl,
        input.platform,
        publisherId,
        slug(input.publisherOwner ?? input.name),
        input.retentionPolicy ?? "full_text",
        input.backfillDays ?? 30,
        input.maxPostsPerPoll ?? 50,
        input.rateLimitMs ?? 500,
        input.tags ?? [],
        input.termsNotes?.trim() ?? "Public feed/API content; no authenticated access."
      ]
    );
    return mapPublicationFeed(result.rows[0]);
  } finally {
    await client.end();
  }
}

export async function setPublicationFeedEnabled(
  id: string,
  enabled: boolean,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ id: string; enabled: boolean }>(
      `update publication_feeds
       set enabled = $2, updated_at = now()
       where id = $1
       returning id, enabled`,
      [id, enabled]
    );
    if (!result.rows[0]) throw new Error("Publication feed not found.");
    return result.rows[0];
  } finally {
    await client.end();
  }
}

export async function listSubstackCachedPosts(
  sourceId: string,
  databaseUrl = process.env.DATABASE_URL
): Promise<Map<string, { slug: string; preview: boolean }>> {
  const cached = new Map<string, { slug: string; preview: boolean }>();
  if (!databaseUrl) return cached;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ slug: string | null; content: string | null }>(
      `select metadata->>'substackSlug' as slug, metadata->>'content' as content
       from documents
       where source_id = $1
         and metadata->>'platform' = 'substack'`,
      [sourceId]
    );
    for (const row of result.rows) {
      if (!row.slug) continue;
      cached.set(row.slug, { slug: row.slug, preview: row.content === "preview" });
    }
    return cached;
  } finally {
    await client.end();
  }
}

export async function recordPublicationFeedPoll(
  id: string,
  result: {
    success: boolean;
    lastPublishedAt?: string | null;
    error?: string;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query(
      `update publication_feeds
       set last_attempt_at = now(),
           last_success_at = case when $2 then now() else last_success_at end,
           last_published_at = case
             when $2 and $3::timestamptz is not null then
               greatest(coalesce(last_published_at, $3::timestamptz), $3::timestamptz)
             else last_published_at
           end,
           last_error = $4,
           updated_at = now()
       where id = $1`,
      [id, result.success, result.lastPublishedAt ?? null, result.error ?? null]
    );
  } finally {
    await client.end();
  }
}

function mapPublicationFeed(row: PublicationFeedRow): PublicationFeed {
  return {
    id: row.id,
    name: row.name,
    homepageUrl: row.homepage_url,
    feedUrl: row.feed_url,
    platform: row.platform,
    sourceClass: row.source_class,
    publisherId: row.publisher_id,
    publisherOwner: row.publisher_owner,
    retentionPolicy: row.retention_policy,
    enabled: row.enabled,
    backfillDays: row.backfill_days,
    maxPostsPerPoll: row.max_posts_per_poll,
    rateLimitMs: row.rate_limit_ms,
    tags: row.tags,
    termsNotes: row.terms_notes,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastPublishedAt: row.last_published_at,
    lastError: row.last_error
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
