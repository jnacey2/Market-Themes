create table if not exists narrative_review_events (
  id text primary key,
  observation_id text not null references narrative_observations(id) on delete cascade,
  previous_status text not null,
  new_status text not null,
  actor_type text not null,
  review_note text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists narrative_review_events_observation_idx
  on narrative_review_events (observation_id, created_at desc);

create index if not exists narrative_review_events_actor_created_idx
  on narrative_review_events (actor_type, created_at desc);
