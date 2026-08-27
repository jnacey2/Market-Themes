alter table documents
  add column if not exists canonical_url text;

alter table documents
  add column if not exists publisher_id text;

alter table documents
  add column if not exists publisher_owner text;

alter table documents
  add column if not exists retention_policy text not null default 'full_text';

alter table documents
  add column if not exists near_duplicate_key text;

create index if not exists documents_canonical_url_idx
  on documents (canonical_url);

create index if not exists documents_near_duplicate_key_idx
  on documents (near_duplicate_key, published_at);

create table if not exists connector_checkpoints (
  connector_id text primary key,
  cursor_value text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_document_at timestamptz,
  last_error text,
  documents_fetched integer not null default 0,
  documents_inserted integer not null default 0,
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists pipeline_runs (
  id text primary key,
  stage text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  processed_count integer not null default 0,
  failed_count integer not null default 0,
  estimated_cost_usd numeric,
  error_message text,
  metadata jsonb not null default '{}'
);

create index if not exists pipeline_runs_stage_started_idx
  on pipeline_runs (stage, started_at desc);

create table if not exists narrative_definitions (
  id text primary key,
  slug text not null,
  version integer not null default 1,
  name text not null,
  proposition text not null,
  category text not null,
  inclusion_guidance text not null default '',
  exclusion_guidance text not null default '',
  positive_examples text[] not null default '{}',
  negative_examples text[] not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug, version)
);

create table if not exists narrative_observations (
  id text primary key,
  narrative_definition_id text not null references narrative_definitions(id),
  document_id text not null references documents(id) on delete cascade,
  matched boolean not null,
  match_score numeric not null,
  stance text not null,
  risk_tone numeric not null default 0,
  bullish_tone numeric not null default 0,
  evidence_snippet text not null default '',
  interpretation text not null default '',
  affected_entities text[] not null default '{}',
  model text not null,
  prompt_version text not null,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}',
  unique (narrative_definition_id, document_id, model, prompt_version)
);

create index if not exists narrative_observations_definition_idx
  on narrative_observations (narrative_definition_id, observed_at desc);

create table if not exists narrative_trends (
  id text primary key,
  narrative_definition_id text not null references narrative_definitions(id),
  date date not null,
  trend_window text not null,
  density numeric not null,
  baseline_mean numeric not null,
  baseline_stddev numeric not null,
  z_score numeric not null,
  percentile_rank numeric not null,
  change_value numeric not null default 0,
  acceleration numeric not null default 0,
  risk_tone numeric not null default 0,
  bullish_tone numeric not null default 0,
  eligible_documents integer not null default 0,
  matched_documents integer not null default 0,
  publisher_breadth integer not null default 0,
  publisher_owner_breadth integer not null default 0,
  source_class_breadth integer not null default 0,
  entity_breadth integer not null default 0,
  low_history boolean not null default true,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (narrative_definition_id, date, trend_window)
);

create index if not exists narrative_trends_date_rank_idx
  on narrative_trends (date desc, z_score desc);

alter table storyboards
  add column if not exists narrative_definition_id text references narrative_definitions(id);

alter table storyboards
  add column if not exists synthesis_label text not null default 'Model synthesis';
