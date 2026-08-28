alter table narrative_observations
  add column if not exists review_status text not null default 'pending';

alter table narrative_observations
  add column if not exists reviewed_at timestamptz;

alter table narrative_observations
  add column if not exists review_note text;

create index if not exists narrative_observations_review_queue_idx
  on narrative_observations (prompt_version, review_status, observed_at desc)
  where matched;
