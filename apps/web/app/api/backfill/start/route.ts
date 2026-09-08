import { NextResponse } from "next/server";
import {
  createBackfillJob,
  getBackfillControlStatus
} from "@market-themes/db";
import { controlledBackfillOptions } from "../../../../lib/backfill-defaults";
import { publicErrorMessage, rejectUnsafeMutation } from "../../../../lib/ops-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  try {
    const body = await safeJson(request);
    const job = await createBackfillJob({
      ...controlledBackfillOptions(body),
      metadata: { requestedFrom: "analysis_page" }
    });
    const status = await getBackfillControlStatus();

    return NextResponse.json({ job, status });
  } catch (error) {
    console.error("[api/backfill/start]", error);
    return NextResponse.json(
      { error: publicErrorMessage(error, "Could not start the backfill.") },
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
