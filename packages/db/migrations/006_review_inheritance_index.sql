create index if not exists narrative_observations_prior_review_idx
  on narrative_observations (
    narrative_definition_id,
    document_id,
    evidence_snippet,
    reviewed_at desc
  )
  where review_status in ('approved', 'rejected');
