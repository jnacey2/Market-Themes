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
- Next.js overview organised into Rising / Peaking / Fading / New lanes, ranked by
  raw attention surprise, with storyboard cards and detail pages.
- Lifecycle states (emerging, rising, peaking, steady, fading, dormant) derived from
  reviewed density, raw classifier attention, and peak statistics
  (days since peak, percent of peak) for every tracked narrative.
- Stored daily brief and narrative alerts written by a scheduled job from the
  measured board, plus a `/changes` page listing state transitions, board
  entries and exits, and unusual moves day over day.
- Corpus-level attention burst detection (n-grams, entities, extracted themes)
  that flags terms several independent publishers started covering, surfaces the
  uncovered ones as an operator watchlist, and feeds them into discovery prompts.
- Mock data shaped like production objects.
- Postgres schema for sources, documents, chunks, entities, themes, signals,
  trends, storyboards, briefs, and alerts.
- Analysis helpers for baseline-aware z-score scoring.
- Ten versioned, curated narrative definitions with strict inclusion/exclusion guidance.
- Corpus-normalized narrative observations and 7-day/30-day historical trend series.
- Candidate narrative discovery for propositions outside the curated watchlist,
  with exact-quote evidence, independent-publisher breadth gates, merge/reject
  review, and promotion into versioned tracked narratives.
- Per-source ingest, extraction, classification, discovery, and review telemetry.
- Interactive Narrative Currents board, timeline drilldowns, and live storyboards.
- Schema-constrained Claude signal extraction for bounded SEC/FMP smoke and
  recent-corpus backfill runs.
- Analysis inspection page for recent signals, evidence snippets, interpretations,
  and failed document runs.
- Connector interfaces for source ingestion.
- Official Federal Reserve (press releases, speeches, testimony), BLS, BEA, EIA,
  configurable company-IR RSS, and optional GDELT discovery connectors.
- One-click public newspaper RSS presets (NYT, WSJ, Washington Post, Bloomberg, FT)
  and trade-press presets (Industry Dive family and others) with snippet-only
  retention and shared publisher-owner mapping.
- Issuer universe for SEC filings and FMP transcripts resolved from FMP index
  constituents (`TARGET_UNIVERSE`, S&P 500 by default) with a checked-in fallback.
- Earnings-call transcripts sectioned at the prepared-remarks / Q&A boundary so
  extracted evidence is labelled by regime.
- Ingestion coverage funnel on `/ingestion`: fetched, deduplicated, analyzable,
  extracted, classified, matched, approved, and candidate-cited counts per window
  and per source class.
- Real-document evaluation export with review-labelled and hand-labelled recall
  strata, and an emergence backtest CLI that reports how early each detector
  fired relative to definition dates or asserted truth dates.
- Worker and cron job entrypoints.
- A scheduled end-to-end pipeline with connector checkpoints and operations status.
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
config/substacks.yaml  Paid Substack names and homepage URLs only
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
- `anthropic_message_batches` / `anthropic_message_batch_items`: durable
  provider-batch lifecycle, request mappings, outcomes, and token usage.
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

Curated narratives use a separate, stable measurement contract. Each active or
probationary measurement definition is evaluated against every eligible document
and records both matches and non-matches; only active definitions are published.
Daily density is the percentage of eligible unique documents
matching the proposition, calculated per source class and then combined with
log-volume weights so a high-volume feed cannot dominate the result and a
single-document class cannot swing it. Baselines use non-overlapping prior
windows with a robust (MAD-based, floored) scale, so a sustained run of zero
matches after a real baseline produces a negative z-score and a `fading` state
instead of being skipped.

Two series are tracked per narrative. **Reviewed density** counts only approved
evidence and drives the board. **Raw attention** counts every non-rejected
classifier match weighted by confidence, so a single-source signal is visible
days before review confirms it; the overview lanes rank by raw attention
surprise and the sparkline shows both lines. Peak density, peak date, days since
peak, and percent of peak are stored on every trend row and drive the
lifecycle state:

| State | Meaning |
| --- | --- |
| `unmeasured` | Classification coverage is too thin to measure the window. |
| `dormant` | Measured, with no reviewed evidence in this window or the last. |
| `emerging` | Reviewed evidence exists but the baseline history is still short. |
| `rising` | Reviewed density climbed by more than the noise floor. |
| `peaking` | Within 15% of the recent peak and not yet past it. |
| `steady` | Sustained reviewed attention without an unusual move. |
| `fading` | Dropped to zero, fell two windows running, or sits below half of a peak that is at least one window old. |

Newly activated definitions also appear in the overview's "New" lane for their
first week regardless of state.

The UI reports publisher breadth
and publisher-owner breadth separately, and uses normalized-title/connector
fingerprints to report unique-story breadth without counting syndicated copies
as independent confirmation. Classification coverage is shown as classified
readable documents over the current corpus; pending or partial coverage is not
presented as a measured zero. Narrative movement compares adjacent windows; it
measures attention, not agreement, sentiment, or predictive performance.

Candidate-origin definitions enter `probationary` status. They publish only
after three current-classifier-version unique stories from three publisher
groups pass review. Event definitions receive an expiry and are removed from
the active board automatically. Related event consequences can share a
non-classified family parent and a named measurement dimension.

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

### Managed Publications

Authenticated operators can add the Substacks they subscribe to, plus RSS and
Atom publications, at `/sources`. Managed feeds are stored in
`publication_feeds`, loaded dynamically by `poll-sources`, and do not require a
code deployment.

Substack ingestion uses the publication's archive and post JSON endpoints, not
article HTML pages. Playwright is used only to capture the subscriber session
for publications you already pay for.

- Discovers posts newest-first from `{origin}/api/v1/archive` in pages of 25.
- Downloads each post from `{origin}/api/v1/posts/{slug}` with that session.
- Public posts (`audience=everyone`) are stored as full text when the body is
  available.
- Paid subscriber posts are stored as full text when the session can read them.
  Truncated responses are stored as previews and upgraded on the next
  authenticated poll.
- `/sources` can paste a homepage URL (name is inferred) or add the checked-in
  Investment Process list in one click. The seed is `config/substacks.yaml`
  (names and URLs only).
- Scrape by URL or from that YAML without a deploy:
  `npm run substack:scrape -- --url https://moontower.substack.com`,
  `npm run substack:scrape -- --config config/substacks.yaml`,
  or `npm run substack:scrape -- --all`. If `DATABASE_URL` is unset the CLI
  still fetches archive and post JSON.
- Capture the session locally with `npm run substack:capture-session`, confirm a
  paid article opens, then set `SUBSTACK_STORAGE_STATE_B64`. Local CLI also
  reads ignored `.auth/substack.storage-state.json`.
- Incremental polls stop at each publication's `lastPublishedAt` watermark and
  advance that watermark only after documents persist.
- Applies per-publication lookback, post-count, 1.5s default rate-limit,
  retention, and publisher-ownership settings.
- Rejects feed URLs that resolve to local or private networks.

RSS/Atom feeds support either public full-text retention or snippet-only
retention. Every managed publication remains subject to canonical URL/content
deduplication and the human narrative-evidence review gate.

`/sources` includes one-click presets for official NYT, WSJ, Washington Post,
Bloomberg, and FT RSS feeds. Those presets always use snippet retention and do
not send publisher logins or session cookies. FMP news, RSS, GDELT, and the
optional authenticated collector share the same publisher-owner slugs
(`dow-jones`, `nyt`, `washington-post`, `bloomberg`, `financial-times`) so
syndicated copies do not inflate breadth. RSS items with explicit Reuters, AP,
or AFP attribution are assigned to that wire owner rather than the feed host.

Optional GDELT discovery stays metadata-only. When enabled, `GDELT_DOMAINS`
defaults to `wsj.com,nytimes.com,bloomberg.com,washingtonpost.com,ft.com,reuters.com`.
Set `GDELT_DOMAINS=` to query without a domain filter.

The NYT Article Search connector is idle unless `NYT_API_KEY` is set. It stores
official abstracts only.

### Authenticated Publisher Collection

An isolated Playwright cron can collect licensed subscriber content from WSJ,
The New York Times, The Washington Post, Financial Times, and Bloomberg. This
path assumes the operator has confirmed machine retrieval, storage, and LLM
processing rights for each enabled publisher.

The collector uses public RSS feeds for discovery, then opens only publisher
article URLs from a hard-coded HTTPS hostname allowlist. It does not bypass
paywalls, CAPTCHAs, bot checks, or access controls. If a session expires or a
human-verification challenge appears, that publisher fails closed and reports
the error in Operations.

Capture a session locally:

```bash
npx playwright install chromium
npm run premium:capture-session -- wsj
npm run substack:capture-session
```

Supported IDs are `wsj`, `nyt`, `wapo`, `ft`, and `bloomberg`. Log in manually
in the opened browser and verify a subscriber article, then press Enter in the
terminal. The tool writes ignored `.auth/<publisher>.storage-state.json` and
`.auth/<publisher>.storage-state.b64` files with restrictive permissions.

Add the encoded file contents to the matching Render secret:

```text
WSJ_STORAGE_STATE_B64
NYT_STORAGE_STATE_B64
WAPO_STORAGE_STATE_B64
FT_STORAGE_STATE_B64
BLOOMBERG_STORAGE_STATE_B64
```

Enable only captured publishers in `PREMIUM_PUBLISHERS`, for example
`wsj,nyt,ft`, and set `SCRAPING_ENABLED=true` only after validating every
configured session. The `scrape-premium-publishers` Render cron runs in the pinned
Playwright container, applies strict rate and article-count limits, and routes
all documents through the same deduplication and evidence-review gates.

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
- Defaults every live analysis workload to Haiku 4.5 via `ANTHROPIC_MODEL`.
- Keeps a separate `NARRATIVE_PROMOTION_VALIDATION_MODEL` override for the
  bounded promotion-quality pass.
- Tracks idempotency by document, model, and `CLAUDE_PROMPT_VERSION`.
- Stores exact evidence snippets capped by `CLAUDE_MAX_EVIDENCE_CHARS`.
- Stores parsed structured fields only, not raw Claude responses by default.
- Leaves extracted themes as `emerging` until later trend/storyboard promotion.

Narrative classification returns only positive matches and deterministically
persists omitted definitions as non-matches, avoiding repeated negative output
tokens. Version 7 requires each returned match to include a contract audit:
every inclusion leg must be supported by the exact quotation and no exclusion
may be triggered. Machine-readable evidence contracts can additionally require
specific term groups for high-risk causal claims. Its stable definition prefix
has an ephemeral cache breakpoint when
`ANTHROPIC_PROMPT_CACHING` is not `false`: synchronous calls use five minutes
and batches use one hour. Haiku 4.5 only creates a cache entry when that reusable
prefix reaches 4,096 tokens, so shorter prefixes continue uncached without error.
Each request logs uncached input, cache-write input, cache-read input, and output
token counts under `[anthropic-usage]`.

Scheduled extraction, classification, and discovery use Anthropic Message
Batches, which discount input and output tokens by 50%. Hourly submit crons
create the next bounded batch only when that workload has no active batch, while
`poll-anthropic-batches` reconciles provider state and applies results every ten
minutes.
Provider IDs, custom-ID mappings, item outcomes, and usage are stored in
`anthropic_message_batches` and `anthropic_message_batch_items`; raw model
responses are not stored. Completed records are retained for 35 days by default.
Only one provider batch may be active per workload.
Most batches finish within an hour, but results can take up to 24 hours. An
ambiguous submission is held for 25 hours instead of being resubmitted and
potentially billed twice. Interactive candidate promotion and the normalization
step that immediately feeds trend recomputation remain synchronous.

Model identity is part of extraction, classification, and discovery idempotency.
Changing `ANTHROPIC_MODEL` therefore makes previously analyzed documents eligible
for a one-time reprocessing backlog; it does not relabel old records. Scheduled
extraction, classification, and discovery runs cap that rollout at 100, 40, and
40 documents per submitted batch respectively.

Run the human-labeled classifier evaluation through the discounted Batch API
before changing models or autonomous approval policy:

```bash
npm run eval:narratives -- --model claude-haiku-4-5-20251001
# Submit after reviewing the dry-run request count:
npm run eval:narratives -- --submit --model claude-haiku-4-5-20251001
# After the returned batch ends:
npm run eval:narratives -- --batch-id msgbatch_... --model claude-haiku-4-5-20251001
```

The result reports precision, recall, F1, and accuracy overall and per
definition. Submit the same set with a challenger model to compare quality.

The built-in set is ten synthetic sentences, which is enough to catch prompt
regressions but says nothing about recall on real documents. Export real cases
from the database instead:

```bash
# Reviewed documents arrive labelled from approve/reject decisions; the
# "unlabeled" recall sample must be hand-labelled by editing expectedMatchedSlugs.
npm run eval:export -- --out eval/narrative-eval-cases.json --unlabeled 40
# Score the production classifier's stored verdicts without any model call:
npm run eval:narratives -- --offline --cases eval/narrative-eval-cases.json
# Or re-run the classifier on the exported cases through the Batch API:
npm run eval:narratives -- --submit --cases eval/narrative-eval-cases.json
```

Scores are reported per label stratum. The `review` stratum measures precision
on what the classifier already found; only the hand-labelled `unlabeled`
stratum can measure recall, because review never sees documents the classifier
skipped. `documentRecall` is the share of positive cases whose every expected
slug was recovered. The `eval/` directory is git-ignored.

To check detection latency rather than labelling accuracy, run the emergence
backtest against stored trend history:

```bash
npm run narratives:backtest
npm run narratives:backtest -- --truth eval/emergence-truth.json --window 7d --z 2
```

Without a truth file it reports, per narrative, the first date raw attention,
reviewed density, and the lifecycle state would have fired, and how far ahead of
or behind the definition date that was. With a truth file (`{"slug":
"YYYY-MM-DD"}`) it adds median lag and the share detected within 7 and 14 days.

Prompt scaffolding lives in `packages/analysis/src/prompts.ts`.
Open `/analysis` in the web app to inspect recent Claude signals and failed
runs before using them in production storyboards. The same page can queue and
stop bounded Claude extraction backfill jobs; the web app writes job requests to
Postgres and the worker executes them cooperatively in the background. Status
sections fail independently: a busy database is shown as partial data with
unavailable values, never as false zero counts.

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
# disable | no-verify | verify-full (unset: Render hosts use no-verify, others disable)
DB_SSL_MODE=
DB_SSL_CA=
ANTHROPIC_API_KEY=sk-ant-api03-example
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_PROMPT_CACHING=true
ANTHROPIC_BATCH_MAX_BYTES=251658240
ANTHROPIC_BATCH_RETENTION_DAYS=35
NARRATIVE_PROMOTION_VALIDATION_MODEL=claude-haiku-4-5-20251001
CLAUDE_PROMPT_VERSION=market_signal_extraction_v2
CLAUDE_EXTRACTION_DOCUMENT_LIMIT=20
CLAUDE_EXTRACTION_BATCH_SIZE=25
CLAUDE_EXTRACTION_MAX_BATCHES=1
CLAUDE_EXTRACTION_CONCURRENCY=2
CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS=600000
CLAUDE_EXTRACTION_LOOKBACK_DAYS=
CLAUDE_STALE_RUN_MINUTES=90
CLAUDE_ANALYSIS_MAX_ATTEMPTS=5
CLAUDE_MAX_EVIDENCE_CHARS=800
CLAUDE_EXCLUDED_SEC_CATEGORIES=capital_markets
BACKFILL_WORKER_POLL_INTERVAL_MS=45000
THEME_NORMALIZATION_PROMPT_VERSION=theme_normalization_v3
THEME_NORMALIZATION_BATCH_SIZE=25
THEME_NORMALIZATION_MAX_BATCHES=100
NARRATIVE_CLASSIFICATION_PROMPT_VERSION=narrative_classification_v7
# Documents older than this are not (re)classified when definitions change.
NARRATIVE_CLASSIFICATION_LOOKBACK_DAYS=60
NARRATIVE_PROMOTION_VALIDATION_PROMPT_VERSION=candidate_promotion_validation_v2
NARRATIVE_EVENT_TTL_DAYS=14
NARRATIVE_ACTIVATION_MIN_STORIES=3
NARRATIVE_ACTIVATION_MIN_PUBLISHER_OWNERS=3
NARRATIVE_ACTIVATION_LOOKBACK_DAYS=7
TREND_LOOKBACK_DAYS=120
TREND_LOW_HISTORY_DAYS=14
TREND_STORAGE_DAYS=45
TREND_INSERT_BATCH_SIZE=250
TREND_AS_OF_DATE=
REPAIR_DOCUMENT_TEXTS_BATCH_SIZE=25
REPAIR_DOCUMENT_TEXTS_MAX_BATCHES=20
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-secret
SOURCE_CONFIG_JSON={}
SUBSTACK_STORAGE_STATE_B64=
SUBSTACK_STORAGE_STATE_PATH=
SUBSTACK_PUBLICATIONS_YAML=
SUBSTACK_REFRESH=false
SUBSTACK_EMAIL=
SUBSTACK_PASSWORD=
SCRAPING_ENABLED=false
SCRAPER_USER_AGENT=MarketThemesBot/0.1 contact@example.com
GDELT_ENABLED=false
GDELT_DOMAINS=wsj.com,nytimes.com,bloomberg.com,washingtonpost.com,ft.com,reuters.com
NYT_API_KEY=
NYT_SEARCH_LOOKBACK_HOURS=24
SEC_USER_AGENT=MarketThemesBot/0.1 contact@example.com
# Issuer universe for SEC filings and FMP transcripts: sp500 | nasdaq100 | dowjones | seed
# (comma-separated). Requires FMP_API_KEY; falls back to the seed list otherwise.
TARGET_UNIVERSE=sp500
# Explicit override that bypasses TARGET_UNIVERSE.
SEC_TARGET_TICKERS=
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
npm run substack:capture-session
npm run substack:scrape -- --url https://moontower.substack.com
npm run substack:scrape -- --all
npm run sec:smoke
npm run sec:backfill
npm run fmp:smoke
npm run fmp:backfill
npm run fmp:poll
npm run repair:document-texts
npm run claude:extract:smoke
npm run claude:extract:backfill
npm run claude:extract:batch
npm run themes:normalize
npm run themes:normalize:backfill
npm run narratives:classify
npm run narratives:classify:batch
npm run narratives:discover
npm run narratives:discover:batch
npm run anthropic:batches:poll
npm run eval:narratives -- --model claude-haiku-4-5-20251001
npm run eval:export -- --out eval/narrative-eval-cases.json
npm run narratives:backtest
npm run narratives:bursts --workspace @market-themes/workers
npm run narratives:auto-review
npm run narrative-trends:recompute
npm run pipeline
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
to start or stop a worker-backed run. UI-started jobs default to a controlled
100-document pass over the latest 30 days at concurrency `2`. The manual command
supports other explicitly bounded runs:

```bash
CLAUDE_EXTRACTION_BATCH_SIZE=25 CLAUDE_EXTRACTION_MAX_BATCHES=4 CLAUDE_EXTRACTION_CONCURRENCY=2 npm run claude:extract:backfill
```

The backfill job recovers stale `running` analysis rows, processes bounded
batches with bounded concurrency, applies a per-document timeout, keeps the same
source priority order as smoke extraction, and continues to exclude
`capital_markets` SEC filings by default. Anthropic responses use JSON-schema
constrained output instead of free-form JSON. After each larger backfill, run
theme normalization and trend recompute.

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

Narrative classification processes up to
`NARRATIVE_CLASSIFICATION_MAX_DOCUMENTS` readable documents per run, fairly
across source classes. Set the value to `0` only for an intentionally unbounded
drain that still observes the configured runtime limit. Candidate discovery then
looks for directional propositions not covered by active
definitions. Open `/narrative-candidates` to review the resulting clusters. A
candidate cannot be promoted until at least two documents from two independent
publisher-owner groups support it within the configured 30-day evidence window.
Promotion creates a versioned narrative
definition and approved seed observations; the next narrative-trend recompute
publishes its measured history. `/ingestion` shows the remaining classification
and discovery backlog by source.

On Render these steps are intentionally independent: classification runs at
minute 5 each hour, candidate discovery at minute 10, conservative automatic
evidence review at minutes 15 and 45, and narrative trends at minutes 25 and 55.
This keeps approved evidence publishing even while model work continues. The
four-hour theme cron invokes only normalization and theme-trend recomputation
directly; it does not use the multi-stage pipeline selector.

Recent signal extraction runs independently at minute 35 each hour. It
reconciles the prior provider batch, then submits at most 100 unread documents
from the latest 30 days. Running analysis rows prevent the synchronous worker or
four-hour theme cron from duplicating in-flight extraction.

Automatic review is deliberately stricter than the manual queue. Production
requires a classifier score of at least 90 plus corroboration by two documents
from two independent publisher-owner groups within seven days. Preview content
and configured low-trust owners are excluded. Every automatic decision receives
an audit note plus an append-only review event and can still be rejected by a
human. Automatic decisions do not inherit across classifier versions; human
decisions do. Lower-confidence matches remain pending.

New candidates use a stricter autonomous promotion gate: at least three
score-90 independent reports from three publisher-owner groups within seven
days. Before promotion, a second schema-constrained Claude pass deduplicates
media echo, adjudicates every quotation against the candidate's inclusion and
exclusion contract, and labels the candidate as either a specific event or a
structural narrative. Structural narratives also need multiple underlying
events or primary entities; event narratives need one explicit event label.
Only contract-valid evidence is seeded as approved. Blocked candidates expose
the exact reasons in `/narrative-candidates` and remain available for a
documented human override. Operators can retract a promoted narrative without
deleting its evidence or immutable review history.

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
- `generate-daily-brief`: daily cron job that writes the stored brief and
  narrative alerts from the measured board.
- `detect-attention-bursts`: six-hourly corpus-level burst detection (no model
  calls) that feeds the discovery watchlist and prompt hints.
- `recompute-theme-trends`: cron job for z-score and baseline refreshes.
- `extract-recent-signals`: hourly batched extraction of the latest 30-day corpus.
- `classify-narratives`: hourly batched existing-narrative evidence classification.
- `discover-narratives`: hourly batched new-proposition candidate discovery.
- `poll-anthropic-batches`: ten-minute reconciliation and result persistence.
- `auto-review-narratives`: twice-hourly conservative evidence approval and
  guarded candidate promotion.
- `recompute-narrative-trends`: twice-hourly publication of approved evidence.

Deployment steps:

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Let Render provision the web service, worker, cron jobs, and Postgres.
4. Set required secrets:
   - `ANTHROPIC_API_KEY`
   - `APP_BASE_URL`
   - `FMP_API_KEY`
   - source credentials in `SOURCE_CONFIG_JSON` or separate env vars
   - For Blueprint updates, set `ANTHROPIC_API_KEY` separately on the new
     `extract-recent-signals`, `classify-narratives`, and `discover-narratives`
     services, or attach them to an existing Render environment group that
     provides the key.
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
- `themes-web` runs `npm run db:apply` on start and a best-effort
  `npm run db:apply:predeploy` before deploy. Render's pre-deploy instance is
  separate from the running service and often cannot resolve the internal
  Postgres hostname (`dpg-…`, no `*.region-postgres.render.com` suffix). That
  `getaddrinfo ENOTFOUND` failure is a DNS/network issue, not a need for a
  larger database. Schema apply retries transient DNS errors; leftover
  `ENOTFOUND` during pre-deploy is non-fatal so the web process can apply
  schema on the private network. Render blueprints only inject the internal
  URL via `fromDatabase.property: connectionString` (there is no
  `externalConnectionString` property). To make pre-deploy use public DNS,
  set `DATABASE_URL_EXTERNAL` in the Render dashboard to the database's
  External connection string. Do not commit that value.

## Worker Jobs

Current worker scripts are smoke-testable scaffolds:

```bash
npm run poll:sources --workspace @market-themes/workers
npm run substack:capture-session
npm run substack:scrape -- --url https://moontower.substack.com
npm run substack:scrape -- --all
npm run sec:smoke
npm run sec:backfill
npm run fmp:smoke
npm run fmp:backfill
npm run fmp:poll
npm run claude:extract:smoke
npm run claude:extract:batch
npm run themes:normalize
npm run narratives:classify
npm run narratives:classify:batch
npm run narratives:discover
npm run narratives:discover:batch
npm run anthropic:batches:poll
npm run eval:narratives -- --model claude-haiku-4-5-20251001
npm run eval:export -- --out eval/narrative-eval-cases.json
npm run narratives:backtest
npm run narratives:bursts --workspace @market-themes/workers
npm run narratives:auto-review
npm run narrative-trends:recompute
npm run brief:daily --workspace @market-themes/workers
npm run trends:recompute --workspace @market-themes/workers
```

The worker uses `node --import tsx` so TypeScript entrypoints run locally and on
Render without a separate build step.

Open `/ingestion` in the web app to see separate operational cards for SEC
filings and FMP transcripts, plus the coverage funnel (fetched, deduplicated,
analyzable, extracted, classified, matched, approved, candidate-cited) for the
last 1, 7, or 30 days and per source class. Polling runs are recorded in
`pipeline_runs`, so the fetched and deduplicated counts only cover runs since
that recording was added.

Open `/changes` to see what moved since the previous day: lifecycle state
transitions, board entries and exits, and unusual raw-attention moves.

Open `/analysis` to review Claude-extracted signals, evidence snippets,
interpretations, and failed analysis runs.

Open `/theme-mappings` to review how extracted themes roll up into overall
market themes and sector sub-themes.

Open `/trends` to review the digest-style market theme rankings before
replacing the mock dashboard with live rankings.

## Development Roadmap

Done and in production use: Postgres-backed storyboards, ordered migrations,
company-IR and official-source RSS, FMP-resolved issuer universe, lifecycle
states with peak tracking, raw-attention early signal, stored daily briefs and
alerts, the `/changes` delta view, corpus-level burst detection, the ingestion
funnel, and real-document evaluation export with an emergence backtest.

Near-term:

1. Hand-label the exported `unlabeled` recall stratum for every active
   definition and record the first measured recall baseline.
2. Assert truth dates for the narratives already on the board and run the
   emergence backtest to calibrate the raw-attention z-threshold.
3. Add manual document paste/upload.
4. Store embeddings for copilot retrieval.
5. Add credentialed newspaper connectors source by source, with controlled
   scraping configuration where terms allow it.

Then:

1. Add user review controls for merging, splitting, and dismissing themes.
2. Add daily email delivery of the stored brief and alerts.
3. Add copilot retrieval over chunks, signals, and storyboards.
4. Expand attention-burst detection with cross-source co-occurrence so a term
   that appears in filings and press simultaneously ranks above one-class bursts.

## Quality And Evaluation

Three checks now have tooling; run them before changing thresholds, prompts, or
source weights:

- **Labelling accuracy**: `npm run eval:export` then `npm run eval:narratives
  -- --offline` scores the production classifier's stored verdicts against
  review decisions and hand labels, per stratum. Only the hand-labelled
  `unlabeled` stratum measures recall.
- **Detection latency**: `npm run narratives:backtest` reports, per narrative,
  how many days before or after the definition (or an asserted truth date) raw
  attention, reviewed density, and the lifecycle state first fired.
- **Coverage**: the `/ingestion` funnel shows where documents drop out between
  fetch and approved evidence, per source class, so a recall problem can be
  separated from an ingestion problem.

For each narrative that mattered historically, still ask: did the app surface it
early, did the z-score move before it became obvious, were the evidence cards
relevant, did Claude overstate the implication, and were false positives caused
by one noisy source or by real breadth across publisher owners.

## Security And Compliance

- Store credentials in Render environment variables or a secrets manager.
- Do not commit real credentials.
- Keep `.env` and `.env.local` ignored.
- Operator routes sit behind HTTP Basic Auth (`OPS_USERNAME`/`OPS_PASSWORD`);
  every mutating API route additionally requires a same-origin request with a
  JSON body, and error responses are redacted to a generic message while the
  full error is logged server-side.
- Set `DB_SSL_MODE=verify-full` with `DB_SSL_CA` wherever a CA bundle is
  available; the default only skips verification for Render-internal hosts.
- Keep scraping disabled by default.
- Track source access method and retrieval logs.
- Respect rate limits.
- Prefer snippets and metadata for copyrighted sources unless terms allow full
  text.
- Make citation-backed evidence visible for all generated claims.

## Known Limitations

- The legacy mock storyboard fixtures remain for development compatibility, but
  live storyboard routes use curated narrative observations and trends.
- Narrative history is only meaningful after a representative historical
  document backfill and classification run; lifecycle states other than
  `emerging` need at least the low-history window of measured days.
- Raw attention is an early, unreviewed signal: it can move on a single
  classifier match and is deliberately shown alongside, not instead of,
  reviewed density.
- Ingestion funnel fetched/deduplicated counts start from the first recorded
  `poll_sources` run; earlier connector history only exists as cumulative
  checkpoint totals.
- Candidate clustering reuses stable model-generated cluster keys and provides a
  manual merge action; semantically equivalent candidates can still require review.
- GDELT is discovery metadata only and is excluded from full-text classification.
- Public newspaper RSS presets store headlines and ledes, not paywalled full text.
- Premium financial-news feeds require a separate license and credentials.
- The copilot is a UI preview, not a live retrieval system yet.

## Repository

GitHub: `https://github.com/jnacey2/Market-Themes.git`
