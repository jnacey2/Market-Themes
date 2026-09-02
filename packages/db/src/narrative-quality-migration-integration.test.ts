import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDatabaseClient,
  persistDocuments
} from "./index";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/018_narrative_signal_quality.sql", import.meta.url)
  ),
  "utf8"
);

test(
  "consolidates legacy oil narratives and rejects incomplete quotations",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const documentIds = [
      "quality-migration-gold",
      "quality-migration-summary",
      "quality-migration-complete"
    ];
    const definitionId =
      "narrative:def:oil-inflation-fed-hike-bond-selloff:v1";
    const venezuelaId =
      "narrative:def:us-venezuela-oil-partnership:v1";
    context.after(() =>
      cleanup([...documentIds], [definitionId, venezuelaId])
    );

    const evidence = [
      "Energy prices rose, stoking inflation fears and boosting Fed rate-hike bets.",
      "Stocks fell amid rising oil prices, higher bond yields, inflation concerns and uncertainty over Federal Reserve policy.",
      "Stocks fell as oil prices pushed Treasury yields higher and investors feared inflation would convince the Fed to hike rates."
    ];
    for (const [index, documentId] of documentIds.entries()) {
      await persistDocuments([
        {
          id: documentId,
          sourceId: `quality-migration-source-${index}`,
          sourceClass: "newspaper",
          title: `Quality migration evidence ${index}`,
          publisher: `Quality Publisher ${index}`,
          publisherOwner: `quality-owner-${index}`,
          url: `https://example.com/quality-migration/${index}`,
          publishedAt: "2026-09-02T00:00:00.000Z",
          tickers: [],
          summary: "Signal quality migration fixture.",
          body: evidence[index],
          retrievalMethod: "api",
          retentionPolicy: "full_text"
        }
      ]);
    }

    const client = createDatabaseClient();
    await client.connect();
    try {
      await client.query(
        `insert into narrative_definitions (
           id, slug, version, name, proposition, category,
           inclusion_guidance, exclusion_guidance, status, kind, metadata
         ) values
           ($1, 'oil-inflation-fed-hike-bond-selloff', 1,
            'Oil Inflation Fed Hike Bond Selloff',
            'Oil drives inflation, Fed repricing, bonds, and equities.',
            'Macro', 'Require every causal leg.', 'Exclude partial chains.',
            'active', 'event', '{}'),
           ($2, 'us-venezuela-oil-partnership', 1,
            'US-Venezuela Oil Partnership',
            'The US has majority ownership of 17 untapped fields and will refill the SPR.',
            'Energy', 'Require the complete agreement.', 'Exclude uncertainty.',
            'active', 'event', '{}')`,
        [definitionId, venezuelaId]
      );
      for (const [index, documentId] of documentIds.entries()) {
        await client.query(
          `insert into narrative_observations (
             id, narrative_definition_id, document_id, matched, match_score,
             stance, risk_tone, bullish_tone, evidence_snippet,
             interpretation, affected_entities, model, prompt_version,
             review_status, reviewed_at, review_note
           ) values (
             $1, $2, $3, true, 95, 'risk', 80, 0, $4,
             'Migration fixture.', '{}', 'legacy-model', 'legacy-prompt',
             'approved', now(), 'Legacy approval.'
           )`,
          [
            `quality-migration-observation-${index}`,
            definitionId,
            documentId,
            evidence[index]
          ]
        );
      }

      await client.query(migration);

      const definition = await client.query<{
        status: string;
        merged_into_definition_id: string;
      }>(
        `select status, merged_into_definition_id
         from narrative_definitions where id = $1`,
        [definitionId]
      );
      assert.deepEqual(definition.rows[0], {
        status: "merged",
        merged_into_definition_id:
          "narrative:def:energy-shock-inflation-rates:v1"
      });

      const reviews = await client.query<{
        id: string;
        review_status: string;
      }>(
        `select id, review_status
         from narrative_observations
         where narrative_definition_id = $1
         order by id`,
        [definitionId]
      );
      assert.deepEqual(
        reviews.rows.map((row) => row.review_status),
        ["rejected", "rejected", "approved"]
      );

      const venezuela = await client.query<{
        version: number;
        status: string;
        proposition: string;
      }>(
        `select version, status, proposition
         from narrative_definitions
         where slug = 'us-venezuela-oil-partnership'
         order by version`,
      );
      assert.equal(venezuela.rows[0].status, "inactive");
      assert.equal(venezuela.rows[1].status, "probationary");
      assert.match(venezuela.rows[1].proposition, /35%/);
      assert.doesNotMatch(venezuela.rows[1].proposition, /majority ownership/i);
    } finally {
      await client.end();
    }
  }
);

async function cleanup(documentIds: string[], definitionIds: string[]) {
  if (!process.env.DATABASE_URL) return;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from narrative_review_events
       where observation_key like 'quality-migration-observation-%'`
    );
    await client.query(
      `delete from narrative_observations
       where narrative_definition_id = any($1::text[])`,
      [definitionIds]
    );
    await client.query(
      `delete from narrative_definition_events
       where narrative_definition_id = any($1::text[])`,
      [definitionIds]
    );
    await client.query(
      `delete from narrative_definitions where id = any($1::text[])`,
      [definitionIds]
    );
    await client.query(
      `delete from documents where id = any($1::text[])`,
      [documentIds]
    );
    await client.query(
      `delete from sources where id like 'quality-migration-source-%'`
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
