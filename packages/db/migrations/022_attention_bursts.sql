-- Corpus-level attention bursts: terms (title n-grams, extracted entities, canonical
-- theme labels) whose unique-story count this window is unusual versus their own history
-- or that have no history at all. Feeds the discovery watchlist and discovery prompt hints.

create table if not exists attention_bursts (
  id text primary key,
  burst_date date not null,
  term text not null,
  kind text not null,
  current_stories integer not null,
  current_owners integer not null,
  baseline_mean numeric not null default 0,
  baseline_scale numeric not null default 1,
  baseline_windows integer not null default 0,
  z_score numeric not null default 0,
  novel boolean not null default false,
  score numeric not null default 0,
  sample_document_ids text[] not null default '{}',
  sample_titles text[] not null default '{}',
  covering_narrative_definition_ids text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (burst_date, term)
);

create index if not exists attention_bursts_date_score_idx
  on attention_bursts (burst_date desc, score desc);
