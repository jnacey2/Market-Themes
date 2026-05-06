# Market Themes

Storyboard-first narrative intelligence for market research.

The app ingests market-relevant text from filings, press releases, transcripts,
credentialed news, controlled scraping, and manual uploads. Claude-powered
analysis turns those documents into emergent themes, z-score based trend
signals, evidence cards, daily briefs, and research copilot answers.

## What Exists Now

- Render-friendly npm workspace monorepo.
- Next.js dashboard with storyboard cards and detail pages.
- Mock data shaped like the production objects.
- Postgres schema for sources, documents, chunks, themes, signals, trends,
  storyboards, briefs, and alerts.
- Analysis helpers for baseline-aware z-score scoring.
- Connector interfaces for source ingestion.
- Worker and cron job entrypoints.
- `render.yaml` blueprint for Render deployment.

## Project Structure

```text
apps/web             Next.js app and API surface
packages/db          Types, mock data, and SQL schema
packages/analysis    Claude prompts and scoring helpers
packages/ingest      Source connector interfaces
workers              Worker and cron job entrypoints
render.yaml          Render blueprint
```

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

## Useful Commands

```bash
npm run build
npm run typecheck
npm run db:schema
npm run poll:sources --workspace @market-themes/workers
npm run brief:daily --workspace @market-themes/workers
npm run trends:recompute --workspace @market-themes/workers
```

## Render Deployment

1. Create a new Render Blueprint from this repository.
2. Render will provision:
   - `themes-web`
   - `themes-worker`
   - `themes-postgres`
   - `poll-sources`
   - `generate-daily-brief`
   - `recompute-theme-trends`
3. Set required secrets:
   - `ANTHROPIC_API_KEY`
   - `APP_BASE_URL`
   - source credentials in `SOURCE_CONFIG_JSON` or separate env vars
4. Keep `SCRAPING_ENABLED=false` until each source has explicit configuration.
5. Run the SQL from `npm run db:schema` against the Render Postgres database.

## Next Build Steps

1. Replace mock storyboard reads with Postgres queries.
2. Add SEC and company IR connectors for S&P 500 plus Nasdaq-100.
3. Add a manual document upload/paste flow.
4. Wire Claude extraction into the worker.
5. Store extracted signals and recompute trend baselines.
6. Generate storyboards and daily briefs from real evidence.
