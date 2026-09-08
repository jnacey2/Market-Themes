create table if not exists anthropic_message_batches (
  id text primary key,
  provider_batch_id text unique,
  workload text not null,
  model text not null,
  prompt_version text not null,
  status text not null,
  request_count integer not null,
  processing_count integer not null default 0,
  succeeded_count integer not null default 0,
  errored_count integer not null default 0,
  canceled_count integer not null default 0,
  expired_count integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}',
  submitted_at timestamptz,
  provider_expires_at timestamptz,
  provider_ended_at timestamptz,
  results_url text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists anthropic_message_batches_active_workload_idx
  on anthropic_message_batches (workload)
  where status in (
    'submitting',
    'submission_unknown',
    'in_progress',
    'canceling',
    'processing_results'
  );

create index if not exists anthropic_message_batches_workload_created_idx
  on anthropic_message_batches (workload, created_at desc);

create table if not exists anthropic_message_batch_items (
  id text primary key,
  batch_id text not null
    references anthropic_message_batches(id) on delete cascade,
  custom_id text not null,
  document_id text not null,
  analysis_run_id text,
  status text not null default 'submitted',
  error_type text,
  error_message text,
  usage jsonb not null default '{}',
  metadata jsonb not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, custom_id)
);

create index if not exists anthropic_message_batch_items_document_idx
  on anthropic_message_batch_items (document_id, created_at desc);

create index if not exists anthropic_message_batch_items_batch_status_idx
  on anthropic_message_batch_items (batch_id, status);
