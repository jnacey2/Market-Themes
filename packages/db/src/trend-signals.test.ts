import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createDatabaseClient, persistDocuments } from "./persistence";
import { loadSignalsForTrendComputation, type SignalTrendInput } from "./trend-signals";

test("batched signal loading matches the prior query, preserves UTC boundaries and one snapshot", {
  skip: !process.env.DATABASE_URL
}, async () => {
  const prefix = `trend-signals:${randomUUID()}`;
  const client = createDatabaseClient();
  const writer = createDatabaseClient();
  await Promise.all([client.connect(), writer.connect()]);
  try {
    for (const name of ["raw", "market", "sector"]) {
      await writer.query(
        "insert into themes (id,label,description,theme_level,status) values ($1,$2,'fixture',$3,'emerging')",
        [`${prefix}:${name}`, name, name === "raw" ? "unmapped" : name]
      );
    }
    await persistDocuments(Array.from({ length: 254 }, (_, i) => ({
      id: `${prefix}:${String(i).padStart(3, "0")}`, sourceId: prefix,
      sourceClass: i % 2 ? "newspaper" as const : "manual" as const,
      title: `Fixture ${i}`, publisher: prefix,
      url: `https://example.com/${prefix}/${i}`,
      publishedAt: i === 252 ? "2026-08-31T23:59:59.999Z"
        : i === 253 ? "2026-09-03T00:00:00Z"
          : i === 0 ? "2026-09-01T00:00:00Z" : "2026-09-02T23:59:59.999Z",
      tickers: [], summary: "Fixture", body: `Unique fixture ${prefix} ${i}`,
      retrievalMethod: "manual", retentionPolicy: "full_text" as const
    })));
    for (let i = 0; i < 254; i++) {
      await writer.query(
        `insert into signals (id,document_id,theme_id,canonical_theme_id,canonical_subtheme_id,
          stance,risk_tone,bullish_tone,confidence,evidence_snippet,score_contribution,affected_entities)
         values ($1,$2,$3,$4,$5,'bullish',0,80,90,'fixture',1.25,array['EXAMPLE'])`,
        [`${prefix}:signal:${i}`, `${prefix}:${String(i).padStart(3, "0")}`, `${prefix}:raw`,
          i % 3 === 0 ? null : `${prefix}:market`,
          i % 3 === 2 ? `${prefix}:sector` : i === 1 ? `${prefix}:market` : null]
      );
    }
    // Independent oracle: the UNION ALL query used before batching. Include a
    // signal mapped to the same market/subtheme ID: both output rows must survive.
    const expected = await writer.query<SignalTrendInput>(
      `with trend_signal_rows as (
         select s.id,s.document_id,coalesce(s.canonical_theme_id,s.theme_id) as trend_theme_id,
           case when s.canonical_theme_id is null then 'unmapped' else 'market' end as trend_level,
           d.published_at,d.source_class,s.affected_entities,s.score_contribution
         from signals s join documents d on d.id=s.document_id
         where d.published_at::date between $1::date and $2::date and d.source_id=$3
         union all
         select s.id,s.document_id,s.canonical_subtheme_id,'sector',d.published_at,
           d.source_class,s.affected_entities,s.score_contribution
         from signals s join documents d on d.id=s.document_id
         where s.canonical_subtheme_id is not null
           and d.published_at::date between $1::date and $2::date and d.source_id=$3
       ) select tsr.id as "signalId",tsr.document_id as "documentId",tsr.trend_theme_id as "themeId",
         t.label as "themeLabel",tsr.trend_level as "trendLevel",tsr.published_at::date::text as "signalDate",
         tsr.source_class as "sourceClass",tsr.affected_entities as "affectedEntities",
         tsr.score_contribution::float as "scoreContribution"
       from trend_signal_rows tsr join themes t on t.id=tsr.trend_theme_id`,
      ["2026-09-01", "2026-09-02", prefix]
    );
    let batches = 0;
    const loaded = await loadSignalsForTrendComputation(client, "2026-09-01", "2026-09-02", async () => {
      if (++batches === 1) {
        await writer.query("update signals set score_contribution=9 where document_id in (select id from documents where source_id=$1)", [prefix]);
        await writer.query("update themes set label='Changed concurrently' where id=$1", [`${prefix}:market`]);
      }
    });
    const order = (rows: SignalTrendInput[]) => rows.sort((a, b) =>
      `${a.signalId}:${a.themeId}:${a.trendLevel}`.localeCompare(`${b.signalId}:${b.themeId}:${b.trendLevel}`));
    const actual = loaded.filter((row) => row.documentId.startsWith(prefix));
    assert.ok(batches >= 2);
    assert.equal(new Set(actual.map((row) => row.documentId)).size, 252);
    const firstSector = actual.findIndex((row) => row.trendLevel === "sector");
    assert.ok(firstSector > 0);
    assert.ok(actual.slice(firstSector).every((row) => row.trendLevel === "sector"));
    assert.deepEqual(order(actual), order(expected.rows));
    assert.equal((await client.query("show transaction_read_only")).rows[0].transaction_read_only, "off");
    // Failed loads leave no open snapshot/aborted transaction behind.
    await assert.rejects(loadSignalsForTrendComputation(client, "2026-09-01", "2026-09-02", () => {
      throw new Error("Progress consumer failed");
    }), /Progress consumer failed/);
    assert.equal((await client.query("show transaction_read_only")).rows[0].transaction_read_only, "off");
    assert.deepEqual(await loadSignalsForTrendComputation(client, "1900-01-01", "1900-01-02"), []);
  } finally {
    await writer.query("delete from documents where source_id=$1", [prefix]);
    await writer.query("delete from themes where id=any($1::text[])", [["raw", "market", "sector"].map((name) => `${prefix}:${name}`)]);
    await writer.query("delete from sources where id=$1", [prefix]);
    await Promise.all([client.end(), writer.end()]);
  }
});
