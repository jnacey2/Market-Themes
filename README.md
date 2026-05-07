# Market Themes

Storyboard-first narrative intelligence for market research.

Market Themes is a Render-deployable web app for tracking the market narratives
that are getting stronger, weaker, broader, or more urgent across company
filings, earnings calls, press releases, credentialed news, controlled scraping,
and manual uploads.

The goal is not to generate trade recommendations. The goal is to help a
research user decide what themes, risks, and opportunities deserve deeper work.

## Product Goal

The app should answer questions like:

- Which market themes are becoming unusually prominent?
- Which risks are broadening across companies, sectors, or source types?
- Where is bullishness increasing?
- Is a topic genuinely accelerating, or is it just always present in markets?
- What evidence supports the signal?
- What should I read or investigate next?

The first product surface is the **theme storyboard**. A storyboard explains the
narrative, trend, statistical unusualness, evidence, affected entities, source
mix, and follow-up research questions for a market theme.

## Current Scope

- **Primary user:** personal investment/research workflow.
- **Primary job:** research prioritization.
- **Initial universe:** US equities plus macro themes.
- **Company coverage target:** S&P 500 plus Nasdaq-100.
- **Signal horizons:** days, weeks, and months.
- **Core output:** ranked narrative storyboards with evidence cards.
- **Supporting outputs:** daily brief and research copilot.
- **Out of scope:** automated buy/sell recommendations, portfolio execution,
  real-time trading alerts, and unsupported claims without citations.

## What Exists Now

- Render-friendly npm workspace monorepo.
- Next.js dashboard with storyboard cards and detail pages.
- Mock data shaped like production objects.
- Postgres schema for sources, documents, chunks, entities, themes, signals,
  trends, storyboards, briefs, and alerts.
- Analysis helpers for baseline-aware z-score scoring.
- Claude signal extraction for bounded SEC/FMP smoke runs.
- Analysis inspection page for recent signals, evidence snippets, interpretations,
  and failed document runs.
- Connector interfaces for source ingestion.
- Worker and cron job entrypoints.
- `render.yaml` blueprint for Render deployment.

## Architecture

```text
Content Sources
  -> Source Connectors
  -> Normalization and Deduplication
  -> Postgres + pgvector
  -> Claude Extraction
  -> Theme Clustering and Signal Scoring
  -> Baselines, Z-Scores, and Alerts
  -> Storyboards, Daily Brief, and Copilot
```

Recommended production services:

- **Web:** Next.js app for dashboard, storyboards, daily brief, copilot UI, and
  API routes.
- **Worker:** ingestion, parsing, Claude analysis, embeddings, scoring, and
  storyboard generation.
- **Cron jobs:** source polling, daily brief generation, and trend recompute.
- **Database:** Render Managed Postgres with pgvector.
- **Optional object storage:** raw document storage if documents grow too large
  or source terms require separate retention.

## Project Structure

```text
apps/web             Next.js app and API surface
packages/db          Types, mock data, SQL schema, schema print script
packages/analysis    Claude prompts and scoring helpers
packages/ingest      Source connector interfaces
workers              Worker and cron job entrypoints
render.yaml          Render blueprint
.env.example         Local environment variable template
```

## Data Model

The schema lives in `packages/db/src/schema.sql`.

Core tables:

- `sources`: publisher/company/feed/API configuration and access method.
- `documents`: normalized articles, filings, PRs, transcripts, and manual docs.
- `document_texts`: source-aware full text for analysis where retention terms
  allow it. SEC and FMP text is retained for this private research app.
- `document_chunks`: searchable chunks with pgvector embeddings.
- `document_analysis_runs`: idempotent Claude extraction status per document,
  model, and prompt version.
- `entities`: companies, tickers, sectors, geographies, and macro topics.
- `themes`: stable canonical theme IDs.
- `signals`: per-document extracted theme evidence, tones, confidence, and
  citation snippets.
- `theme_trends`: aggregate windows with baselines, z-scores, percentiles, and
  source mix.
- `storyboards`: narrative pages generated from themes, signals, trends, and
  evidence.
- `briefs`: daily or weekly narrative summaries.
- `alerts`: in-app or email flags when worry/bullishness accelerates.

## Scoring Methodology

Some themes are always present in markets. Inflation, rates, AI, regulation,
consumer weakness, and credit quality should not be flagged just because they
appear frequently.

The app ranks themes by **normalized surprise**, not raw popularity.

For each canonical theme, the system calculates intensity from:

- Document count and mention count.
- Source diversity across filings, PRs, transcripts, newspapers, and manual
  documents.
- Entity breadth across companies, sectors, and macro variables.
- Risk/worry tone.
- Bullish/opportunity tone.
- Evidence quality.
- Extraction confidence.

Then it compares current intensity to historical baselines:

```text
z_score = (current_intensity - baseline_mean) / baseline_stddev
```

The first scoring implementation also tracks percentile rank and requires
minimum evidence before promotion. A theme should rank highly when it has:

- Elevated z-score.
- High percentile versus its own history.
- Multiple independent evidence cards.
- Broader source mix or entity breadth.
- Clear tone shift.

New themes should start as emerging/unconfirmed and graduate into ranked alerts
only after enough evidence, clustering stability, and baseline history.

## Source Strategy

The source layer is designed around connectors. Each connector should define:

- Source ID and source class.
- Credential or access method.
- Rate limits.
- Terms/compliance notes.
- Retrieval method.
- Parser.
- Deduplication behavior.

Priority source classes:

- SEC filings.
- Company investor-relations press releases.
- Earnings call transcripts.
- Credentialed newspapers and financial publications.
- Controlled scraping where needed.
- Manual paste/upload for hard-to-access sources.

The app should use credentials where possible and scraping only where explicitly
configured. Keep `SCRAPING_ENABLED=false` until a source has a clear rule set.

SEC ingestion uses official SEC JSON endpoints and filing document downloads,
not browser scraping. Configure `SEC_USER_AGENT` with an app name and contact
email before running SEC jobs.

SEC coverage is designed for theme detection rather than filing completeness.
The connector ingests:

- Core narrative filings: `10-K`, `10-Q`, `8-K`.
- 8-K exhibits: relevant `EX-99.1`, `EX-99.2`, investor presentations,
  earnings releases, merger decks, restructuring decks, financing, guidance,
  impairment, regulatory, and operations-related exhibits.
- Proxy/governance filings: `DEF 14A`, `DEFA14A`, `PRE 14A`.
- Capital markets and transaction filings: `S-1`, `S-3`, `S-4`, and `424B*`.
- Activism and ownership-change filings: `SC 13D`, `SC 13D/A`, `SC 13G`,
  `SC 13G/A`.
- Stress filings: `NT 10-K`, `NT 10-Q`, and amended `10-K/A`, `10-Q/A`, `8-K/A`.

`13F-HR` and Form `4` are intentionally off by default. They are useful, but
should be interpreted later as structured/aggregate signals rather than raw
narrative text.

FMP transcript ingestion uses Financial Modeling Prep earnings call transcript
endpoints. Configure `FMP_API_KEY` in Render or local env before running FMP
jobs. FMP runs separately from SEC because transcripts update on a different
cadence.

For copyrighted or paywalled sources, default to storing metadata, embeddings,
extracted signals, and short citation snippets unless source-specific terms
allow full-text retention.

## Claude Usage

Claude is intended for:

- Document classification.
- Theme/risk/opportunity extraction.
- Evidence snippet selection.
- Tone scoring.
- Theme normalization and clustering support.
- Storyboard generation.
- Daily brief generation.
- Copilot answers over retrieved evidence.

Important product rule: distinguish sourced evidence from model interpretation.
The UI should make it clear when a statement is a citation-backed source claim
versus Claude's synthesis.

The first live Claude integration extracts market signals from SEC/FMP documents:

- Uses full-document analysis where practical.
- Splits oversized documents into sections and merges/dedupes the outputs.
- Defaults to Sonnet via `ANTHROPIC_MODEL`.
- Tracks idempotency by document, model, and `CLAUDE_PROMPT_VERSION`.
- Stores exact evidence snippets capped by `CLAUDE_MAX_EVIDENCE_CHARS`.
- Stores parsed structured fields only, not raw Claude responses by default.
- Leaves extracted themes as `emerging` until later trend/storyboard promotion.

Prompt scaffolding lives in `packages/analysis/src/prompts.ts`.
Open `/analysis` in the web app to inspect recent Claude signals and failed
runs before using them in production storyboards. The same page can queue and
stop bounded Claude extraction backfill jobs; the web app writes job requests to
Postgres and the worker executes them cooperatively in the background.

Trend aggregation turns stored Claude signals into deterministic `theme_trends`
rows. It computes 7-day and 30-day rolling windows from source `published_at`
dates, includes zero-intensity days, compares each theme to its own history, and
flags low-history rows until at least 14 baseline days exist.

## Local Development

Requirements:

- Node.js 20 or newer.
- npm.

Install dependencies:

```bash
npm install
```

Run the web app:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

## Environment Variables

Copy `.env.example` to `.env.local` for local development when needed.

```text
DATABASE_URL=postgres://user:password@host:5432/market_themes
ANTHROPIC_API_KEY=sk-ant-api03-example
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
CLAUDE_PROMPT_VERSION=market_signal_extraction_v1
CLAUDE_EXTRACTION_DOCUMENT_LIMIT=20
CLAUDE_EXTRACTION_BATCH_SIZE=25
CLAUDE_EXTRACTION_MAX_BATCHES=1
CLAUDE_EXTRACTION_CONCURRENCY=2
CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS=600000
CLAUDE_EXTRACTION_LOOKBACK_DAYS=
CLAUDE_STALE_RUN_MINUTES=90
CLAUDE_MAX_EVIDENCE_CHARS=800
CLAUDE_EXCLUDED_SEC_CATEGORIES=capital_markets
BACKFILL_WORKER_POLL_INTERVAL_MS=45000
THEME_NORMALIZATION_PROMPT_VERSION=theme_normalization_v2
THEME_NORMALIZATION_BATCH_SIZE=25
TREND_LOOKBACK_DAYS=120
TREND_LOW_HISTORY_DAYS=14
TREND_AS_OF_DATE=
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-secret
SOURCE_CONFIG_JSON={}
SCRAPING_ENABLED=false
SCRAPER_USER_AGENT=MarketThemesBot/0.1 contact@example.com
SEC_USER_AGENT=MarketThemesBot/0.1 contact@example.com
SEC_TARGET_TICKERS=AAPL,MSFT,JPM,WMT,XOM
SEC_POLL_LOOKBACK_DAYS=7
SEC_BACKFILL_MONTHS=12
SEC_BACKFILL_BATCH_SIZE=10
SEC_BACKFILL_BATCH_INDEX=0
SEC_RATE_LIMIT_MS=220
SEC_INCLUDE_CORE_FORMS=true
SEC_INCLUDE_PROXY_FORMS=true
SEC_INCLUDE_CAPITAL_MARKETS_FORMS=true
SEC_INCLUDE_OWNERSHIP_FORMS=true
SEC_INCLUDE_STRESS_FORMS=true
SEC_INCLUDE_8K_EXHIBITS=true
SEC_INCLUDE_STRUCTURED_OWNERSHIP_FORMS=false
FMP_API_KEY=
FMP_TARGET_TICKERS=AAPL,MSFT,JPM,WMT,XOM
FMP_BACKFILL_QUARTERS=8
FMP_BACKFILL_BATCH_SIZE=10
FMP_BACKFILL_BATCH_INDEX=0
FMP_RATE_LIMIT_MS=250
FMP_SMOKE_QUARTERS=2
EMAIL_PROVIDER_API_KEY=
```

Current mock-data UI does not require a live database or Anthropic key. Real
ingestion and analysis will require `DATABASE_URL` and `ANTHROPIC_API_KEY`.

## Useful Commands

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run db:schema
npm run db:apply
npm run poll:sources --workspace @market-themes/workers
npm run sec:smoke
npm run sec:backfill
npm run fmp:smoke
npm run fmp:backfill
npm run fmp:poll
npm run claude:extract:smoke
npm run claude:extract:backfill
npm run themes:normalize
npm run brief:daily --workspace @market-themes/workers
npm run trends:recompute --workspace @market-themes/workers
```

SEC smoke ingestion uses `AAPL`, `MSFT`, `JPM`, `WMT`, and `XOM`. Full SEC
backfills use `SEC_BACKFILL_BATCH_INDEX` and `SEC_BACKFILL_BATCH_SIZE` so the
job can be resumed in manageable batches.

Expanded SEC documents are categorized in `documents.metadata.filingCategory`:
`core`, `exhibit`, `proxy`, `capital_markets`, `ownership`, `stress`, or
`structured_ownership`. The `/ingestion` page shows category counts so you can
confirm which SEC source families are landing.

FMP smoke ingestion also uses `AAPL`, `MSFT`, `JPM`, `WMT`, and `XOM`.
FMP backfills use `FMP_BACKFILL_BATCH_INDEX`, `FMP_BACKFILL_BATCH_SIZE`, and
`FMP_BACKFILL_QUARTERS`. FMP polling is intended to run daily overnight.

Claude smoke extraction uses the newest SEC/FMP documents that have not already
completed the current prompt version. It excludes `capital_markets` SEC filings
by default because prospectus-style `424B*` documents are often long and
low-signal for the first quality pass. Start with:

```bash
npm run db:apply
npm run claude:extract:smoke
```

Then inspect `/analysis` before scheduling any automated Claude cron.

For broader corpus coverage, open `/analysis` and use the Backfill Control panel
to start or stop a bounded worker-backed run. The manual command is still useful
for local testing:

```bash
CLAUDE_EXTRACTION_BATCH_SIZE=25 CLAUDE_EXTRACTION_MAX_BATCHES=4 CLAUDE_EXTRACTION_CONCURRENCY=2 npm run claude:extract:backfill
```

The backfill job recovers stale `running` analysis rows, processes bounded
batches with bounded concurrency, applies a per-document timeout, keeps the same
source priority order as smoke extraction, and continues to exclude
`capital_markets` SEC filings by default. After each larger backfill, run theme
normalization and trend recompute.

Theme normalization maps company-specific extracted themes into overall market
themes and optional sector sub-themes:

```bash
npm run themes:normalize
npm run trends:recompute --workspace @market-themes/workers
```

Open `/theme-mappings` to review market themes, sector sub-themes, mapped
extracted themes, confidence, rationale, affected entities, and snippets.
The normalization prompt favors short reusable parent labels and merges verbose
near-duplicates into broader canonical themes.

Trend recompute uses existing signals and writes idempotent rows into
`theme_trends`:

```bash
npm run trends:recompute --workspace @market-themes/workers
```

Open `/trends` to review the ranked market theme digest. The page defaults to a
short list of top 7-day overall market themes with breadth across at least two
entities or two independent documents, nests sector sub-themes under their
parent market theme, collapses supporting evidence, and moves company-specific
or one-off themes into an emerging lane.

## Database Setup

Print the SQL schema:

```bash
npm run db:schema
```

Apply that SQL to your Postgres database. The schema enables pgvector:

```sql
create extension if not exists vector;
```

On Render, use a Postgres plan that supports pgvector. If pgvector is not
enabled by default, enable it before creating `document_chunks`.

## Render Deployment

This repo includes a `render.yaml` blueprint.

The blueprint defines:

- `themes-web`: Next.js web service.
- `themes-worker`: background worker service.
- `themes-postgres`: managed Postgres database.
- `poll-sources`: cron job for source polling.
- `poll-fmp-transcripts`: daily cron job for FMP transcript polling.
- `generate-daily-brief`: cron job for daily brief generation.
- `recompute-theme-trends`: cron job for z-score and baseline refreshes.

Deployment steps:

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Let Render provision the web service, worker, cron jobs, and Postgres.
4. Set required secrets:
   - `ANTHROPIC_API_KEY`
   - `APP_BASE_URL`
   - `FMP_API_KEY`
   - source credentials in `SOURCE_CONFIG_JSON` or separate env vars
5. Keep `SCRAPING_ENABLED=false` until each source has explicit configuration.
6. Apply the SQL from `npm run db:schema` to the Render Postgres database.
7. Deploy `themes-web`.
8. Confirm the cron job logs show expected output.

Render implementation notes:

- Services should be stateless except Postgres or object storage.
- Ingestion jobs should be idempotent.
- Cron retries should not create duplicate documents.
- Durable data should not be written to the local filesystem.
- Logs should include source ID, retrieval method, document counts, Claude usage,
  scoring job IDs, and error context.

## Worker Jobs

Current worker scripts are smoke-testable scaffolds:

```bash
npm run poll:sources --workspace @market-themes/workers
npm run sec:smoke
npm run sec:backfill
npm run fmp:smoke
npm run fmp:backfill
npm run fmp:poll
npm run claude:extract:smoke
npm run themes:normalize
npm run brief:daily --workspace @market-themes/workers
npm run trends:recompute --workspace @market-themes/workers
```

The worker uses `node --import tsx` so TypeScript entrypoints run locally and on
Render without a separate build step.

Open `/ingestion` in the web app to see separate operational cards for SEC
filings and FMP transcripts.

Open `/analysis` to review Claude-extracted signals, evidence snippets,
interpretations, and failed analysis runs.

Open `/theme-mappings` to review how extracted themes roll up into overall
market themes and sector sub-themes.

Open `/trends` to review the digest-style market theme rankings before
replacing the mock dashboard with live rankings.

## Development Roadmap

Near-term:

1. Expand the checked-in SEC ticker seed to the full S&P 500 plus Nasdaq-100.
2. Run FMP transcript smoke and backfill jobs.
3. Review Claude signal quality from `/analysis`.
4. Review normalized theme mappings from `/theme-mappings`.
5. Review computed trend rows from `/trends`.
6. Replace mock storyboard reads with Postgres queries.
7. Add migrations or a migration runner.
8. Add manual document paste/upload.
9. Add company IR press release ingestion.
10. Store embeddings for copilot retrieval.
11. Generate storyboards and daily briefs from stored evidence.

Then:

1. Add credentialed newspaper connectors source by source.
2. Add controlled scraping configuration where needed.
3. Add source-specific retention policies.
4. Add user review controls for merging, splitting, and dismissing themes.
5. Add daily email delivery.
6. Add historical evaluation sets for false positives and false negatives.
7. Add copilot retrieval over chunks, signals, and storyboards.

## Quality And Evaluation

Before trusting alerts, build a small historical evaluation set of known market
themes. For each historical theme, evaluate:

- Did the app surface it early?
- Did the z-score move before the theme became obvious?
- Were the evidence cards actually relevant?
- Did Claude overstate the implication?
- Were false positives caused by one noisy source or real breadth?

This evaluation loop should guide thresholds, source weights, and theme
clustering behavior.

## Security And Compliance

- Store credentials in Render environment variables or a secrets manager.
- Do not commit real credentials.
- Keep `.env` and `.env.local` ignored.
- Keep scraping disabled by default.
- Track source access method and retrieval logs.
- Respect rate limits.
- Prefer snippets and metadata for copyrighted sources unless terms allow full
  text.
- Make citation-backed evidence visible for all generated claims.

## Known Limitations

- The main dashboard still uses mock storyboard data.
- Claude signals are inspectable, but they do not yet power trend ranking or
  storyboards.
- The copilot is a UI preview, not a live retrieval system yet.
- Lint currently delegates to TypeScript checks; add ESLint before production
  hardening.

## Repository

GitHub: `https://github.com/jnacey2/Market-Themes.git`
