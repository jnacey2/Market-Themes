-- Lifecycle, peak, and raw-attention metrics for narrative trends.
--
-- density / z_score continue to measure reviewed (approved) evidence only.
-- attention_* columns measure every non-rejected classifier match, weighted by
-- match score, so early single-source signals are visible before review.

alter table narrative_trends
  add column if not exists baseline_windows integer not null default 0;

alter table narrative_trends
  add column if not exists attention_density numeric not null default 0;

alter table narrative_trends
  add column if not exists attention_matched_documents integer not null default 0;

alter table narrative_trends
  add column if not exists attention_z_score numeric not null default 0;

alter table narrative_trends
  add column if not exists peak_density numeric not null default 0;

alter table narrative_trends
  add column if not exists peak_date date;

alter table narrative_trends
  add column if not exists days_since_peak integer;

alter table narrative_trends
  add column if not exists percent_of_peak numeric not null default 0;

alter table narrative_trends
  add column if not exists lifecycle_state text not null default 'unmeasured';

create index if not exists narrative_trends_lifecycle_idx
  on narrative_trends (prompt_version, trend_window, date desc, lifecycle_state);

-- Daily brief becomes a stored, evidence-derived artifact instead of mock output.
alter table briefs
  add column if not exists sections jsonb not null default '[]';

alter table briefs
  add column if not exists narrative_definition_ids text[] not null default '{}';

-- Narrative-level alerts (state transitions, board entries/exits, unusual moves).
create table if not exists narrative_alerts (
  id text primary key,
  narrative_definition_id text not null references narrative_definitions(id),
  alert_date date not null,
  alert_type text not null,
  severity text not null,
  reason text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (narrative_definition_id, alert_date, alert_type)
);

create index if not exists narrative_alerts_date_idx
  on narrative_alerts (alert_date desc, severity);
