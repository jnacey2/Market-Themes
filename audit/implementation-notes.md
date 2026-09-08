# Audit integration — September 2026

This branch reconciles the audit implementation with main at `893a4ee`. The original audit evaluated `add5f5f`; its findings and line numbers are historical. The earlier audit commit `008f237` is preserved in Git history. Use these integration notes for the final behavior and deployment requirements.

## Integration decisions

Main had advanced by 82 commits. Its structural-theme dashboard, narrative lifecycle states, automatic review and promotion, candidate discovery, provider batches, authenticated Substack collection, scheduled jobs, and indexed query improvements remain in place. The merge does not reinstate the older homepage, v6 classifier, or `reviewed_density_v2` scoring policy.

- **Classification:** retain main's sparse v7 output contract, structured-output schema, evidence guards, caching, and batch execution. Add local validation for malformed fields, unknown/duplicate definitions, out-of-range scores, and quotations absent from the source. Observations now include the source-text fingerprint alongside the definition version.
- **Ingestion:** document metadata, retained text, and chunks commit atomically, including authenticated preview upgrades. Retries repair incomplete retained text/chunks. Normalize text fingerprints across connectors, retain substantive same-title revisions, and repair blank publisher owners. Preserve main's publisher-ownership rules and wire-story detection.
- **Extraction recovery:** new attempts receive unique ownership tokens while stable run IDs preserve history and section references. Claims serialize both uniqueness checks, honor retry limits, reject active/completed runs, and reject stopped backfills. Direct workers and persisted provider-batch sections carry ownership through completion/failure; late results cannot overwrite a retry. Existing tokenless discovery/batch records remain usable only while the stored run is still tokenless. Inconsistent signal/document IDs roll back all writes.
- **Worker recovery:** preserve main's workload locks and exclusion of active provider batches from stale recovery. Recheck the shared work index after asynchronous stop checks. Keep abortable provider timeouts, add claimed-job heartbeats and terminal-state guards, and recover abandoned worker jobs. Recorded jobs retain failed/partial outcomes; full pipelines retain partial stages and command-line failures return nonzero status. Pipeline heartbeats distinguish live work from abandoned runs.
- **Feeds:** validate and pin public DNS addresses for each HTTPS request and redirect, bound response size/duration, and reject private/special addresses. Licensed Substack cookies stay within their original origin. Preserve main's authenticated retrieval, retries, cached preview upgrades, and scraper. Registered feed history has its own persisted cursor; a new-publication watermark cannot cut off historical ingestion. Checkpoints advance only after persistence succeeds. RSS polling honors configured limits.
- **Review:** preserve main's append-only event schema, automatic-review policy, and human decisions on reclassification when source/definition fingerprints are unchanged. Changed fingerprints prevent inherited approval and reopen the observation. Add status/search filters, stable pagination, and preservation of an omitted review note. Legacy observations without fingerprints remain compatible; they are not retroactively assigned verified provenance.
- **Research interface:** retain main's navigation, storyboard/data views, lifecycle metrics, and scoring. Evidence filters query the stored corpus for the selected date/window instead of filtering a small preview. Requests cancel when selection changes; pagination exposes the remaining evidence. Charts retain raw attention, distinguish unavailable reviewed measurements with gaps, label dates/percentages, and provide a keyboard date slider. Historical readouts use the selected day's coverage. The brief archive reads main's existing persisted daily brief format; there is no competing brief writer or schema.
- **Operations:** research reads require operational credentials by default; `RESEARCH_PUBLIC_READS=true` deliberately exposes research pages while operational routes stay protected. Health checks remain available. Database connections explicitly use UTC. Main's configurable TLS/CA handling remains available; Render host detection now parses the hostname instead of matching arbitrary URL text.

## Changes superseded by current main

The earlier all-days/equal-source-weight scoring policy, v6 whole-document sectioning, separate classification lease table, 45-second recompute queue, and separate cited brief format were not layered over their newer counterparts. Main's current coverage thresholds, source weighting, baseline floors, v7 input limits, batch retry accounting, scheduled recomputation, and stored brief sections are retained. This avoids two competing definitions of the same measurements and workflows.

In particular, full-tail classification coverage beyond main's configured document-length limit and retry/cost accounting for synchronous classification still require follow-up. The final branch must not be described as having carried over every behavior of the earlier audit commit. Synthetic tests do not establish model accuracy, publisher-level ingestion completeness, or calibrated financial significance.

## Validation

- Exact dependencies installed from main's lockfile on Node 22.23.2; the install reported zero known vulnerabilities at verification time.
- Fresh PostgreSQL 16.15 / pgvector 0.8.6 migrations and migration replay checked through 029.
- A separate database populated through main's migration 026 upgraded through 027–029 without changing its existing review-event rows, extraction run fields, or section references. A stale tokenless run then acquired a new attempt and completed.
- All 278 tests passed with no failures or skips against PostgreSQL; type checking, lint, and the production build passed.
- Production browser checks passed for authentication, dated evidence, source filtering, keyboard date selection, and review pagination. Dashboard, trends, data, review, and brief pages had no horizontal overflow at 1440, 768, 390, or 320 pixels and no browser errors. Chart tooltip text and filter labels were corrected during this check.
- No paid model requests, production database changes, or deployment were performed.

## Rollout after review

1. Take a production backup and verify restoration to a separate database. Keep the previous deployment available. Pause workers and scheduled writers, and wait for old extraction processes to exit.
2. Apply migrations **027, 028, and 029** using the existing migration runner. These follow main's migrations through 026. The never-deployed audit migrations named 007–009 were removed; do not apply the old audit schema to current main.
3. Preserve the current v7 classifier and existing source/auto-review/batch configuration. Confirm `OPS_USERNAME` and `OPS_PASSWORD`; research reads default to private. Keep the existing TLS mode/CA configuration; use `DB_SSL_MODE=verify-full` with a trusted `DB_SSL_CA` when required by the database certificate chain.
4. Deploy/restart the web app, worker, and schedules together. Verify health, authenticated research reads, evidence filters, and batch reconciliation before increasing throughput. Existing provider-batch records are compatible; only newer submissions carry the added extraction token metadata.
5. Review actual source evidence and job outcomes, then allow the existing recomputation and brief schedules to refresh research views.

Rollback: stop new writers and restore the prior application version. The new columns/index are additive; retain review and batch history. Do not drop the added columns during an application rollback. If data recovery is needed, restore into a separate database and validate it before switching connections. Production load and restore drills remain outstanding.
