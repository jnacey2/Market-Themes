-- Funnel and evidence probes ask "does this document have a matched (and not rejected /
-- approved) observation?" per document. Without a document-leading partial index the
-- planner BitmapAnds the document index with the prompt-version review-queue index,
-- reading hundreds of rows per document. Matched rows are a small minority, so this
-- index is tiny and turns each probe into a single lookup.

create index if not exists narrative_observations_matched_document_idx
  on narrative_observations (document_id, review_status)
  where matched;
