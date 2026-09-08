-- Follow main's migrations without replacing its append-only review history.
alter table publication_feeds add column history_cursor integer not null default 0;
alter table publication_feeds add column history_complete boolean not null default false;
alter table publication_feeds add column history_started_at timestamptz;
update publication_feeds set publisher_owner = publisher_id where trim(publisher_owner) = '';
update documents set publisher_owner = coalesce(nullif(publisher_id, ''), publisher)
  where trim(coalesce(publisher_owner, '')) = '';
create index if not exists document_texts_content_hash_idx on document_texts(content_hash);
