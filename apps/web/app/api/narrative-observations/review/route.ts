import { NextResponse } from "next/server";
import {
  reviewNarrativeObservation,
  type NarrativeReviewStatus
} from "@market-themes/db";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: unknown;
      status?: unknown;
      note?: unknown;
    };
    const status = body.status as NarrativeReviewStatus;

    if (
      typeof body.id !== "string" ||
      (status !== "approved" && status !== "rejected")
    ) {
      return NextResponse.json(
        { error: "id and an approved/rejected status are required." },
        { status: 400 }
      );
    }

    const observation = await reviewNarrativeObservation({
      id: body.id,
      status,
      note: typeof body.note === "string" ? body.note : undefined
    });
    return NextResponse.json({ observation });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
