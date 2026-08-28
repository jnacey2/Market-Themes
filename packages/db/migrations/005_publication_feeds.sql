create table if not exists publication_feeds (
  id text primary key,
  name text not null,
  homepage_url text not null,
  feed_url text not null unique,
  platform text not null,
  source_class text not null default 'newspaper',
  publisher_id text not null,
  publisher_owner text not null,
  retention_policy text not null default 'full_text',
  enabled boolean not null default true,
  backfill_days integer not null default 30,
  max_posts_per_poll integer not null default 50,
  rate_limit_ms integer not null default 500,
  tags text[] not null default '{}',
  terms_notes text not null default '',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publication_feeds_enabled_platform_idx
  on publication_feeds (enabled, platform, name);
