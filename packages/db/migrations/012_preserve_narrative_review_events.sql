drop trigger if exists narrative_review_events_no_update
  on narrative_review_events;

alter table narrative_review_events
  add column if not exists observation_key text;

update narrative_review_events
set observation_key = observation_id
where observation_key is null;

alter table narrative_review_events
  alter column observation_key set not null;

alter table narrative_review_events
  alter column observation_id drop not null;

alter table narrative_review_events
  drop constraint if exists narrative_review_events_observation_id_fkey;

alter table narrative_review_events
  add constraint narrative_review_events_observation_id_fkey
  foreign key (observation_id)
  references narrative_observations(id)
  on delete set null;

create index if not exists narrative_review_events_observation_key_idx
  on narrative_review_events (observation_key, created_at desc);

create or replace function prevent_narrative_review_event_update()
returns trigger
language plpgsql
as $$
begin
  if old.observation_id is not null
     and new.observation_id is null
     and old.observation_key = new.observation_key
     and old.previous_status = new.previous_status
     and old.new_status = new.new_status
     and old.actor_type = new.actor_type
     and old.review_note is not distinct from new.review_note
     and old.metadata = new.metadata
     and old.created_at = new.created_at then
    return new;
  end if;

  raise exception 'narrative_review_events is append-only';
end;
$$;

create trigger narrative_review_events_no_update
before update on narrative_review_events
for each row
execute function prevent_narrative_review_event_update();
