import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import type pg from "pg";

// Session locks use the same connection as the protected queries and are released
// when it closes, including after an exception or a killed cron process.
const LOCK_NAME = "market_themes_trend_rewrite_io";

export async function acquireTrendDatabaseLock(
  client: pg.Client,
  mode: "shared" | "exclusive",
  options: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    onWait?: (message: string) => void;
  } = {}
) {
  const started = performance.now();
  const maxWaitMs = options.maxWaitMs ?? 55 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const lock = mode === "shared"
    ? "pg_try_advisory_lock_shared"
    : "pg_try_advisory_lock";
  let lastNotice = -Infinity;
  for (;;) {
    const result = await client.query<{ acquired: boolean }>(
      `select ${lock}(hashtextextended($1, 0)) as acquired`,
      [LOCK_NAME]
    );
    if (result.rows[0]?.acquired) return;
    const elapsed = performance.now() - started;
    if (elapsed >= maxWaitMs) {
      throw new Error(`Timed out waiting for the trend database ${mode} lock.`);
    }
    if (elapsed - lastNotice >= 60_000) {
      const message = `waiting for trend database access (${mode}, ${Math.round(elapsed / 1000)}s)`;
      if (options.onWait) options.onWait(message);
      else console.log(`[trend-database-lock] ${message}`);
      lastNotice = elapsed;
    }
    // Waiting outside a SQL statement preserves the normal query timeout. A
    // slow rewrite delays classification instead of exhausting its read budget.
    await delay(Math.min(pollIntervalMs, maxWaitMs - elapsed));
  }
}
