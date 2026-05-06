create extension if not exists vector;

create table if not exists sources (
  id text primary key,
  name text not null,
  source_class text not null,
  access_method text not null,
  credentials_key text,
  terms_notes text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id text primary key,
  source_id text not null references sources(id),
  source_class text not null,
  title text not null,
  publisher text not null,
  url text not null,
  published_at timestamptz not null,
  tickers text[] not null default '{}',
  summary text not null default '',
  retrieval_method text not null,
  content_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists document_chunks (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists entities (
  id text primary key,
  kind text not null,
  name text not null,
  ticker text,
  metadata jsonb not null default '{}'
);

create table if not exists themes (
  id text primary key,
  label text not null,
  description text not null default '',
  status text not null default 'emerging',
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  theme_id text not null references themes(id),
  stance text not null,
  risk_tone numeric not null,
  bullish_tone numeric not null,
  confidence numeric not null,
  evidence_snippet text not null,
  score_contribution numeric not null,
  extracted_at timestamptz not null default now()
);

create table if not exists theme_trends (
  id text primary key,
  theme_id text not null references themes(id),
  trend_window text not null,
  date date not null,
  intensity numeric not null,
  baseline_mean numeric not null,
  baseline_stddev numeric not null,
  z_score numeric not null,
  percentile_rank numeric not null,
  source_mix jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (theme_id, trend_window, date)
);

create table if not exists storyboards (
  id text primary key,
  theme_id text not null references themes(id),
  narrative text not null,
  why_unusual text not null,
  status text not null,
  confidence numeric not null,
  affected_entities text[] not null default '{}',
  follow_up_questions text[] not null default '{}',
  generated_at timestamptz not null default now()
);

create table if not exists briefs (
  id text primary key,
  brief_date date not null unique,
  headline text not null,
  summary text not null,
  storyboard_ids text[] not null default '{}',
  generated_at timestamptz not null default now()
);

create table if not exists alerts (
  id text primary key,
  theme_id text not null references themes(id),
  storyboard_id text references storyboards(id),
  alert_type text not null,
  severity text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
