-- A stable run retains its history and section references while each retry has
-- a new ownership token. Old attempts cannot complete or fail a newer attempt.
alter table document_analysis_runs add column attempt_token text;
