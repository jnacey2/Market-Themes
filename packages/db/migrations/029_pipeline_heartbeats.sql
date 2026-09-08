alter table pipeline_runs add column heartbeat_at timestamptz not null default now();
