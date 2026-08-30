create table if not exists narrative_candidates (
  id text primary key,
  cluster_key text not null,
  name text not null,
  proposition text not null,
  category text not null default 'Cross-sector',
  inclusion_guidance text not null default '',
  exclusion_guidance text not null default '',
  status text not null default 'pending',
  merged_into_candidate_id text references narrative_candidates(id),
  promoted_definition_id text references narrative_definitions(id),
  model text not null,
  prompt_version text not null,
  review_note text,
  reviewed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cluster_key, prompt_version)
);

create index if not exists narrative_candidates_status_updated_idx
  on narrative_candidates (status, updated_at desc);

create table if not exists narrative_candidate_evidence (
  id text primary key,
  candidate_id text not null references narrative_candidates(id) on delete cascade,
  document_id text not null references documents(id) on delete cascade,
  evidence_snippet text not null,
  interpretation text not null default '',
  stance text not null default 'neutral',
  risk_tone numeric not null default 0,
  bullish_tone numeric not null default 0,
  affected_entities text[] not null default '{}',
  match_score numeric not null default 0,
  model text not null,
  prompt_version text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (candidate_id, document_id)
);

create index if not exists narrative_candidate_evidence_candidate_idx
  on narrative_candidate_evidence (candidate_id, created_at desc);

create index if not exists narrative_candidate_evidence_document_idx
  on narrative_candidate_evidence (document_id);

create index if not exists narrative_observations_document_prompt_idx
  on narrative_observations (
    document_id,
    model,
    prompt_version,
    narrative_definition_id
  );

create index if not exists documents_source_class_published_idx
  on documents (source_class, published_at desc, created_at desc);
