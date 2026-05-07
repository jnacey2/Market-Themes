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
  metadata jsonb not null default '{}',
  content_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table documents
  add column if not exists metadata jsonb not null default '{}';

create table if not exists document_chunks (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists document_texts (
  document_id text primary key references documents(id) on delete cascade,
  content text not null,
  content_hash text not null,
  retention_policy text not null default 'full_text',
  text_source text not null default 'ingestion',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  parent_theme_id text references themes(id),
  theme_level text not null default 'extracted',
  sector text,
  metadata jsonb not null default '{}',
  status text not null default 'emerging',
  created_at timestamptz not null default now()
);

alter table themes
  add column if not exists parent_theme_id text references themes(id);

alter table themes
  add column if not exists theme_level text not null default 'extracted';

alter table themes
  add column if not exists sector text;

alter table themes
  add column if not exists metadata jsonb not null default '{}';

create table if not exists signals (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  theme_id text not null references themes(id),
  canonical_theme_id text references themes(id),
  canonical_subtheme_id text references themes(id),
  raw_theme_label text not null default '',
  canonical_theme_label text not null default '',
  stance text not null,
  risk_tone numeric not null,
  bullish_tone numeric not null,
  confidence numeric not null,
  evidence_snippet text not null,
  interpretation text not null default '',
  affected_entities text[] not null default '{}',
  section_label text,
  speaker text,
  prompt_version text not null default 'legacy',
  model text not null default 'legacy',
  metadata jsonb not null default '{}',
  score_contribution numeric not null,
  extracted_at timestamptz not null default now()
);

alter table signals
  add column if not exists canonical_theme_id text references themes(id);

alter table signals
  add column if not exists canonical_subtheme_id text references themes(id);

alter table signals
  add column if not exists raw_theme_label text not null default '';

alter table signals
  add column if not exists canonical_theme_label text not null default '';

alter table signals
  add column if not exists interpretation text not null default '';

alter table signals
  add column if not exists affected_entities text[] not null default '{}';

alter table signals
  add column if not exists section_label text;

alter table signals
  add column if not exists speaker text;

alter table signals
  add column if not exists prompt_version text not null default 'legacy';

alter table signals
  add column if not exists model text not null default 'legacy';

alter table signals
  add column if not exists metadata jsonb not null default '{}';

create unique index if not exists signals_document_prompt_theme_evidence_idx
  on signals (document_id, prompt_version, theme_id, evidence_snippet);

create table if not exists theme_mappings (
  id text primary key,
  extracted_theme_id text not null references themes(id),
  market_theme_id text not null references themes(id),
  sector_subtheme_id text references themes(id),
  sector text,
  confidence numeric not null,
  confidence_label text not null,
  rationale text not null default '',
  status text not null default 'auto_applied',
  model text not null,
  prompt_version text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (extracted_theme_id, prompt_version)
);

create table if not exists document_analysis_runs (
  id text primary key,
  document_id text not null references documents(id) on delete cascade,
  analysis_type text not null,
  model text not null,
  prompt_version text not null,
  status text not null,
  attempt_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, analysis_type, model, prompt_version)
);

create table if not exists document_analysis_sections (
  id text primary key,
  run_id text not null references document_analysis_runs(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  section_index integer not null,
  section_label text,
  status text not null,
  error_message text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (run_id, section_index)
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
