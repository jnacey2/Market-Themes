# Audit implementation — September 2026

Status: implemented locally; not deployed. The original audit describes revision `add5f5f` and remains a historical record.

Integration prerequisite: fetching GitHub before pushing this work revealed that `origin/main` had advanced by 82 commits to `893a4ee`. This audit implementation was tested on the older `add5f5f` baseline. The newer main branch has overlapping application changes and migrations through 026, including its own review-event tables. Reconcile the implementations and migration ordering, then rerun validation before merging or following the rollout procedure below. This branch is a preserved implementation, not a deployment-ready replacement for current main.

## What changed

### Measurement integrity

- The homepage and `/trends` now share the curated narrative board. Legacy extracted themes no longer determine the primary ranking or masquerade as confirmed narratives. Storyboard URLs lead to the same detailed measurement view.
- `reviewed_density_v2` measures the share of matching documents over each full 7- or 30-day window, with equal weight for each source class and document weighting within a class.
- Comparisons require a covered observation on every calendar day, every ingested eligible document classified, no pending positive reviews, a mature baseline, and matching source classes in adjacent windows. Missing observations cannot become measured zeros.
- A real, fully observed disappearance remains a valid decline. Ties receive midpoint percentiles, tone averages include zeros, and a baseline standard deviation below one percentage point has no z-score. The UI shows unavailable values as a dash.
- Complete UTC days are the default measurement boundary. Database clients explicitly set UTC, including when a database proxy ignores startup options.
- Input changes queue a refresh and immediately mark measurements pending. The worker checks every 45 seconds. Recomputations use a consistent transaction, an advisory lock, and batched writes; queued changes newer than the computation remain pending.

The coverage gate is intentionally conservative. It does **not** establish that every external publisher was successfully ingested. A day with no eligible documents remains unmeasured even if it was genuinely quiet. Publisher-level ingestion completeness and source-composition calibration remain future work.

### Classification, ingestion, and recovery

- Strict response validation rejects missing/duplicate/unknown definitions, malformed fields, contradictory score/match fields, incomplete responses, and invented quotations. Failed classification is not persisted as a negative.
- Long documents are examined in overlapping sections. The strongest supported positive is retained for each proposition; otherwise a negative requires all sections to finish. Metadata records text/definition versions, examined length, section count, and token usage. A 50-section limit and ten-minute request budget bound each document.
- Durable classification jobs provide a 20-minute lease, a maximum of five attempts per content/version, delayed retries, and alternating recent/historical batches. Failed and partially successful command-line stages return nonzero outcomes; pipelines retain their partial state.
- Each document's metadata, retained text, and chunks are committed atomically. Existing incomplete ingests can be repaired on retry. Shared normalized-text fingerprints replace connector-specific hash assumptions; repeated titles no longer discard substantive new text. Blank publisher owners receive a usable default.
- Registered feed requests use HTTPS, reject private/special addresses, pin the validated DNS address to the connection, validate each redirect, and bound request duration and response size. RSS respects configured polling limits. Historical Substack progress persists only after successful ingestion and continues independently of the latest publication timestamp.
- Backfill workers recheck the shared index after asynchronous stop checks. Timeouts abort underlying model requests. Cancellation checks include terminal states, cleanup targets the requested job, and late completion is rejected for cancelled/inactive runs. Heartbeats release abandoned backfill and pipeline jobs; an active pipeline cannot be displaced by another invocation.

- Every legacy extraction attempt now receives a unique ownership token while retaining the stable run ID and section history. Concurrent workers cannot claim the same active or completed run. Late completions and failures cannot overwrite a retry, and the attempt limit is checked atomically during the claim. Stopped backfills cannot claim new work. Results with a different document ID roll back the whole transaction.

### Daily workflow and operations

- Compact evidence-first board, actual classified/expected counts, explicit quality states, 7/30-day measurement links, and responsive navigation.
- Charts distinguish history length from measurement window, show units and a legend, leave gaps for missing measurements, and provide one keyboard-accessible date slider.
- Evidence is fetched from the full stored corpus for the selected date/window, with source/tone filters, pagination, and stale-request cancellation. These citation filters are explicitly separate from the chart's all-source calculation.
- Review supports status filtering, search by title/publisher/narrative, pagination, note preservation, and persistent review events. Changing the quotation, source text, or definition requires fresh approval.
- The daily brief now saves a dated, cited measurement summary, with a 30-day archive at `/briefs`. It explicitly records insufficient coverage instead of importing a mock brief. A rerun updates that day's saved edition. It makes no additional model call.
- Research reads require operational credentials in production by default. `RESEARCH_PUBLIC_READS=true` deliberately exposes research reads; operational actions remain protected. Health errors are generic while server logs retain detail.
- Database TLS verifies certificates for Render hosts. CI uses Node 22; deployment uses the lockfile through `npm ci`. The duplicate six-hour FMP news schedule has been removed from the blueprint; the normal source pipeline still polls FMP news.

## Validation

- Type checks, lint, and production build pass on Node 22.23.2.
- 39 tests pass with the database tests enabled: malformed output, late-document evidence, coverage/review/source-composition gates, zero/tie/tone behavior, unsafe feed addresses, historical pagination, exact-once scheduling, abort propagation, ingestion fault injection, review provenance, classification leases, evidence pagination, brief persistence, cancellation isolation, concurrent extraction claims, stale-attempt rejection, atomic retry limits, deduplication, UTC dates, and pipeline overlap/recovery.
- The full suite now passes against isolated PostgreSQL 16.15 with pgvector 0.8.6, with no skipped tests. The earlier pass used PGlite; the final database verification uses the same PostgreSQL major version as CI. Hosted CI and production load checks remain outstanding.
- All nine migrations apply to a fresh PostgreSQL database, and replay makes no changes. A separate populated database through migration 008 was upgraded through 009: existing run fields and section references were preserved, and a stale legacy run without a token successfully acquired a new attempt and completed. The earlier pass also checked incremental 007-to-008 migration.
- A PostgreSQL custom-format backup restored into a separate local database without errors. All 25 public tables matched by full-row SHA-256 digest and row count; column definitions and indexes also matched. Fixtures included 34 documents, 30 observations, 29 review events, four extraction runs, and 400 trend rows. This verifies the local procedure; a production backup/restore drill is still required.
- An isolated Chromium preview uses synthetic fixtures, never live investment evidence. It checks dashboard overflow at 320, 390, 768, 840, 1000, and 1440 pixels, detail-page overflow at 390 pixels, measurement switching, history/date/source filters, review pagination, archived briefs, and private-read authentication. No application browser errors were observed.
- No production database, paid model requests, publisher credentials, or deployment were used.

## Rollout

1. Take a backup and verify it can be restored to a separate database. Keep the old deployment available for rollback. Pause existing workers/scheduled jobs while migrating and ensure all old extraction processes have exited before starting the new version. Older processes do not enforce attempt ownership.
2. On Node 22, install from the lockfile and run `npm run db:apply` against the intended database. Migrations **007, 008, and 009 are required** before starting the updated processes.
3. Configure the web app and workers with `NARRATIVE_CLASSIFICATION_PROMPT_VERSION=narrative_classification_v6`. Confirm `OPS_USERNAME` and `OPS_PASSWORD`; keep research reads private unless publication is intentional.
4. Deploy/restart the web app, worker, and scheduled jobs together. Remove the old standalone FMP news cron if the hosting platform does not remove services deleted from the blueprint.
5. Reclassify a bounded batch, such as `NARRATIVE_CLASSIFICATION_BATCH_SIZE=10 NARRATIVE_CLASSIFICATION_MAX_BATCHES=1 npm run narratives:classify`. This uses the configured paid model; it was not executed during local validation.
6. Review the new evidence. Run `npm run narrative-trends:recompute`, or let the worker process its refresh queue. New metric/version filtering means the board can correctly remain unmeasured until current-version classification and review are sufficient.
7. Check the dashboard's counts, dates, and states against sample source documents. Generate a brief with `npm run brief:daily --workspace @market-themes/workers`. Monitor failed/partial pipeline runs and exhausted classification attempts before increasing throughput.

If rollback is needed, stop the new writers and restore the prior app version. The added tables/columns are additive; do not drop review or job history to roll back application code. Restore the pre-migration backup into a separate database first if data recovery is needed, validate row counts and sample quotations, then deliberately switch the connection. A production restore drill remains outstanding.

## Deliberate follow-up work

- Human-labelled, held-out evaluation per narrative/source; quantify precision, recall, review burden, and time-to-detection. Synthetic regression fixtures are not evidence of model accuracy.
- Canonical article/revision and syndication identity, plus a verified publisher-ownership registry. Exact normalized-text deduplication is improved, but edited republications and legitimate revisions still require a richer policy.
- Provider-level coverage checkpoints and a validated weighting/baseline policy. Current comparisons conservatively require daily coverage; the one-point variance threshold is a guardrail, not an empirically calibrated significance test.
- All chart filter state in shareable URLs, review date/source facets and keyboard shortcuts, and a version history for multiple same-day brief editions.
- Bounded web connection pools, further domain separation of the large persistence module, removal of legacy runtime schema helpers, and profiling at representative scale.
- Per-run/day monetary budgets and aggregate cost reporting. Token usage is recorded for successful classifications; failed/retried provider costs are not fully accounted for.
- Current dependency-advisory scanning, real-host load/concurrency checks, a verified production restore drill, and live source/API checks.

Broader source coverage and a retrieval copilot should follow that evaluation work.
