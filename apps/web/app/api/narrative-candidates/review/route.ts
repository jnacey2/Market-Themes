import { NextResponse } from "next/server";
import {
  mergeNarrativeCandidate,
  promoteNarrativeCandidate,
  rejectNarrativeCandidate
} from "@market-themes/db";
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
      action?: unknown;
      targetId?: unknown;
      note?: unknown;
    };
    if (typeof body.id !== "string") {
      return NextResponse.json(
        { error: "A narrative candidate id is required." },
        { status: 400 }
      );
    }
    const note = typeof body.note === "string" ? body.note : undefined;

    if (body.action === "promote") {
      const result = await promoteNarrativeCandidate({ id: body.id, note });
      return NextResponse.json({ candidate: result });
    }
    if (body.action === "reject") {
      const result = await rejectNarrativeCandidate({ id: body.id, note });
      return NextResponse.json({ candidate: result });
    }
    if (body.action === "merge" && typeof body.targetId === "string") {
      const result = await mergeNarrativeCandidate({
        id: body.id,
        targetId: body.targetId,
        note
      });
      return NextResponse.json({ candidate: result });
    }

    return NextResponse.json(
      { error: "Use promote, reject, or merge with a target candidate." },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expected =
      /candidate|documents|publisher groups|tracked narrative|slug/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: expected ? 409 : 500 }
    );
  }
}
