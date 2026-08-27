import { getOperationsStatus } from "@market-themes/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const operations = await getOperationsStatus();
    const latest = operations.latestNarrativeTrendDate ?? operations.latestTrendDate;
    const freshnessHours = latest
      ? (Date.now() - new Date(latest).getTime()) / 3_600_000
      : null;
    const ready = operations.databaseConfigured;

    return Response.json(
      {
        ok: ready,
        database: ready ? "connected" : "not_configured",
        worker: operations.recentRuns[0]?.status ?? "no_runs",
        latestTrendDate: latest,
        trendFreshnessHours: freshnessHours
      },
      { status: ready ? 200 : 503 }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        database: "error",
        error: error instanceof Error ? error.message : String(error)
      },
      { status: 503 }
    );
  }
}
