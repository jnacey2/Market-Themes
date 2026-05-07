import { NextResponse } from "next/server";
import {
  createBackfillJob,
  getBackfillControlStatus
} from "@market-themes/db";

export const dynamic = "force-dynamic";

const DEFAULT_BACKFILL_BATCH_SIZE = 10;
const DEFAULT_BACKFILL_MAX_BATCHES = 100_000;
const DEFAULT_BACKFILL_CONCURRENCY = 4;

export async function POST(request: Request) {
  try {
    const body = await safeJson(request);
    const job = await createBackfillJob({
      batchSize: positiveNumber(body.batchSize, DEFAULT_BACKFILL_BATCH_SIZE),
      maxBatches: positiveNumber(body.maxBatches, DEFAULT_BACKFILL_MAX_BATCHES),
      concurrency: positiveNumber(body.concurrency, DEFAULT_BACKFILL_CONCURRENCY),
      documentTimeoutMs: positiveNumber(body.documentTimeoutMs, 600_000),
      staleAfterMinutes: positiveNumber(body.staleAfterMinutes, 90),
      lookbackDays: optionalPositiveNumber(body.lookbackDays),
      metadata: { requestedFrom: "analysis_page" }
    });
    const status = await getBackfillControlStatus();

    return NextResponse.json({ job, status });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

async function safeJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
