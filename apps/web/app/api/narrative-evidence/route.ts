import { NextResponse } from "next/server";
import { getNarrativeEvidence } from "@market-themes/db";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id"),
    date = params.get("date");
  if (
    !id ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  ) {
    return NextResponse.json(
      { error: "A narrative and valid date are required." },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(
      await getNarrativeEvidence({
        id,
        date,
        window: params.get("window") === "30d" ? "30d" : "7d",
        source: params.get("source") ?? "all",
        tone: params.get("tone") ?? "all",
        page: Number(params.get("page")) || 0
      })
    );
  } catch (error) {
    console.error("Evidence query failed", error);
    return NextResponse.json(
      { error: "Evidence could not be loaded. Please retry." },
      { status: 503 }
    );
  }
}
