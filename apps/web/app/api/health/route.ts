import { createDatabaseClient } from "@market-themes/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return Response.json(
      { ok: false, database: "not_configured" },
      { status: 503 }
    );
  }

  const client = createDatabaseClient(databaseUrl, {
    queryTimeoutMs: 5_000,
    statementTimeoutMs: 5_000
  });

  try {
    await client.connect();
    await client.query("select 1");

    return Response.json({
      ok: true,
      database: "connected",
      commit: process.env.RENDER_GIT_COMMIT ?? null
    });
  } catch (error) {
    // The health endpoint is unauthenticated; keep connection details out of
    // the response and log them for operators instead.
    console.error("[api/health] database check failed", error);
    return Response.json(
      {
        ok: false,
        database: "error",
        error: "database_unreachable"
      },
      { status: 503 }
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
