create index if not exists narrative_observations_homepage_idx
  on narrative_observations (
    prompt_version,
    narrative_definition_id,
    document_id,
    observed_at desc,
    id
  )
  include (matched, review_status);
