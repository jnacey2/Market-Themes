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
    console.error("Health database check failed", error);
    return Response.json(
      {
        ok: false,
        database: "error"
      },
      { status: 503 }
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
