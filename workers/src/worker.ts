import { defaultConnectors } from "@market-themes/ingest";
import { claimNextBackfillJob } from "@market-themes/db";
import { runClaimedClaudeBackfillJob } from "./jobs/claude-extract-backfill";

console.log("Market Themes worker started.");
console.log(
  `Registered connectors: ${defaultConnectors
    .map((connector) => connector.id)
    .join(", ")}`
);

const workerId = `worker:${process.pid}:${Date.now()}`;
const backfillPollIntervalMs = Number(
  process.env.BACKFILL_WORKER_POLL_INTERVAL_MS ?? 45_000
);
let isProcessingBackfill = false;

async function pollBackfillJobs() {
  if (isProcessingBackfill || !process.env.DATABASE_URL) {
    return;
  }

  isProcessingBackfill = true;

  try {
    const job = await claimNextBackfillJob(workerId);

    if (!job) {
      return;
    }

    console.log(`[worker] claimed backfill job=${job.id} status=${job.status}`);
    await runClaimedClaudeBackfillJob(job);
    console.log(`[worker] finished backfill job=${job.id}`);
  } catch (error) {
    console.error(
      `[worker] backfill poll failed: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    isProcessingBackfill = false;
  }
}

void pollBackfillJobs();

setInterval(() => {
  void pollBackfillJobs();
}, backfillPollIntervalMs);

setInterval(() => {
  console.log("Worker heartbeat", new Date().toISOString());
}, 60_000);
