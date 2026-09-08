create index if not exists narrative_trends_homepage_date_idx
  on narrative_trends (
    prompt_version,
    trend_window,
    date desc,
    narrative_definition_id
  );

create index if not exists documents_published_at_idx
  on documents (published_at desc);
