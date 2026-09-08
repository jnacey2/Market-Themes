create index if not exists theme_trends_date_idx
  on theme_trends (date desc);

create index if not exists theme_trends_date_window_idx
  on theme_trends (date, trend_window);
