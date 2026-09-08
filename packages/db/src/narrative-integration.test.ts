import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  getActiveNarrativeDefinitions,
  getNarrativeBoardStatus,
  getNarrativeReviewQueue,
  createPublicationFeed,
  listPublicationFeeds,
  persistDocuments,
  persistNarrativeObservations,
  recomputeNarrativeTrends,
  reviewNarrativeObservation,
  setPublicationFeedEnabled
} from "./index";

test(
  "persists, recomputes, and reloads an evidence-backed narrative",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const documentId = `integration:document:${suffix}`;
    const publishedAt = "2026-08-27T12:00:00.000Z";
    const body = `AI infrastructure demand is rising because capacity remains constrained. ${suffix}`;
    const persisted = await persistDocuments([
      {
        id: documentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Integration market report ${suffix}`,
        publisher: "Integration Publisher",
        publisherId: "integration-publisher",
        publisherOwner: "integration-owner",
        url: `https://example.com/integration/${suffix}`,
        publishedAt,
        tickers: ["TEST"],
        summary: "Integration fixture",
        body,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);
    assert.equal(persisted.insertedDocuments, 1);

    const definitions = await getActiveNarrativeDefinitions();
    const definition = definitions.find(
      (item) => item.slug === "ai-infrastructure-demand"
    );
    assert(definition);
    await persistNarrativeObservations([
      {
        id: `integration:observation:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId,
        matched: true,
        matchScore: 95,
        stance: "bullish",
        riskTone: 0,
        bullishTone: 85,
        evidenceSnippet:
          "AI infrastructure demand is rising because capacity remains constrained.",
        interpretation:
          "The source reports constrained capacity and rising demand.",
        affectedEntities: ["TEST"],
        model: "integration-fixture",
        promptVersion: "integration-v1",
        metadata: {
          textHash: createHash("sha256").update(body).digest("hex"),
          definitionVersion: definition.version
        }
      }
    ]);

    await recomputeNarrativeTrends({
      asOfDate: "2026-08-27",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: "integration-v1"
    });
    const pendingBoard = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    assert(
      pendingBoard.narratives.every(
        (item) =>
          !item.evidence.some(
            (evidence) => evidence.id === `integration:observation:${suffix}`
          )
      )
    );

    await reviewNarrativeObservation(
      {
        id: `integration:observation:${suffix}`,
        status: "approved",
        note: "Approved by integration contract."
      },
      process.env.DATABASE_URL
    );
    await persistNarrativeObservations([
      {
        id: `integration:observation:v2:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId,
        matched: true,
        matchScore: 96,
        stance: "bullish",
        riskTone: 0,
        bullishTone: 86,
        evidenceSnippet:
          "AI infrastructure demand is rising because capacity remains constrained.",
        interpretation:
          "The source reports constrained capacity and rising demand.",
        affectedEntities: ["TEST"],
        model: "integration-fixture",
        promptVersion: "integration-v2",
        metadata: {
          textHash: createHash("sha256").update(body).digest("hex"),
          definitionVersion: definition.version
        }
      }
    ]);
    const inheritedReview = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      "integration-v2",
      { status: "all" }
    );
    const inheritedItem = inheritedReview.items.find(
      (item) => item.id === `integration:observation:v2:${suffix}`
    );
    assert.equal(inheritedItem?.reviewStatus, "approved");
    assert.equal(
      inheritedItem?.reviewNote,
      "Approved by integration contract."
    );

    const recomputed = await recomputeNarrativeTrends({
      asOfDate: "2026-08-27",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: "integration-v1"
    });
    assert.equal(recomputed.definitionsProcessed, definitions.length);

    const board = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    const narrative = board.narratives.find(
      (item) => item.id === definition.id
    );
    assert(narrative);
    assert(narrative.matchedDocuments >= 1);
    assert(
      narrative.evidence.some(
        (item) => item.id === `integration:observation:${suffix}`
      )
    );
  }
);

test(
  "registers and disables a managed publication feed",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const created = await createPublicationFeed({
      name: `Integration Publication ${suffix}`,
      homepageUrl: `https://${suffix}.example.com/`,
      feedUrl: `https://${suffix}.example.com/feed`,
      platform: "rss",
      publisherOwner: "Integration Publisher",
      termsNotes: "Public integration fixture."
    });
    assert.equal(created.enabled, true);

    const enabled = await listPublicationFeeds(
      { enabledOnly: true },
      process.env.DATABASE_URL
    );
    assert(enabled.some((feed) => feed.id === created.id));

    await setPublicationFeedEnabled(
      created.id,
      false,
      process.env.DATABASE_URL
    );
    const afterDisable = await listPublicationFeeds(
      { enabledOnly: true },
      process.env.DATABASE_URL
    );
    assert.equal(
      afterDisable.some((feed) => feed.id === created.id),
      false
    );
  }
);

test(
  "document text failures roll back metadata and retry repairs the whole ingest",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { createDatabaseClient } = await import("./persistence");
    const client = createDatabaseClient();
    await client.connect();
    const id = `atomic:${randomUUID()}`;
    const document = {
      id,
      sourceId: "audit-atomic",
      sourceClass: "newspaper" as const,
      title: "Atomic fixture",
      publisher: "Audit",
      url: `https://example.com/${id}`,
      publishedAt: "2026-08-27T12:00:00Z",
      tickers: [],
      summary: "fixture",
      body: `Atomic text ${id}`,
      retrievalMethod: "api" as const
    };
    try {
      await client.query(
        `create function audit_fail_text() returns trigger language plpgsql as $$ begin if new.document_id like 'atomic:%' then raise exception 'injected text failure'; end if; return new; end $$`
      );
      await client.query(
        "create trigger audit_fail_text before insert on document_texts for each row execute function audit_fail_text()"
      );
      await assert.rejects(
        persistDocuments([document]),
        /injected text failure/
      );
      assert.equal(
        (await client.query("select 1 from documents where id = $1", [id]))
          .rowCount,
        0
      );
      await client.query("drop trigger audit_fail_text on document_texts");
      assert.equal((await persistDocuments([document])).insertedDocuments, 1);
      assert.equal(
        (
          await client.query(
            "select 1 from document_texts where document_id = $1",
            [id]
          )
        ).rowCount,
        1
      );
      assert.equal(
        (
          await client.query(
            "select 1 from document_chunks where document_id = $1",
            [id]
          )
        ).rowCount,
        1
      );
      assert.equal((await persistDocuments([document])).insertedDocuments, 0);
    } finally {
      await client.query(
        "drop trigger if exists audit_fail_text on document_texts"
      );
      await client.query("drop function if exists audit_fail_text()");
      await client.end();
    }
  }
);

test(
  "review provenance, changed quotations, classification leases and refresh queue",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { createDatabaseClient } = await import("./persistence");
    const { claimNarrativeClassification, failNarrativeClassification } =
      await import("./classification-jobs");
    const client = createDatabaseClient();
    await client.connect();
    const id = `reliability:${randomUUID()}`;
    const body = `Demand is rising. Capacity is constrained. ${id}`;
    const document = {
      id,
      sourceId: "audit-review",
      sourceClass: "newspaper" as const,
      title: "Review fixture",
      publisher: "Audit",
      url: `https://example.com/${id}`,
      publishedAt: "2026-08-27T12:00:00Z",
      tickers: [],
      summary: "fixture",
      body,
      retrievalMethod: "api" as const
    };
    try {
      await persistDocuments([document]);
      const definition = (await getActiveNarrativeDefinitions())[0];
      const analysisDocument = {
        ...document,
        text: body,
        textHash: createHash("sha256").update(body).digest("hex")
      };
      const model = "audit-model",
        promptVersion = `audit:${id}`;
      const lease = await claimNarrativeClassification(
        analysisDocument,
        model,
        promptVersion
      );
      assert(lease);
      assert.equal(
        await claimNarrativeClassification(
          analysisDocument,
          model,
          promptVersion
        ),
        null
      );
      const observation = {
        id: `obs:${id}`,
        narrativeDefinitionId: definition.id,
        documentId: id,
        matched: true,
        matchScore: 95,
        stance: "bullish" as const,
        riskTone: 0,
        bullishTone: 80,
        evidenceSnippet: "Demand is rising.",
        interpretation: "Demand evidence",
        affectedEntities: [],
        model,
        promptVersion,
        metadata: {
          textHash: analysisDocument.textHash,
          definitionVersion: definition.version
        }
      };
      await persistNarrativeObservations([observation], undefined, lease);
      await reviewNarrativeObservation({
        id: observation.id,
        status: "approved",
        note: "checked"
      });
      assert.equal(
        (
          await client.query(
            "select 1 from narrative_recompute_queue where narrative_definition_id = $1",
            [definition.id]
          )
        ).rowCount,
        1
      );
      await persistNarrativeObservations([
        { ...observation, evidenceSnippet: "Capacity is constrained." }
      ]);
      const changed = await client.query(
        "select review_status, review_note from narrative_observations where id = $1",
        [observation.id]
      );
      assert.equal(changed.rows[0].review_status, "pending");
      assert.equal(changed.rows[0].review_note, null);
      const events = await client.query(
        "select evidence_snippet, note from narrative_review_events where observation_id = $1",
        [observation.id]
      );
      assert.equal(events.rows[0].evidence_snippet, "Demand is rising.");
      assert.equal(events.rows[0].note, "checked");
      await assert.rejects(
        persistNarrativeObservations([observation], undefined, lease),
        /lease expired/
      );
      const failedLease = await claimNarrativeClassification(
        analysisDocument,
        model,
        `${promptVersion}:failure`
      );
      assert(failedLease);
      await failNarrativeClassification(
        failedLease,
        new Error("fixture failure")
      );
      assert.equal(
        await claimNarrativeClassification(
          analysisDocument,
          model,
          `${promptVersion}:failure`
        ),
        null
      );
    } finally {
      await client.end();
    }
  }
);

test(
  "evidence queries paginate the full dated corpus and briefs use stored measurements",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const {
      getNarrativeEvidence,
      generateDailyNarrativeBrief,
      getDailyBriefArchive
    } = await import("./index");
    const definition = (await getActiveNarrativeDefinitions())[0];
    const suffix = randomUUID();
    const previousVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION;
    const promptVersion = `evidence:${suffix}`;
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION = promptVersion;
    try {
      for (let i = 0; i < 27; i++) {
        const id = `evidence:${suffix}:${i}`,
          body = `Demand is rising. ${id}`;
        await persistDocuments([
          {
            id,
            sourceId: "audit-evidence",
            sourceClass: "newspaper",
            title: `Fixture ${i}`,
            publisher: "Evidence fixture",
            url: `https://example.com/${id}`,
            publishedAt:
              i < 26 ? "2026-08-27T12:00:00Z" : "2026-07-01T12:00:00Z",
            tickers: [],
            summary: "fixture",
            body,
            retrievalMethod: "api"
          }
        ]);
        const observation = {
          id: `obs:${id}`,
          narrativeDefinitionId: definition.id,
          documentId: id,
          matched: true,
          matchScore: 95,
          stance: "bullish" as const,
          riskTone: 0,
          bullishTone: 80,
          evidenceSnippet: "Demand is rising.",
          interpretation: "Source evidence",
          affectedEntities: [],
          model: "fixture",
          promptVersion,
          metadata: {
            textHash: createHash("sha256").update(body).digest("hex"),
            definitionVersion: definition.version
          }
        };
        await persistNarrativeObservations([observation]);
        await reviewNarrativeObservation({
          id: observation.id,
          status: "approved"
        });
      }
      const options = {
        id: definition.id,
        date: "2026-08-27",
        window: "7d" as const
      };
      const first = await getNarrativeEvidence(options),
        second = await getNarrativeEvidence({ ...options, page: 1 });
      assert.equal(first.items.length, 24);
      assert.equal(first.hasMore, true);
      assert.equal(second.items.length, 2);
      assert.equal(second.hasMore, false);
      assert.equal(
        new Set([...first.items, ...second.items].map((item) => item.id)).size,
        26
      );
      assert.equal(
        (await getNarrativeEvidence({ ...options, tone: "risk" })).items.length,
        0
      );
      assert.equal(
        (await getNarrativeEvidence({ ...options, source: "filing" })).items
          .length,
        0
      );
      assert.equal(
        (await getNarrativeEvidence({ ...options, date: "2026-07-01" })).items
          .length,
        1
      );
      await recomputeNarrativeTrends({
        asOfDate: "2026-08-27",
        lookbackDays: 10,
        promptVersion
      });
      const brief = await generateDailyNarrativeBrief();
      assert.match(brief.headline, /Coverage is not ready/);
      const archive = await getDailyBriefArchive();
      assert.equal(archive[0].measurementDate, "2026-08-27");
      assert.deepEqual(archive[0].evidence, []);
    } finally {
      if (previousVersion === undefined)
        delete process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION;
      else
        process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION = previousVersion;
    }
  }
);

test(
  "force-cancelling one backfill cannot cancel another or accept late results",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const {
      createDatabaseClient,
      createBackfillJob,
      requestBackfillStop,
      startDocumentAnalysisRun,
      completeDocumentAnalysisRun
    } = await import("./index");
    const client = createDatabaseClient();
    await client.connect();
    const suffix = randomUUID();
    try {
      const job = await createBackfillJob({ jobType: `cancel:${suffix}` });
      const otherJob = await createBackfillJob({ jobType: `other:${suffix}` });
      await client.query(
        "update backfill_jobs set status = 'running' where id = any($1::text[])",
        [[job.id, otherJob.id]]
      );
      const documentId = `cancel:${suffix}`;
      await persistDocuments([
        {
          id: documentId,
          sourceId: "cancel-test",
          sourceClass: "newspaper",
          title: "Cancellation fixture",
          publisher: "Audit",
          url: `https://example.com/${documentId}`,
          publishedAt: "2026-08-27T12:00:00Z",
          tickers: [],
          summary: "fixture",
          body: documentId,
          retrievalMethod: "api"
        }
      ]);
      const first = await startDocumentAnalysisRun(documentId, {
        analysisType: "test",
        model: "fixture",
        promptVersion: `first:${suffix}`,
        metadata: { backfillJobId: job.id }
      });
      const other = await startDocumentAnalysisRun(documentId, {
        analysisType: "test",
        model: "fixture",
        promptVersion: `other:${suffix}`,
        metadata: { backfillJobId: otherJob.id }
      });
      assert(first);
      assert(other);
      await requestBackfillStop({ jobId: job.id, jobType: `cancel:${suffix}` });
      await requestBackfillStop({ jobId: job.id, jobType: `cancel:${suffix}` });
      assert.equal(
        await startDocumentAnalysisRun(documentId, {
          analysisType: "test",
          model: "fixture",
          promptVersion: `after-stop:${suffix}`,
          metadata: { backfillJobId: job.id }
        }),
        null
      );
      assert.equal(
        (
          await client.query(
            "select status from document_analysis_runs where id = $1",
            [other.id]
          )
        ).rows[0].status,
        "running"
      );
      await assert.rejects(
        completeDocumentAnalysisRun(first, []),
        /no longer active/
      );
      assert.equal(
        (
          await client.query(
            "select status from document_analysis_runs where id = $1",
            [first.id]
          )
        ).rows[0].status,
        "failed"
      );
    } finally {
      await client.end();
    }
  }
);

test(
  "extraction retries reject stale completions and failures while preserving the current owner",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const {
      createDatabaseClient,
      startDocumentAnalysisRun,
      completeDocumentAnalysisRun,
      failDocumentAnalysisRun,
      recoverStaleDocumentAnalysisRuns
    } = await import("./index");
    const client = createDatabaseClient();
    await client.connect();
    const suffix = randomUUID();
    const documentId = `attempt:${suffix}`;
    const options = {
      analysisType: "test",
      model: "fixture",
      promptVersion: suffix
    };
    try {
      await persistDocuments([
        {
          id: documentId,
          sourceId: "attempt-test",
          sourceClass: "newspaper",
          title: "Attempt ownership fixture",
          publisher: "Audit",
          url: `https://example.com/${documentId}`,
          publishedAt: "2026-08-27T12:00:00Z",
          tickers: [],
          summary: "fixture",
          body: documentId,
          retrievalMethod: "api"
        }
      ]);
      const claims = await Promise.all([
        startDocumentAnalysisRun(documentId, options),
        startDocumentAnalysisRun(documentId, options)
      ]);
      assert.equal(
        claims.filter(Boolean).length,
        1,
        "only one worker may claim a document"
      );
      const first = claims.find((claim) => claim !== null)!;
      await client.query(
        "update document_analysis_runs set updated_at = now() - interval '2 hours' where id = $1",
        [first.id]
      );
      const recovered = await recoverStaleDocumentAnalysisRuns({
        ...options,
        staleAfterMinutes: 90
      });
      assert.deepEqual(recovered.documentIds, [documentId]);
      const retry = await startDocumentAnalysisRun(documentId, options);
      assert(retry);
      assert.equal(
        retry.id,
        first.id,
        "run history retains its stable identifier"
      );
      assert.notEqual(retry.attemptToken, first.attemptToken);
      const signal = {
        id: `attempt-signal:${suffix}`,
        documentId,
        themeId: `attempt-theme:${suffix}`,
        rawThemeLabel: "Attempt test",
        canonicalThemeLabel: "Attempt test",
        themeDescription: "Fixture",
        stance: "bullish" as const,
        riskTone: 0,
        bullishTone: 80,
        confidence: 90,
        evidenceSnippet: documentId,
        interpretation: "Fixture",
        affectedEntities: [],
        promptVersion: suffix,
        model: "fixture",
        scoreContribution: 1
      };
      await assert.rejects(
        completeDocumentAnalysisRun(first, [signal]),
        /no longer active/
      );
      await failDocumentAnalysisRun(first, new Error("late failure"));
      const active = await client.query(
        "select status, attempt_count, attempt_token, error_message from document_analysis_runs where id = $1",
        [retry.id]
      );
      assert.deepEqual(active.rows[0], {
        status: "running",
        attempt_count: 2,
        attempt_token: retry.attemptToken,
        error_message: null
      });
      assert.equal(
        (
          await client.query("select id from signals where id = $1", [
            signal.id
          ])
        ).rowCount,
        0
      );
      assert.equal(
        (
          await client.query("select id from themes where id = $1", [
            signal.themeId
          ])
        ).rowCount,
        0
      );
      // Even an owned attempt must roll back all writes if one signal belongs elsewhere.
      await assert.rejects(
        completeDocumentAnalysisRun(retry, [
          signal,
          { ...signal, id: `${signal.id}:wrong`, documentId: "wrong-document" }
        ]),
        /does not match/
      );
      assert.equal(
        (
          await client.query("select id from signals where id = $1", [
            signal.id
          ])
        ).rowCount,
        0
      );
      assert.equal(
        (
          await client.query("select id from themes where id = $1", [
            signal.themeId
          ])
        ).rowCount,
        0
      );
      assert.deepEqual(await completeDocumentAnalysisRun(retry, [signal]), {
        insertedSignals: 1,
        themesTouched: 1
      });
      await assert.rejects(
        completeDocumentAnalysisRun(retry, [signal]),
        /no longer active/
      );
      await failDocumentAnalysisRun(
        retry,
        new Error("failure after completion")
      );
      assert.equal(
        (
          await client.query(
            "select status from document_analysis_runs where id = $1",
            [retry.id]
          )
        ).rows[0].status,
        "completed"
      );
      assert.equal(await startDocumentAnalysisRun(documentId, options), null);
      const limitedOptions = {
        ...options,
        promptVersion: `${suffix}:limited`,
        maxAttempts: 1
      };
      const limited = await startDocumentAnalysisRun(
        documentId,
        limitedOptions
      );
      assert(limited);
      await failDocumentAnalysisRun(
        limited,
        new Error("retry budget exhausted")
      );
      assert.deepEqual(
        await Promise.all([
          startDocumentAnalysisRun(documentId, limitedOptions),
          startDocumentAnalysisRun(documentId, limitedOptions)
        ]),
        [null, null]
      );
      assert.equal(
        (
          await client.query(
            "select attempt_count from document_analysis_runs where id = $1",
            [limited.id]
          )
        ).rows[0].attempt_count,
        1
      );
    } finally {
      await client.end();
    }
  }
);

test(
  "connector-specific hashes do not inflate duplicate evidence",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const document = {
      id: `dedup:${suffix}`,
      sourceId: "audit-dedup",
      sourceClass: "newspaper" as const,
      title: "Daily market report",
      publisher: "Audit",
      url: `https://example.com/${suffix}`,
      publishedAt: "2026-08-27T12:00:00Z",
      tickers: [],
      summary: "fixture",
      body: `  Shared source text ${suffix}  `,
      contentHash: "connector-one:" + suffix,
      retrievalMethod: "api" as const
    };
    assert.equal((await persistDocuments([document])).insertedDocuments, 1);
    assert.equal(
      (
        await persistDocuments([
          {
            ...document,
            id: `${document.id}:other`,
            body: document.body.trim(),
            contentHash: "connector-two:" + suffix
          }
        ])
      ).insertedDocuments,
      0
    );
    // A repeated title with materially different text must remain eligible.
    assert.equal(
      (
        await persistDocuments([
          { ...document, body: document.body + "Material revision." }
        ])
      ).insertedDocuments,
      1
    );
  }
);

test(
  "database dates follow UTC independently of the host timezone",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { createDatabaseClient } = await import("./persistence");
    const client = createDatabaseClient();
    await client.connect();
    try {
      const result = await client.query(
        "select ('2026-09-07T00:00:00Z'::timestamptz)::date::text as date"
      );
      assert.equal(result.rows[0].date, "2026-09-07");
    } finally {
      await client.end();
    }
  }
);

test(
  "pipelines reject overlap, recover expired heartbeats, and retain partial outcomes",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { createDatabaseClient, startPipelineRun, finishPipelineRun } =
      await import("./index");
    const client = createDatabaseClient();
    await client.connect();
    const stage = `lease-test:${randomUUID()}`;
    try {
      const first = await startPipelineRun(stage);
      await assert.rejects(startPipelineRun(stage), /already running/);
      assert.equal(
        (
          await client.query("select status from pipeline_runs where id = $1", [
            first
          ])
        ).rows[0].status,
        "running"
      );
      await client.query(
        "update pipeline_runs set heartbeat_at = now() - interval '10 minutes' where id = $1",
        [first]
      );
      const second = await startPipelineRun(stage);
      assert.equal(
        (
          await client.query("select status from pipeline_runs where id = $1", [
            first
          ])
        ).rows[0].status,
        "failed"
      );
      await finishPipelineRun(second, {
        status: "partial",
        failedCount: 1,
        processedCount: 2
      });
      const result = (
        await client.query(
          "select status, failed_count from pipeline_runs where id = $1",
          [second]
        )
      ).rows[0];
      assert.equal(result.status, "partial");
      assert.equal(result.failed_count, 1);
    } finally {
      await client.end();
    }
  }
);
