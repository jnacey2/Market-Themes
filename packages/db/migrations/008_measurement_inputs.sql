-- Changes to the eligible corpus or a definition also invalidate derived measurements.
create function invalidate_narrative_corpus() returns trigger language plpgsql as $$
begin
  insert into narrative_recompute_queue (narrative_definition_id)
  select id from narrative_definitions where status = 'active'
  on conflict (narrative_definition_id) do update set requested_at = now();
  return null;
end $$;
create trigger narrative_corpus_changed after insert or update or delete on document_texts
  for each statement execute function invalidate_narrative_corpus();
create trigger narrative_definition_changed after insert or update or delete on narrative_definitions
  for each statement execute function invalidate_narrative_corpus();
create trigger narrative_document_changed after update or delete on documents
  for each statement execute function invalidate_narrative_corpus();
create trigger narrative_observation_deleted after delete on narrative_observations
  for each statement execute function invalidate_narrative_corpus();
alter table pipeline_runs add column heartbeat_at timestamptz not null default now();

-- Legacy connector hashes may differ from the canonical retained-text hash.
create index if not exists document_texts_content_hash_idx on document_texts(content_hash);
