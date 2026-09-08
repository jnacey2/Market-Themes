import { NextResponse } from "next/server";
import {
  createPublicationFeed,
  listPublicationFeeds,
  setPublicationFeedEnabled
} from "@market-themes/db";
import {
  assertPublicNetworkUrl,
  normalizePublicationFeedInput
} from "@market-themes/ingest";
import { publicErrorMessage, rejectUnsafeMutation } from "../../../lib/ops-auth";

export async function GET() {
  return NextResponse.json({ feeds: await listPublicationFeeds() });
}

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  try {
    const input = normalizePublicationFeedInput(await request.json());
    await assertPublicNetworkUrl(input.feedUrl);
    const feed = await createPublicationFeed(input);
    return NextResponse.json({ feed }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: friendlyError(error) },
      { status: isInputError(error) ? 400 : 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as { id?: unknown; enabled?: unknown };
    if (typeof body.id !== "string" || typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "id and enabled are required." },
        { status: 400 }
      );
    }
    return NextResponse.json({
      feed: await setPublicationFeedEnabled(body.id, body.enabled)
    });
  } catch (error) {
    return NextResponse.json({ error: friendlyError(error) }, { status: 500 });
  }
}

function friendlyError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "23505") {
    return "That publication feed already exists.";
  }
  if (isInputError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  console.error("[api/publication-feeds]", error);
  return publicErrorMessage(error, "Could not update publication feeds.");
}

function isInputError(error: unknown) {
  return (
    error instanceof Error &&
    /required|must|valid|private network|HTTPS|already exists/i.test(error.message)
  );
}
