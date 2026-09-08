create or replace function prevent_narrative_review_event_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'narrative_review_events is append-only';
end;
$$;

drop trigger if exists narrative_review_events_no_update
  on narrative_review_events;

create trigger narrative_review_events_no_update
before update on narrative_review_events
for each row
execute function prevent_narrative_review_event_update();
