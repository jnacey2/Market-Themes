-- Eligibility probes do not need observation bodies or metadata. Excluding
-- promotion seeds in the index lets the scheduler answer them from index keys.
create index if not exists narrative_observations_classification_coverage_idx
  on narrative_observations (document_id, model, prompt_version, narrative_definition_id)
  where coalesce(metadata->>'promotionSeed', 'false') <> 'true';
