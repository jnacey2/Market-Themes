import { NextResponse } from "next/server";
import {
  getBackfillControlStatus,
  requestBackfillStop
} from "@market-themes/db";
import { publicErrorMessage, rejectUnsafeMutation } from "../../../../lib/ops-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  try {
    const body = await safeJson(request);
    const job = await requestBackfillStop({
      jobId: typeof body.jobId === "string" ? body.jobId : undefined
    });
    const status = await getBackfillControlStatus();

    return NextResponse.json({ job, status });
  } catch (error) {
    console.error("[api/backfill/stop]", error);
    return NextResponse.json(
      { error: publicErrorMessage(error, "Could not stop the backfill.") },
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
