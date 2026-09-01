import { NextResponse } from "next/server";
import { retractNarrativeDefinition } from "@market-themes/db";
import { isSafeMutationRequest } from "../../../../lib/ops-auth";

export async function POST(request: Request) {
  if (!isSafeMutationRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin or non-JSON mutation rejected." },
      { status: 403 }
    );
  }
  try {
    const body = (await request.json()) as {
      id?: unknown;
      reason?: unknown;
    };
    if (
      typeof body.id !== "string" ||
      typeof body.reason !== "string" ||
      !body.reason.trim()
    ) {
      return NextResponse.json(
        { error: "Narrative id and retraction reason are required." },
        { status: 400 }
      );
    }
    const narrative = await retractNarrativeDefinition({
      id: body.id,
      reason: body.reason
    });
    return NextResponse.json({ narrative });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
