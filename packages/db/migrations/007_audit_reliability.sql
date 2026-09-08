-- Preserve review history and invalidate measurements whenever their inputs change.
create table narrative_review_events (
  id bigint generated always as identity primary key,
  observation_id text not null references narrative_observations(id) on delete cascade,
  status text not null,
  note text,
  evidence_snippet text not null,
  reviewed_at timestamptz not null default now()
);
create table narrative_recompute_queue (
  narrative_definition_id text primary key references narrative_definitions(id),
  requested_at timestamptz not null default now()
);
create function invalidate_narrative_measurement() returns trigger language plpgsql as $$
begin
  insert into narrative_recompute_queue (narrative_definition_id)
  values (new.narrative_definition_id)
  on conflict (narrative_definition_id) do update set requested_at = now();
  return new;
end $$;
create trigger narrative_observation_changed after insert or update on narrative_observations
  for each row execute function invalidate_narrative_measurement();

create table narrative_classification_jobs (
  document_id text not null references documents(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  text_hash text not null,
  status text not null default 'running',
  attempts integer not null default 1,
  lease_id text not null,
  lease_until timestamptz not null,
  retry_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (document_id, model, prompt_version)
);
create index narrative_classification_retry_idx on narrative_classification_jobs(status, retry_at);

alter table publication_feeds add column history_cursor integer not null default 0;
alter table publication_feeds add column history_complete boolean not null default false;
alter table publication_feeds add column history_started_at timestamptz;
update publication_feeds set publisher_owner = publisher_id where trim(publisher_owner) = '';
update documents set publisher_owner = coalesce(nullif(publisher_id, ''), publisher) where trim(coalesce(publisher_owner, '')) = '';

alter table briefs add column if not exists evidence jsonb not null default '[]';
alter table briefs add column if not exists measurement_date date;
alter table briefs add column if not exists prompt_version text;
