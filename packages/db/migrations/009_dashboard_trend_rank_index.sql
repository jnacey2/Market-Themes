create index if not exists theme_trends_dashboard_rank_idx
  on theme_trends (
    date desc,
    trend_window,
    z_score desc,
    intensity desc
  )
  where coalesce(source_mix->>'trendLevel', 'market') = 'market';
