create table if not exists research_queue_snapshots (
  id text primary key,
  generated_at timestamptz not null default now(),
  payload jsonb not null
);
