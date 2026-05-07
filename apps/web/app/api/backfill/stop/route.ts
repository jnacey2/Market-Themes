import { NextResponse } from "next/server";
import {
  getBackfillControlStatus,
  requestBackfillStop
} from "@market-themes/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await safeJson(request);
    const job = await requestBackfillStop({
      jobId: typeof body.jobId === "string" ? body.jobId : undefined
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
