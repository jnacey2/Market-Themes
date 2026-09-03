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
    for (const row of rows.rows) {
      if (row.date === asOfDate) continue;
      assert.ok(
        row.intensity !== 0 || row.z_score !== 0,
        `stored row ${row.date} carries information`
      );
    }
  }
);
