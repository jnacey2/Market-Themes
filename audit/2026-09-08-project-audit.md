# Market Themes — project audit

Reviewed September 8, 2026 · Historical repository revision `add5f5f`

Implementation followed this audit. See [the implementation and rollout notes](implementation-notes.md) for current status. Findings and line numbers below describe the original revision.

## Assessment

Market Themes has a coherent research purpose and substantially more infrastructure than a mock dashboard. The strongest choices are explicit narrative propositions, versioned observations, source quotations, a human approval gate, and database-backed operations. I would keep the Next.js/npm-workspace/Postgres architecture.

I would prioritize measurement integrity and dependable ingestion before expanding the source universe, building a copilot, or redesigning the interface. Several current behaviors can produce confident-looking changes that actually reflect incomplete processing. The homepage and narrative board also use different measurement systems, so the product does not yet offer one consistent account of what is happening.

This is a code and local-behavior audit, not a judgment about actual historical investment performance. No production database, licensed publisher sessions, or paid model calls were used.

## Verification and limits

- Production build, TypeScript checks, and lint passed.
- Existing tests: 18 total, 16 passed, 2 database integration tests skipped. No local database was configured; Docker was installed but its daemon was not running.
- Reproduced the backfill concurrency race, coverage-induced false movement, missing model-output observations becoming negatives, blank publisher owners, and incomplete Substack backfill with local synthetic inputs.
- Viewed the production-built homepage and narrative board locally. Verified horizontal overflow at a 390px mobile viewport: document width 494px, navigation width approximately 470px.
- Populated UI behavior was traced through source; it was not exercised against production data. The real model's accuracy, live API availability, production authentication configuration, database query latency, restore procedures, and current dependency advisories remain unverified.
- Local checks ran on the available Node 23.10.0 runtime. The repository requests Node 22; CI specifies Node 20.

## Highest-priority findings

### 1. Incomplete coverage becomes a measured narrative decline

**High priority · Reproduced · Medium effort**

[narrative-metrics.ts:103](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narrative-metrics.ts:103) assigns an empty day density zero. [The window average:139](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narrative-metrics.ts:139) includes it, while the coverage gate only requires some documents anywhere in the window.

In a synthetic 60-day series with a constant 50% match rate, removing the final three days of observations changed the last seven-day density from **50 to 28.57**, movement from **0 to −21.43**, and z-score from **0 to −2142.86**. The result still had `lowHistory=false`.

An ingestion outage, classification lag, or incomplete current day can therefore look like a market event. Changing the set of available source classes can also change the average even when each remaining class is stable.

**Change:** Represent missing measurement separately from a measured zero. Track expected/observed source coverage, classification completeness, and covered days. Suppress movement when adjacent windows are not comparable; do not merely remove empty days without defining the intended weighting. Use a defensible minimum-variance/support rule rather than interpreting division by a 0.01 floor as statistical precision.

**Acceptance:** Source outages and partial current days show an incomplete measurement state; a fully observed zero-match window remains a valid decline. Add stable-source-composition and sparse-history fixtures.

### 2. Missing classifier output is silently recorded as a negative result

**High priority · Reproduced · Small–medium effort**

[narrative-classification.ts:110](/Users/joshnacey/Desktop/Projects/Themes/packages/analysis/src/narrative-classification.ts:110) accepts a JSON object without an observations array, defaults to an empty array, and creates a false observation for every definition. Missing IDs in an otherwise valid response behave similarly; duplicate IDs overwrite each other in the map.

A mocked model response of `{}` produced a complete-looking `matched=false` observation. [Document selection:74](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narratives.ts:74) then treats persisted observations as completed work, so the document is not retried for those definitions/version/model. This contaminates the denominator and hides failed analysis.

**Change:** Validate the response schema, expected definition IDs, exact cardinality, duplicates, field types, and completion/stop reason before persistence. Missing or malformed output should be failed or incomplete, never an inferred non-match. Provider structured output can help with shape, but application validation must still enforce completeness and evidence rules. [Anthropic documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

**Acceptance:** Missing, duplicate, unknown, malformed, and truncated observations cause explicit retryable failures; a valid negative remains accepted.

### 3. The backfill concurrency helper can read past the batch

**High priority · Reproduced · Small effort**

[claude-extract-backfill.ts:279](/Users/joshnacey/Desktop/Projects/Themes/workers/src/jobs/claude-extract-backfill.ts:279) checks the shared index, awaits the stop check, and then increments without rechecking. Another worker can consume the final item during that await.

Running the actual helper with three items and concurrency two invoked the worker with **1, 2, 3, undefined**. The real `analyzeDocument` immediately accesses `document.id`, so this can reject the whole batch after useful work has completed.

**Change:** Recheck bounds after the await and reserve the index synchronously. Add an uneven-batch regression with delayed stop checks and an exactly-once assertion.

### 4. Document persistence can leave an unrecoverable partial ingest

**High priority · Confirmed code path; database fault injection pending · Medium effort**

[persistence.ts:233](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/persistence.ts:233) inserts document metadata, then text, then chunks as separate commits. If text insertion fails after metadata succeeds, retry sees the existing content hash and skips the document. The normal narrative selector requires `document_texts`, so the document can remain permanently excluded. Reconstructing text from chunks cannot help when neither text nor chunks was saved.

**Change:** Commit each document and its required text/chunks atomically, or use an explicit incomplete-ingest state with a repairable upsert. Preserve per-document progress so one bad item does not discard an entire connector poll.

**Acceptance:** Inject failure between metadata and text; retry produces one complete document and a complete chunk set.

### 5. Pipeline success can conceal a completely failed stage

**High priority · Confirmed code path · Medium effort**

[classify-narratives.ts:48](/Users/joshnacey/Desktop/Projects/Themes/workers/src/jobs/classify-narratives.ts:48) logs per-document errors, returns failure counts, and exits normally. [poll-sources.ts:60](/Users/joshnacey/Desktop/Projects/Themes/workers/src/jobs/poll-sources.ts:60) similarly absorbs connector failures. The parent pipeline only checks child exit codes, so it can mark a run completed even when every document failed. Some FMP news failures are converted to empty results before connector status is recorded.

Narrative classification also lacks persisted attempts, leases, retry scheduling, or quarantine. The newest failed documents can be selected repeatedly and prevent progress on older history. The deployed classification configuration attempts at most **40 documents per run**, six scheduled runs per day: **240 daily attempts**, before failures or long-running jobs. This is a configured ceiling, not measured throughput.

**Change:** Return structured stage outcomes with completed/partial/failed states, fail all-failure stages, and persist classification attempts and retry eligibility. Expose classification backlog and oldest unprocessed publication date. Select backfill and current-document work deliberately.

**Acceptance:** All-document failure cannot produce a green pipeline; one permanently failing document does not starve the backlog.

### 6. Review timing changes the historical signal

**High priority · Confirmed measurement semantics · Medium effort**

[narratives.ts:409](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narratives.ts:409) counts only approved positives as matches, but pending positives still count as eligible documents. Two identical source corpora with different review completion rates consequently produce different densities. A historical window reviewed thoroughly and a recent window awaiting review will tend to show artificial fading.

The [review API](/Users/joshnacey/Desktop/Projects/Themes/apps/web/app/api/narrative-observations/review/route.ts:25) updates observations without scheduling recomputation. Evidence reads reflect approval immediately; metrics can remain on the previous review state until the next pipeline run.

**Change:** Make review completeness part of the measurement contract. Either label the statistic explicitly as approved-evidence density and gate comparability by review coverage, or maintain distinct classifier estimates and reviewed estimates. Queue affected trend recomputation after review, and expose a measurement timestamp/version so cards and evidence share the same snapshot.

**Acceptance:** Clearing a review backlog is visibly distinguished from newly published evidence; review and metric states cannot silently disagree.

### 7. Feed network validation does not cover redirects or the actual connection

**High priority for a deployed collector · Confirmed code path; no network exploit attempted · Medium effort**

[registered-feed.ts:29](/Users/joshnacey/Desktop/Projects/Themes/packages/ingest/src/registered-feed.ts:29) validates DNS before [RSS fetch:44](/Users/joshnacey/Desktop/Projects/Themes/packages/ingest/src/rss.ts:44), but fetch follows redirects and resolves independently. [Substack fetch](/Users/joshnacey/Desktop/Projects/Themes/packages/ingest/src/substack.ts:174) also permits automatic redirects. An approved public feed can redirect to an internal endpoint; the initial public-IP check does not validate that destination. Registration requires operator access, which narrows the exposure, but an external feed still controls redirects.

**Change:** Use a shared outbound fetch policy that disables automatic redirects, validates each permitted hop, binds requests to validated addresses, handles IPv4/IPv6 comprehensively, and limits response size and duration. RSS currently has no explicit request timeout or body-size cap. This follows [OWASP's SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

## Important follow-up fixes

### 8. The homepage can call an emerging theme “confirmed”

**Medium priority · Confirmed code path · Small effort**

[HomePage](/Users/joshnacey/Desktop/Projects/Themes/apps/web/app/page.tsx:11) combines confirmed and emerging themes, then passes that combined list to [buildDashboardBrief:243](/Users/joshnacey/Desktop/Projects/Themes/apps/web/app/page.tsx:243). With no confirmed seven-day theme, an emerging theme can become “the top confirmed live theme.” A thirty-day fallback can also be described as leading the seven-day digest.

Pass explicit confirmation status and window into the summary. Distinguish emerging, confirmed, low-history, missing, and stale data. The legacy dashboard catches some query errors and substitutes an empty dashboard, so operational failure should also be distinct from a healthy empty state.

### 9. Historical Substack backfill stops at the first page budget

**Medium priority · Reproduced · Medium effort**

[substack.ts:58](/Users/joshnacey/Desktop/Projects/Themes/packages/ingest/src/substack.ts:58) starts every poll at offset zero. After the first bounded poll, the saved newest publication date reduces future lookback to a recent interval. There is no separate historical cursor.

With 24 daily public posts, a 30-day lookback, and a 12-post limit, the first poll returned 12, the second returned one already-seen post, and only 12 unique posts were ever covered by those polls. Older posts are outside subsequent lookback despite the requested history. Persist a historical pagination cursor/completion state independently of the live high-water mark, and retain retries for failed individual posts.

The managed RSS adapter also omits the configured `maxPostsPerPoll` and `rateLimitMs` from its connector configuration; those UI settings currently do not govern RSS polling.

### 10. Explorer filters imply more than they do

**Medium priority · Confirmed code path · Medium effort**

[NarrativeExplorer.tsx:13](/Users/joshnacey/Desktop/Projects/Themes/apps/web/components/narratives/NarrativeExplorer.tsx:13) changes the number of displayed history points for 7/30/90 days; all points remain seven-day rolling measurements. Source/tone selections filter evidence only, despite being labeled narrative chart filters. Selecting a date never filters citations. [Evidence loading](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narratives.ts:575) fetches the latest 12 approved observations without a date constraint, so past-date investigation cannot retrieve the relevant historical evidence.

Separate “measurement window” from “history shown.” Label evidence-only filters clearly or apply them to the chart. Query evidence for the selected interval with pagination, show match totals, and add axis labels, density units, and a legend. Historical points need their own coverage/low-history flags; the current UI applies today's flag to all hovered dates.

### 11. Long documents are treated as fully classified after only their opening text is read

**Medium priority · Confirmed code path · Medium effort**

[narrative-classification.ts:40](/Users/joshnacey/Desktop/Projects/Themes/packages/analysis/src/narrative-classification.ts:40) discards everything after 120,000 characters. Unlike legacy extraction, it does not split oversized documents. Evidence late in a filing can become a permanent non-match for that run identity.

Process sections with a document-level aggregation rule, or persist partial coverage explicitly and exclude incomplete negatives from complete-corpus claims. Preserve text hash, examined ranges, prompt/model identity, and truncation status.

### 12. Reclassification can retain approval for changed evidence

**Medium priority · Confirmed SQL logic; database reproduction pending · Small–medium effort**

Cross-version review inheritance correctly checks for the same quote. However, the [same-version conflict update:147](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/narratives.ts:147) replaces the quote while preserving any existing approved/rejected status. Reclassification after a partially persisted batch or concurrent selection can therefore publish a changed quote under the old approval.

Tie approval to the reviewed content/definition hash and reset to pending whenever the reviewed material changes. Make one document's observation set atomic. Keep explicit review history instead of overwriting the only note and timestamp.

### 13. Cancellation, restart, and timeout handling need one consistent contract

**Medium priority · Confirmed code paths · Medium effort**

- [Stop handling:573](/Users/joshnacey/Desktop/Projects/Themes/packages/db/src/persistence.ts:573) turns a second stop request into `cancelled`, but [the worker:58](/Users/joshnacey/Desktop/Projects/Themes/workers/src/jobs/claude-extract-backfill.ts:58) only stops for `stop_requested` or a missing job. A still-running worker can continue picking documents after forced cancellation.
- The cancellation cleanup condition includes `or metadata ? 'backfillJobId'`, which matches any run with that key, not just the requested job. Current extraction writes that key even when its value is null.
- The job claim selects only queued jobs. A worker crash leaves a running job occupying the unique active-job slot without automatic lease recovery.
- `Promise.race` implements the extraction timeout but does not cancel the underlying model request or later section/retry work.

Use terminal-state checks, expiring worker leases, ownership-scoped transitions, and an AbortSignal propagated through every request/retry. Test cancel during processing, repeated stop, worker death, and timeout while a section request is active.

### 14. Independence and deduplication need better identity handling

**Medium priority · Mixed reproduced/code findings · Medium effort**

The publication form sends an empty string for an omitted owner. [Normalization:47](/Users/joshnacey/Desktop/Projects/Themes/packages/ingest/src/publication-feed.ts:47) uses nullish fallback, so the owner stays empty; the metric later filters it out. This was reproduced. Use trimmed-empty fallback to publisher identity and repair existing empty values.

FMP news currently assigns publisher owner from publisher name, so ownership breadth is only as accurate as that assumption. Canonical URLs are indexed but not checked by ingestion deduplication; content hashes are not consistently constructed across connectors. Title-only near-duplicate matching within 72 hours can discard revised articles or distinct similarly titled material. Deduplication should preserve document provenance, distinguish revisions from syndication, and use consistent canonical/content identities.

### 15. Other scoring behavior deserves an explicit statistical contract

**Medium priority · Reproduced/code findings · Medium effort**

A fully covered window with zero matches is forced to z-score zero by the `hasMatch` gate, even after a high historical baseline. This suppresses the unusualness of a real disappearance. A constant positive series is assigned the 100th percentile because all ties count as below-or-equal; that is a possible empirical-CDF convention, but the UI should not frame it as unusual. Neutral-tone days are dropped from window tone averages by filtering values greater than zero.

Specify tie handling, sparse-history support, genuine-zero behavior, source/day weighting, and tone denominators. Adjacent rolling windows overlap heavily; “30 baseline values” does not mean 30 independent observations. Evaluate promotion rules on a labeled corpus rather than relying on a threshold and model self-reported confidence alone.

## Product and design critique

**Make the narrative board the main research surface.** The homepage reads legacy extracted-theme trends; `/trends` and storyboards read curated narrative observations. The legacy aggregation also mixes stored signal prompt versions, so re-extraction can change intensity without new source documents. Choose curated narratives as the primary measurement contract and keep exploratory extracted themes clearly labeled in a separate discovery area.

**Use the top of the screen for decisions.** The current desktop hero and summary cards consume almost the entire first screen before ranked evidence. For repeat use, replace most promotional copy with a compact “changed since last visit” view: narrative, change in percentage points, comparable coverage, independent publisher groups, freshness, and one representative quote. Keep an explanation of the methodology accessible without dominating every visit.

**Report observed coverage.** The homepage prominently labels coverage “S&P 500 + Nasdaq-100,” but the checked-in default seed contains 52 tickers and deployments can override it further. Label the target universe separately from actual recent company/source coverage. A useful status strip would show ingested, classified, pending review, approved, measured-through date, and stale/partial status.

**Fix mobile navigation.** The 390px preview overflowed to 494px because `.nav-links` does not wrap or collapse. The breakpoint changes the parent navigation direction only. Introduce a compact menu or deliberate wrapping and verify 320/390/768px plus keyboard navigation.

**Clarify chart semantics and interaction.** Add units and a visible legend; expose the selected interval and data quality. Use one keyboard-navigable chart control or a date picker rather than making all 90 points separate tab stops. Preserve filter state in the URL for bookmarking. Tone filters should include mixed/neutral if they are meant to cover all evidence.

**Make review sustainable.** The current review queue loads at most 100 items, with no pagination/filter/search. Add narrative/source/date filters, progress, direct source context, keyboard shortcuts, and an audit trail. Avoid bulk approval before an evaluation set establishes which cases are safe.

**Deliver a real brief before a copilot.** The scheduled daily-brief job only prints the imported mock brief. The homepage brief is a deterministic summary of the lead theme. A useful next version would persist a dated, cited digest of changes, caveats, and research questions with an archive. The copilot is visibly a preview; move it out of primary navigation until it performs a useful task.

## Architecture and operational improvements

- Keep the monorepo and Postgres. The current scope does not justify microservices or an additional queue service merely for architectural tidiness.
- Split the 3,229-line persistence module by domain: ingestion, extraction jobs, normalization, trends, and dashboard reads. Keep scoring functions pure and independently testable.
- Reuse bounded database pools for web reads. Narrative detail currently loads the whole board: two sequential queries per active definition, plus definitions/latest-date queries. With ten definitions, that is 22 queries to build the board even when viewing one narrative.
- Batch trend upserts. The default ten-definition, 365-day, two-window recompute issues 7,300 sequential row writes in one transaction. Group observations by date once, reuse rolling aggregates, and insert in batches. Actual latency and memory impact require profiling with representative data.
- Centralize validated environment configuration and prompt versions. Align Node 22 across CI/deployment/local guidance; use `npm ci` for deployment reproducibility and deliberate dependency updates instead of unspecified `latest` ranges.
- Consolidate overlapping poll schedules: FMP news is included in the half-hour source poll and also has its own six-hour cron. Measure request volume and useful documents before setting cadence.
- Record model token usage, retry counts, elapsed time, and budget consumption. The pipeline cost field exists but the normal pipeline does not populate it. Add a bounded per-run/day budget before increasing classification throughput.
- Make private/public access an explicit product decision. Operational routes fail closed in production without credentials, which is good; `/`, `/trends`, theme details, and storyboards are public in the application routing. If this is strictly personal research, protect those reading surfaces too. Actual hosting exposure was not inspected.
- Review database TLS settings: certificate verification is disabled when the connection string contains `render.com`. Prefer verified certificates and parsed hostname/configuration rules. Return a generic public health failure while logging detailed database errors internally.
- Use migration history for all schema changes, including remaining runtime table-creation helpers. Add a documented backup/restore drill and test migrations from an existing database, not only a fresh schema.

## Suggested sequence

**First: make results trustworthy.** Fix the concurrency race and strict classifier validation; make document ingestion atomic; represent missing coverage and review completeness; propagate partial/failed stage outcomes; harden outbound feed requests. Add the targeted regressions listed above.

**Next: make the daily workflow coherent.** Consolidate around curated narratives, correct confirmation and freshness language, connect selected dates to paginated evidence, implement reliable historical feed progress, repair cancellation/recovery, and fix mobile navigation.

**Then: evaluate and scale.** Build a small stratified, human-labeled corpus covering positives, hard negatives, contradictions, late-document evidence, source outages, syndication, and publication revisions. Track precision/recall per narrative and source, review burden, and time-to-detection. Freeze evaluation examples separately from prompt-tuning examples. Include publication, ingestion, classification, review, and measurement timestamps so retrospective evaluation distinguishes what was knowable at the time from later backfills.

**Only after that:** expand the equity universe/source catalog, tune query costs, and build a cited daily-brief archive. A copilot should follow reliable retrieval, provenance, and evaluation rather than precede them.

The release criterion should be that each ranking can be explained through a consistent observation window, adequate comparable coverage, review state, and accessible source evidence—and that failed processing cannot silently look like a measured market change.
