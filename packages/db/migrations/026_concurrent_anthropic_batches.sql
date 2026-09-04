-- Allow more than one in-flight provider batch per workload. A single slow Anthropic
-- batch (2-3 hours has been observed) otherwise stalls every following hourly submit.
-- The runtime bounds concurrency with ANTHROPIC_BATCH_MAX_ACTIVE; documents already in
-- an active batch are excluded from selection regardless.

drop index if exists anthropic_message_batches_active_workload_idx;

create index if not exists anthropic_message_batches_active_workload_idx
  on anthropic_message_batches (workload, created_at)
  where status in (
    'submitting',
    'submission_unknown',
    'in_progress',
    'canceling',
    'processing_results'
  );
