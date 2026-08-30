import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  autoApproveNarrativeObservations,
  createDatabaseClient,
  getActiveNarrativeDefinitions,
  getNarrativeReviewQueue,
  persistDocuments,
  persistNarrativeObservations,
  reviewNarrativeObservation,
  type NarrativeObservationInput
} from "./index";

test(
  "auto-approves only high-score independently corroborated evidence",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanup(suffix));
    const model = `auto-review-model:${suffix}`;
    const promptVersion = `auto-review-prompt:${suffix}`;
    const definitions = await getActiveNarrativeDefinitions();
    const pricingPower = definitions.find(
      (definition) => definition.slug === "pricing-power"
    );
    const aiCapex = definitions.find(
      (definition) => definition.slug === "ai-capex-discipline"
    );
    assert(pricingPower);
    assert(aiCapex);

    const fixtures = [
      fixture("pricing-a", "Publisher A", `owner-a:${suffix}`, 95, pricingPower.id),
      fixture("pricing-b", "Publisher B", `owner-b:${suffix}`, 92, pricingPower.id),
      fixture("pricing-low", "Publisher C", `owner-c:${suffix}`, 89, pricingPower.id),
      fixture("pricing-youtube", "YouTube", "youtube-com", 99, pricingPower.id),
      fixture("ai-same-a", "Publisher D", `same-owner:${suffix}`, 96, aiCapex.id),
      fixture("ai-same-b", "Publisher E", `same-owner:${suffix}`, 94, aiCapex.id)
    ];
    for (const item of fixtures) {
      const persisted = await persistDocuments([
        {
          id: `${item.key}:${suffix}`,
          sourceId: `auto-review-source:${item.key}:${suffix}`,
          sourceClass: "newspaper",
          title: `Auto-review evidence ${item.key} ${suffix}`,
          publisher: item.publisher,
          publisherId: item.publisher.toLowerCase().replaceAll(" ", "-"),
          publisherOwner: item.publisherOwner,
          url: `https://example.com/auto-review/${item.key}/${suffix}`,
          publishedAt: new Date().toISOString(),
          tickers: [],
          summary: "Automatic narrative review integration evidence.",
          body: item.quote,
          retrievalMethod: "api",
          retentionPolicy: "full_text"
        }
      ]);
      assert.equal(persisted.insertedDocuments, 1);
    }

    const observations: NarrativeObservationInput[] = fixtures.map((item) => ({
      id: `auto-review-observation:${item.key}:${suffix}`,
      narrativeDefinitionId: item.definitionId,
      documentId: `${item.key}:${suffix}`,
      matched: true,
      matchScore: item.score,
      stance: "bullish",
      riskTone: 10,
      bullishTone: 80,
      evidenceSnippet: item.quote,
      interpretation: "The exact quotation supports the tracked proposition.",
      affectedEntities: ["Integration"],
      model,
      promptVersion
    }));
    await persistNarrativeObservations(observations);

    const result = await autoApproveNarrativeObservations({
      model,
      promptVersion,
      minimumMatchScore: 90,
      minimumDocuments: 2,
      minimumPublisherOwners: 2,
      lookbackDays: 7,
      excludedPublisherOwners: ["youtube-com"]
    });
    assert.equal(result.approvedObservations, 2);
    assert.equal(result.narrativesTouched, 1);

    const queue = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      promptVersion
    );
    assert.equal(status(queue, `auto-review-observation:pricing-a:${suffix}`), "approved");
    assert.equal(status(queue, `auto-review-observation:pricing-b:${suffix}`), "approved");
    assert.equal(status(queue, `auto-review-observation:pricing-low:${suffix}`), "pending");
    assert.equal(
      status(queue, `auto-review-observation:pricing-youtube:${suffix}`),
      "pending"
    );
    assert.equal(status(queue, `auto-review-observation:ai-same-a:${suffix}`), "pending");
    assert.equal(status(queue, `auto-review-observation:ai-same-b:${suffix}`), "pending");

    const client = createDatabaseClient();
    await client.connect();
    try {
      const audit = await client.query<{
        review_note: string;
        metadata: Record<string, unknown>;
      }>(
        `select review_note, metadata
         from narrative_observations
         where id = $1`,
        [`auto-review-observation:pricing-a:${suffix}`]
      );
      assert.match(audit.rows[0].review_note, /^Auto-approved:/);
      assert.equal(typeof audit.rows[0].metadata.autoReview, "object");
    } finally {
      await client.end();
    }

    await reviewNarrativeObservation({
      id: `auto-review-observation:pricing-a:${suffix}`,
      status: "rejected",
      note: "Human override after automatic review."
    });
    const overridden = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      promptVersion
    );
    assert.equal(
      status(overridden, `auto-review-observation:pricing-a:${suffix}`),
      "rejected"
    );
  }
);

function fixture(
  key: string,
  publisher: string,
  publisherOwner: string,
  score: number,
  definitionId: string
) {
  return {
    key,
    publisher,
    publisherOwner,
    score,
    definitionId,
    quote: `Exact automatic review evidence for ${key}.`
  };
}

function status(
  queue: Awaited<ReturnType<typeof getNarrativeReviewQueue>>,
  id: string
) {
  return queue.items.find((item) => item.id === id)?.reviewStatus;
}

async function cleanup(suffix: string) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(`delete from documents where id like $1`, [`%${suffix}`]);
    await client.query(`delete from sources where id like $1`, [`%${suffix}`]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
