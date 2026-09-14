import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabaseClient, persistDocuments, recomputeThemeTrends } from "./index";

const databaseUrl = process.env.DATABASE_URL;

function isoDate(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

test(
  "theme trend recompute skips empty windows, keeps the as-of row, and prunes old rows",
  { skip: !databaseUrl },
  async (context) => {
    const suffix = randomUUID();
    const themeId = `integration:theme:${suffix}`;
    const client = createDatabaseClient(databaseUrl!);
    await client.connect();
    context.after(async () => {
      await client.query("delete from theme_trends where theme_id = $1", [themeId]);
      await client.query("delete from signals where theme_id = $1", [themeId]);
      await client.query("delete from documents where id like $1", [`integration:tt:${suffix}%`]);
      await client.query("delete from themes where id = $1", [themeId]);
      await client.end();
    });

    await client.query(
      `insert into themes (id, label, description, theme_level, status)
       values ($1, $2, 'Theme trend integration fixture', 'market', 'emerging')`,
      [themeId, `Integration Theme ${suffix}`]
    );
    const asOfDate = isoDate(0);
    const signalDate = isoDate(20);
    const documentId = `integration:tt:${suffix}`;
    await persistDocuments([
      {
        id: documentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Theme trend fixture ${suffix}`,
        publisher: "Integration Publisher",
        publisherId: "integration-publisher",
        publisherOwner: "integration-owner",
        url: `https://example.com/theme-trend/${suffix}`,
        publishedAt: `${signalDate}T12:00:00.000Z`,
        tickers: [],
        summary: "Theme trend fixture",
        body: `Theme trend fixture body ${suffix}`,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);
    await client.query(
      `insert into signals (
         id, document_id, theme_id, stance, risk_tone, bullish_tone, confidence,
         evidence_snippet, score_contribution
       ) values ($1, $2, $3, 'bullish', 0.2, 0.6, 0.9, 'fixture evidence', 1.5)`,
      [`integration:signal:${suffix}`, documentId, themeId]
    );
    // A stale row far outside the storage window, as earlier runs left behind.
    await client.query(
      `insert into theme_trends (id, theme_id, trend_window, date, intensity, baseline_mean, baseline_stddev, z_score, percentile_rank, source_mix)
       values ($1, $2, '7d', $3::date, 0, 0, 0, 0, 0, '{}'::jsonb)`,
      [`integration:stale:${suffix}`, themeId, isoDate(120)]
    );

    const result = await recomputeThemeTrends({
      asOfDate,
      lookbackDays: 60,
      lowHistoryDays: 14,
      storageDays: 45,
      windows: ["7d"]
    });
    assert.ok(result.themesProcessed >= 1);
    assert.ok(result.skippedEmptyRows > 0, "empty windows were skipped");

    const rows = await client.query<{ date: string; intensity: number; z_score: number }>(
      `select date::text, intensity::float as intensity, z_score::float as z_score
       from theme_trends where theme_id = $1 and trend_window = '7d' order by date`,
      [themeId]
    );
    const dates = rows.rows.map((row) => row.date);
    assert.ok(dates.includes(asOfDate), "as-of-date row is always stored");
    assert.ok(dates.includes(signalDate), "window containing the signal is stored");
    assert.equal(dates.includes(isoDate(120)), false, "row older than the storage window was pruned");
    assert.ok(
      rows.rows.length < 45,
      `no-information windows are not stored (${rows.rows.length} of 45 dates kept)`
    );
    const snapshot = () => client.query(
      "select id, date::text, xmin::text as version, intensity::text, source_mix from theme_trends where theme_id = $1 order by id",
      [themeId]
    );
    const before = (await snapshot()).rows;
    const options = { asOfDate, lookbackDays: 60, lowHistoryDays: 14, storageDays: 45, windows: ["7d" as const] };
    const unchanged = await recomputeThemeTrends(options);
    assert.equal(unchanged.trendRowsChanged, 0);
    assert.deepEqual((await snapshot()).rows, before, "identical runs do not rewrite rows (including MVCC versions)");
    await client.query("update signals set score_contribution = 3 where id = $1", [`integration:signal:${suffix}`]);
    await recomputeThemeTrends(options);
    const changed = (await snapshot()).rows;
    assert.ok(changed.some((row, index) => row.intensity !== before[index].intensity), "changed evidence updates scores");
    await client.query("update signals set score_contribution = 5 where id = $1", [`integration:signal:${suffix}`]);
    await assert.rejects(recomputeThemeTrends({ ...options, onProgress(message) {
      if (message.startsWith("removed obsolete")) throw new Error("publication interrupted");
    }}), /publication interrupted/);
    assert.deepEqual((await snapshot()).rows, changed, "failed publication rolls back writes and deletions");
    await client.query("update signals set score_contribution = 3 where id = $1", [`integration:signal:${suffix}`]);
    const priorBatchSize = process.env.TREND_PUBLICATION_BATCH_SIZE;
    process.env.TREND_PUBLICATION_BATCH_SIZE = "3";
    context.after(() => {
      if (priorBatchSize === undefined) delete process.env.TREND_PUBLICATION_BATCH_SIZE;
      else process.env.TREND_PUBLICATION_BATCH_SIZE = priorBatchSize;
    });
    const nextDay = isoDate(-1);
    const progress: string[] = [];
    await assert.rejects(recomputeThemeTrends({ ...options, asOfDate: nextDay, onProgress(message) {
      if (message.startsWith("published ")) throw new Error("rollover batch interrupted");
    }}), /rollover batch interrupted/);
    assert.deepEqual((await snapshot()).rows, changed, "even an interrupted rollover batch leaves the prior snapshot intact");
    const rollover = await recomputeThemeTrends({ ...options, asOfDate: nextDay, onProgress: message => progress.push(message) });
    assert.ok(rollover.trendRowsChanged > 3);
    assert.ok(progress.filter(message => message.startsWith("published ")).length > 1, "rollover spans multiple bounded writes");
    const advanced = (await snapshot()).rows;
    assert.ok(advanced.some(row => row.date === nextDay), "rollover publishes the next day");
    assert.ok(advanced.some(row => row.source_mix.baselineDays !== changed.find(old => old.id === row.id)?.source_mix.baselineDays), "historical baselines reflect the new calculation date");
    assert.equal((await recomputeThemeTrends({ ...options, asOfDate: nextDay })).trendRowsChanged, 0, "retry after rollover is a no-op");
    const previousThreshold = process.env.TREND_SNAPSHOT_REBUILD_MIN_ROWS;
    process.env.TREND_SNAPSHOT_REBUILD_MIN_ROWS = "1";
    context.after(() => {
      if (previousThreshold === undefined) delete process.env.TREND_SNAPSHOT_REBUILD_MIN_ROWS;
      else process.env.TREND_SNAPSHOT_REBUILD_MIN_ROWS = previousThreshold;
    });
    const followingDay = isoDate(-2);
    await assert.rejects(recomputeThemeTrends({ ...options, asOfDate: followingDay, onProgress(message) {
      if (message.startsWith("loaded replacement trend rows")) throw new Error("snapshot copy interrupted");
    }}), /snapshot copy interrupted/);
    assert.deepEqual((await snapshot()).rows, advanced, "a failed copy batch leaves published data untouched");
    const tableShape = async () => ({
      constraints: (await client.query("select conname, contype, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'theme_trends'::regclass order by conname")).rows,
      indexes: (await client.query("select indexname, indexdef from pg_indexes where tablename = 'theme_trends' order by indexname")).rows
    });
    const shape = await tableShape();
    const createdAt = (await client.query("select id, created_at::text from theme_trends where theme_id = $1 order by id", [themeId])).rows;
    const oidBefore = (await client.query("select 'theme_trends'::regclass::oid as oid")).rows[0].oid;
    const reader = createDatabaseClient(databaseUrl!);
    await reader.connect();
    try {
      await assert.rejects(recomputeThemeTrends({ ...options, asOfDate: followingDay, onProgress(message) {
        if (message === "replacement trend snapshot switched") throw new Error("snapshot switch interrupted");
      }}), /snapshot switch interrupted/);
      assert.deepEqual((await snapshot()).rows, advanced, "even a failure after table replacement rolls back the whole snapshot");
      assert.equal((await client.query("select 'theme_trends'::regclass::oid as oid")).rows[0].oid, oidBefore);
      assert.deepEqual(await tableShape(), shape, "failed replacement restores all constraints and indexes");
      const rebuiltProgress: string[] = [];
      const rebuilt = await recomputeThemeTrends({ ...options, asOfDate: followingDay, onProgress: message => rebuiltProgress.push(message) });
      assert.ok(rebuilt.trendRowsChanged > 0);
      assert.ok(rebuiltProgress.includes("replacement trend snapshot switched"));
      assert.notEqual((await client.query("select 'theme_trends'::regclass::oid as oid")).rows[0].oid, oidBefore);
      assert.deepEqual(await tableShape(), shape, "replacement preserves constraint/index definitions and canonical names");
      const datesAfter = (await reader.query("select id, created_at::text from theme_trends where theme_id = $1 order by id", [themeId])).rows;
      for (const row of createdAt) assert.equal(datesAfter.find(item => item.id === row.id)?.created_at, row.created_at, "retained rows keep their original creation date");
      assert.equal((await recomputeThemeTrends({ ...options, asOfDate: followingDay })).trendRowsChanged, 0, "same-day retry returns to no-op incremental publication");
      await client.query("create view integration_trend_dependency as select id from theme_trends");
      try {
        await assert.rejects(recomputeThemeTrends({ ...options, asOfDate: isoDate(-3) }), /without custom grants, views/);
      } finally {
        await client.query("drop view integration_trend_dependency");
      }
      assert.equal((await client.query("select count(*)::int as count from pg_tables where tablename like 'theme_trends_next_%' or tablename like 'theme_trends_old_%'")).rows[0].count, 0, "no abandoned snapshot tables remain");
    } finally {
      await reader.end();
    }
    await client.query("delete from signals where theme_id = $1", [themeId]);
    await recomputeThemeTrends({ ...options, asOfDate: followingDay });
    assert.equal((await snapshot()).rows.length, 0, "disappearing themes leave no stale trends");
    for (const row of rows.rows) {
      if (row.date === asOfDate) continue;
      assert.ok(
        row.intensity !== 0 || row.z_score !== 0,
        `stored row ${row.date} carries information`
      );
    }
  }
);
