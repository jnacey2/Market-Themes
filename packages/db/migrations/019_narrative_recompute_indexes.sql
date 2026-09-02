create index if not exists documents_published_at_id_idx
  on documents (published_at, id)
  where retention_policy <> 'metadata_only';

create index if not exists narrative_observations_prompt_definition_document_idx
  on narrative_observations (
    prompt_version,
    narrative_definition_id,
    document_id,
    observed_at desc
  );
