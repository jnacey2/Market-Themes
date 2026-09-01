alter table narrative_candidates
  add column if not exists kind text not null default 'structural';

alter table narrative_candidates
  add column if not exists event_label text;

alter table narrative_candidates
  add column if not exists promotion_validation jsonb not null default '{}';

alter table narrative_definitions
  add column if not exists kind text not null default 'structural';

alter table narrative_definitions
  add column if not exists event_label text;

alter table narrative_definitions
  add column if not exists metadata jsonb not null default '{}';

create index if not exists narrative_candidates_validation_status_idx
  on narrative_candidates ((promotion_validation->>'status'), updated_at desc)
  where status = 'pending';

create table if not exists narrative_definition_events (
  id text primary key,
  narrative_definition_id text not null references narrative_definitions(id),
  action text not null,
  actor_type text not null,
  reason text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists narrative_definition_events_definition_idx
  on narrative_definition_events (narrative_definition_id, created_at desc);

create or replace function prevent_narrative_definition_event_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'narrative_definition_events is append-only';
end;
$$;

drop trigger if exists narrative_definition_events_no_update
  on narrative_definition_events;

create trigger narrative_definition_events_no_update
before update on narrative_definition_events
for each row
execute function prevent_narrative_definition_event_update();

update narrative_definitions
set kind = 'event',
    event_label = case slug
      when 'iran-us-conflict-oil-spike' then 'Renewed US-Iran strikes and Hormuz oil risk'
      when 'amazon-advertising-antitrust-risk' then 'FTC and states sue Amazon over ad auctions'
      when 'geopolitical-oil-shock-inflation-fed-hike' then 'US-Iran oil shock revives Fed hike expectations'
      when 'us-venezuela-oil-partnership' then 'US-Venezuela joint oil development agreement'
      else event_label
    end,
    updated_at = now()
where slug in (
  'iran-us-conflict-oil-spike',
  'amazon-advertising-antitrust-risk',
  'geopolitical-oil-shock-inflation-fed-hike',
  'us-venezuela-oil-partnership'
);

with retracted as (
  update narrative_definitions
  set status = 'inactive',
      kind = 'event',
      event_label = 'Shein Hong Kong IPO',
      metadata = metadata || jsonb_build_object(
        'retraction', jsonb_build_object(
          'actorType', 'system',
          'reason', 'Single-company IPO evidence violated the candidate exclusion contract.',
          'at', now()
        )
      ),
      updated_at = now()
  where slug = 'fast-fashion-ipo-valuation-collapse'
    and status = 'active'
  returning id
)
insert into narrative_definition_events (
  id, narrative_definition_id, action, actor_type, reason, metadata
)
select
  'narrative:definition:event:fast-fashion-single-company-retraction',
  id,
  'retracted',
  'system',
  'Single-company IPO evidence violated the candidate exclusion contract.',
  '{"policyVersion":"candidate_promotion_quality_v1"}'::jsonb
from retracted
on conflict (id) do nothing;
