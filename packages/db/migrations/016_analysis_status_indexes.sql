create index if not exists signals_extracted_at_idx
  on signals (extracted_at desc, id);

create index if not exists document_analysis_runs_updated_at_idx
  on document_analysis_runs (updated_at desc, id);
