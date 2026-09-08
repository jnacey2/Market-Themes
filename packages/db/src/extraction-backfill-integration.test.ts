import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  claimNextBackfillJob,
  createBackfillJob,
  createDatabaseClient,
  persistDocuments,
  requestBackfillStop,
  startDocumentAnalysisRun
} from "./index";

test(
  "cancelling a stuck UI backfill does not fail an unrelated cron run",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanup(suffix));
    const jobType = `extraction-cancel:${suffix}`;
    const job = await createBackfillJob({
      jobType,
      batchSize: 10,
      maxBatches: 10,
      concurrency: 2,
      model: `model:${suffix}`,
      promptVersion: `prompt:${suffix}`
    });
    const claimed = await claimNextBackfillJob(
      `worker:${suffix}`,
      jobType
    );
    assert.equal(claimed?.status, "running");

    const targetDocumentId = `extraction-cancel-target:${suffix}`;
    const cronDocumentId = `extraction-cancel-cron:${suffix}`;
    for (const documentId of [targetDocumentId, cronDocumentId]) {
      const persisted = await persistDocuments([
        {
          id: documentId,
          sourceId: `extraction-cancel-source:${suffix}`,
          sourceClass: "newspaper",
          title: `Extraction cancellation fixture ${documentId}`,
          publisher: "Integration Publisher",
          url: `https://example.com/${documentId}`,
          publishedAt: new Date().toISOString(),
          tickers: [],
          summary: "",
          body: `Integration extraction content ${documentId}`,
          retrievalMethod: "api",
          retentionPolicy: "full_text"
        }
      ]);
      assert.equal(persisted.insertedDocuments, 1);
    }
    await startDocumentAnalysisRun(targetDocumentId, {
      analysisType: "market_signal_extraction",
      model: `model:${suffix}`,
      promptVersion: `prompt:${suffix}`,
      metadata: { backfillJobId: job.id }
    });
    await startDocumentAnalysisRun(cronDocumentId, {
      analysisType: "market_signal_extraction",
      model: `model:${suffix}`,
      promptVersion: `prompt:${suffix}`,
      metadata: { backfillJobId: null }
    });

    const stopRequested = await requestBackfillStop({ jobId: job.id, jobType });
    assert.equal(stopRequested?.status, "stop_requested");
    const cancelled = await requestBackfillStop({ jobId: job.id, jobType });
    assert.equal(cancelled?.status, "cancelled");

    const client = createDatabaseClient();
    await client.connect();
    try {
      const runs = await client.query<{
        document_id: string;
        status: string;
      }>(
        `select document_id, status
         from document_analysis_runs
         where document_id = any($1::text[])`,
        [[targetDocumentId, cronDocumentId]]
      );
      assert.equal(
        runs.rows.find((row) => row.document_id === targetDocumentId)?.status,
        "failed"
      );
      assert.equal(
        runs.rows.find((row) => row.document_id === cronDocumentId)?.status,
        "running"
      );
    } finally {
      await client.end();
    }
  }
);

async function cleanup(suffix: string) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(`delete from backfill_jobs where job_type = $1`, [
      `extraction-cancel:${suffix}`
    ]);
    await client.query(`delete from documents where id like $1`, [`%${suffix}`]);
    await client.query(`delete from sources where id = $1`, [
      `extraction-cancel-source:${suffix}`
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
