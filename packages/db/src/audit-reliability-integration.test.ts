import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { createDatabaseClient, persistDocuments as persist } from "./index";
const fixtureIds: string[] = [];
const fixtureJobs: string[] = [];
async function persistDocuments(documents: Parameters<typeof persist>[0]) {
  fixtureIds.push(...documents.map((document) => document.id));
  return persist(documents);
}
after(async () => {
  if (!process.env.DATABASE_URL || !fixtureIds.length) return;
  const client = createDatabaseClient();
  await client.connect();
  try {
    const patterns = fixtureIds.map((id) => `${id}%`);
    await client.query(
      "delete from signals where document_id like any($1::text[])",
      [patterns]
    );
    await client.query("delete from documents where id like any($1::text[])", [
      patterns
    ]);
    await client.query("delete from backfill_jobs where id = any($1::text[])", [
      fixtureJobs
    ]);
  } finally {
    await client.end();
  }
});

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
      fixtureJobs.push(job.id, otherJob.id);
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
