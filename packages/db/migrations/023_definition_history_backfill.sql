-- Per-definition classification history depth.
--
-- Every active definition requires an observation for every document inside the
-- classification lookback, so promoting a candidate re-queues the whole lookback
-- corpus. Curated definitions want a year of history for trend baselines; a freshly
-- promoted candidate is emerging by construction and needs only enough history for
-- the 7-day window and its baseline. NULL means "use NARRATIVE_CLASSIFICATION_LOOKBACK_DAYS".

alter table narrative_definitions
  add column if not exists history_backfill_days integer;

comment on column narrative_definitions.history_backfill_days is
  'Days of document history classified for this definition; NULL uses the global classification lookback.';

update narrative_definitions
   set history_backfill_days = 60
 where history_backfill_days is null
   and metadata->>'origin' = 'candidate_promotion';
