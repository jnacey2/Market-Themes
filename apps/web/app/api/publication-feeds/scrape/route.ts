import { NextResponse } from "next/server";
import { scrapeSubstackPublications } from "@market-themes/ingest";
import { publicErrorMessage, rejectUnsafeMutation } from "../../../../lib/ops-auth";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejected = rejectUnsafeMutation(request);
  if (rejected) return rejected;
  try {
    const body = (await request.json()) as {
      url?: unknown;
      urls?: unknown;
      name?: unknown;
      all?: unknown;
      limit?: unknown;
      persist?: unknown;
    };
    const urls = [
      ...(typeof body.url === "string" && body.url.trim() ? [body.url.trim()] : []),
      ...(Array.isArray(body.urls)
        ? body.urls.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [])
    ];
    const summaries = await scrapeSubstackPublications({
      urls,
      all: body.all === true,
      name: typeof body.name === "string" ? body.name : undefined,
      limit: Number.isInteger(body.limit) ? Number(body.limit) : 12,
      persist: body.persist !== false
    });
    return NextResponse.json({ summaries });
  } catch (error) {
    console.error("[api/publication-feeds/scrape]", error);
    return NextResponse.json(
      { error: publicErrorMessage(error, "Scrape failed.") },
      { status: 400 }
    );
  }
}
