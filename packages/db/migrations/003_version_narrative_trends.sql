alter table narrative_trends
  add column if not exists prompt_version text not null default 'narrative_classification_v1';

alter table narrative_trends
  drop constraint if exists narrative_trends_narrative_definition_id_date_trend_window_key;

create unique index if not exists narrative_trends_definition_date_window_prompt_idx
  on narrative_trends (narrative_definition_id, date, trend_window, prompt_version);

create index if not exists narrative_trends_prompt_date_rank_idx
  on narrative_trends (prompt_version, date desc, z_score desc);
