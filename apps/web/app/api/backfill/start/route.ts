import { NextResponse } from "next/server";
import {
  createBackfillJob,
  getBackfillControlStatus
} from "@market-themes/db";
import { controlledBackfillOptions } from "../../../../lib/backfill-defaults";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await safeJson(request);
    const job = await createBackfillJob({
      ...controlledBackfillOptions(body),
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

