-- Several backlog and eligibility queries filtered on length(btrim(dt.content)) > 0,
-- which detoasts every stored document body (including full transcripts) on each
-- call. Persist the trimmed length once so those filters read a small column and can
-- use an index.

alter table document_texts
  add column if not exists content_length integer
  generated always as (length(btrim(content))) stored;

create index if not exists document_texts_content_length_idx
  on document_texts (content_length)
  where content_length > 0;

-- The ingestion funnel windows documents by created_at; every other index leads with
-- published_at.
create index if not exists documents_created_at_idx
  on documents (created_at desc);
