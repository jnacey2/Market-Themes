-- Preserve stable run IDs and section references across retry attempts.
alter table document_analysis_runs add column attempt_token text;
