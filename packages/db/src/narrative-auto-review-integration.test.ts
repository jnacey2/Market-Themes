import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  autoApproveNarrativeObservations,
  createDatabaseClient,
  finishPipelineRun,
  getActiveNarrativeDefinitions,
  getNarrativeReviewQueue,
  persistDocuments,
  persistNarrativeObservations,
  reviewNarrativeObservation,
  startPipelineRun,
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
      fixture("pricing-echo", "Publisher Echo", `owner-echo:${suffix}`, 91, pricingPower.id),
      fixture("pricing-low", "Publisher C", `owner-c:${suffix}`, 89, pricingPower.id),
      fixture("pricing-youtube", "YouTube Channel", `channel:${suffix}`, 99, pricingPower.id, {
        url: "https://youtu.be/example-auto-review-video"
      }),
      fixture("pricing-preview", "Publisher F", `owner-f:${suffix}`, 99, pricingPower.id, {
        metadata: { content: "Preview" }
      }),
      fixture("pricing-future", "Publisher G", `owner-g:${suffix}`, 99, pricingPower.id, {
        publishedAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
      }),
      fixture("pricing-stale", "Publisher H", `owner-h:${suffix}`, 99, pricingPower.id, {
        publishedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString()
      }),
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
          url:
            item.url ??
            `https://example.com/auto-review/${item.key}/${suffix}`,
          publishedAt: item.publishedAt,
          tickers: [],
          summary: "Automatic narrative review integration evidence.",
          body: item.quote,
          retrievalMethod: "api",
          retentionPolicy: "full_text",
          metadata: item.metadata
        }
      ]);
      assert.equal(persisted.insertedDocuments, 1);
    }
    const storyClient = createDatabaseClient();
    await storyClient.connect();
    try {
      await storyClient.query(
        `update documents
         set near_duplicate_key = $2
         where id = any($1::text[])`,
        [
          [`pricing-b:${suffix}`, `pricing-echo:${suffix}`],
          `shared-pricing-story:${suffix}`
        ]
      );
    } finally {
      await storyClient.end();
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
      promptVersion,
      metadata: {
        contractValidation: {
          satisfied: true,
          inclusionCriteriaSatisfied: ["Integration fixture"],
          exclusionCriteriaTriggered: []
        }
      }
    }));
    await persistNarrativeObservations(observations);

    const result = await autoApproveNarrativeObservations({
      model,
      promptVersion,
      minimumMatchScore: 90,
      minimumDocuments: 2,
      minimumPublisherOwners: 2,
      lookbackDays: 7,
      excludedPublisherOwners: ["youtube", "youtube-com", "youtu.be"]
    });
    assert.equal(result.approvedObservations, 2);
    assert.equal(result.narrativesTouched, 1);

    const queue = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      promptVersion
    );
    assert.equal(status(queue, `auto-review-observation:pricing-a:${suffix}`), "approved");
    assert.equal(status(queue, `auto-review-observation:pricing-b:${suffix}`), "approved");
    assert.equal(
      status(queue, `auto-review-observation:pricing-echo:${suffix}`),
      "pending"
    );
    assert.equal(status(queue, `auto-review-observation:pricing-low:${suffix}`), "pending");
    assert.equal(
      status(queue, `auto-review-observation:pricing-youtube:${suffix}`),
      "pending"
    );
    assert.equal(
      status(queue, `auto-review-observation:pricing-preview:${suffix}`),
      "pending"
    );
    assert.equal(
      status(queue, `auto-review-observation:pricing-future:${suffix}`),
      "pending"
    );
    assert.equal(
      status(queue, `auto-review-observation:pricing-stale:${suffix}`),
      "pending"
    );
    assert.equal(status(queue, `auto-review-observation:ai-same-a:${suffix}`), "pending");
    assert.equal(status(queue, `auto-review-observation:ai-same-b:${suffix}`), "pending");

    const secondPromptVersion = `${promptVersion}:v2`;
    const automaticObservation = observations.find(
      (observation) =>
        observation.id === `auto-review-observation:pricing-b:${suffix}`
    );
    assert(automaticObservation);
    await persistNarrativeObservations([
      {
        ...automaticObservation,
        id: `auto-review-observation:pricing-b:v2:${suffix}`,
        matchScore: 70,
        promptVersion: secondPromptVersion
      }
    ]);
    const automaticNotInherited = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      secondPromptVersion
    );
    assert.equal(
      status(
        automaticNotInherited,
        `auto-review-observation:pricing-b:v2:${suffix}`
      ),
      "pending"
    );

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

    await persistNarrativeObservations([
      {
        ...automaticObservation,
        id: `auto-review-observation:pricing-b:reclassified:${suffix}`,
        matchScore: 70
      }
    ]);
    const reclassified = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      promptVersion
    );
    assert.equal(
      status(reclassified, `auto-review-observation:pricing-b:${suffix}`),
      "pending"
    );

    await assert.rejects(
      () =>
        reviewNarrativeObservation({
          id: `auto-review-observation:pricing-a:${suffix}`,
          status: "rejected"
        }),
      /review note is required/
    );
    await reviewNarrativeObservation({
      id: `auto-review-observation:pricing-a:${suffix}`,
      status: "rejected",
      note: "Human override after automatic review."
    });
    const humanObservation = observations.find(
      (observation) =>
        observation.id === `auto-review-observation:pricing-a:${suffix}`
    );
    assert(humanObservation);
    await persistNarrativeObservations([
      {
        ...humanObservation,
        id: `auto-review-observation:pricing-a:v2:${suffix}`,
        promptVersion: secondPromptVersion
      }
    ]);
    const overridden = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      promptVersion
    );
    assert.equal(
      status(overridden, `auto-review-observation:pricing-a:${suffix}`),
      "rejected"
    );
    const humanInherited = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      secondPromptVersion
    );
    assert.equal(
      status(humanInherited, `auto-review-observation:pricing-a:v2:${suffix}`),
      "rejected"
    );
    const rerun = await autoApproveNarrativeObservations({
      model,
      promptVersion,
      minimumMatchScore: 90,
      minimumDocuments: 2,
      minimumPublisherOwners: 2,
      lookbackDays: 7,
      excludedPublisherOwners: ["youtube", "youtube-com", "youtu.be"]
    });
    assert.equal(rerun.approvedObservations, 0);

    const concurrentStage = `auto-review-concurrency:${suffix}`;
    const firstRun = await startPipelineRun(concurrentStage);
    const secondRun = await startPipelineRun(concurrentStage);
    const runClient = createDatabaseClient();
    await runClient.connect();
    try {
      const statuses = await runClient.query<{ id: string; status: string }>(
        `select id, status from pipeline_runs where id = any($1::text[])`,
        [[firstRun, secondRun]]
      );
      assert.equal(
        statuses.rows.filter((row) => row.status === "running").length,
        2
      );
    } finally {
      await runClient.end();
    }
    await finishPipelineRun(firstRun, { status: "completed" });
    await finishPipelineRun(secondRun, { status: "completed" });

    const eventClient = createDatabaseClient();
    await eventClient.connect();
    try {
      const inheritedProvenance = await eventClient.query<{
        metadata: Record<string, {
          actorType?: string;
          inheritedFromObservationId?: string;
        }>;
      }>(
        `select metadata
         from narrative_observations
         where id = $1`,
        [`auto-review-observation:pricing-a:v2:${suffix}`]
      );
      assert.equal(
        inheritedProvenance.rows[0].metadata.reviewProvenance?.actorType,
        "human"
      );
      assert.equal(
        inheritedProvenance.rows[0].metadata.reviewProvenance
          ?.inheritedFromObservationId,
        `auto-review-observation:pricing-a:${suffix}`
      );
      const events = await eventClient.query<{
        actor_type: string;
        count: string;
      }>(
        `select actor_type, count(*)::text as count
         from narrative_review_events
         where observation_id like $1
         group by actor_type`,
        [`auto-review-observation:%:${suffix}`]
      );
      assert.equal(
        Number(events.rows.find((row) => row.actor_type === "automatic")?.count),
        2
      );
      assert.equal(
        Number(events.rows.find((row) => row.actor_type === "human")?.count),
        1
      );
      assert.equal(
        Number(
          events.rows.find((row) => row.actor_type === "human_inherited")?.count
        ),
        1
      );
      assert.equal(
        Number(events.rows.find((row) => row.actor_type === "system")?.count),
        1
      );
      await assert.rejects(
        () =>
          eventClient.query(
            `update narrative_review_events
             set review_note = 'mutated'
             where observation_id = $1`,
            [`auto-review-observation:pricing-a:${suffix}`]
          ),
        /append-only/
      );
      await eventClient.query(`delete from documents where id = $1`, [
        `pricing-a:${suffix}`
      ]);
      const retainedEvents = await eventClient.query<{
        observation_id: string | null;
        observation_key: string;
      }>(
        `select observation_id, observation_key
         from narrative_review_events
         where observation_key = $1`,
        [`auto-review-observation:pricing-a:${suffix}`]
      );
      assert.equal(retainedEvents.rows.length, 2);
      assert.equal(
        retainedEvents.rows.every((row) => row.observation_id === null),
        true
      );
    } finally {
      await eventClient.end();
    }
  }
);

function fixture(
  key: string,
  publisher: string,
  publisherOwner: string,
  score: number,
  definitionId: string,
  options: {
    metadata?: Record<string, unknown>;
    publishedAt?: string;
    url?: string;
  } = {}
) {
  return {
    key,
    publisher,
    publisherOwner,
    score,
    definitionId,
    quote: `Exact automatic review evidence for ${key}.`,
    metadata: options.metadata ?? {},
    publishedAt: options.publishedAt ?? new Date().toISOString(),
    url: options.url
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
    await client.query(`delete from pipeline_runs where stage like $1`, [
      `%${suffix}`
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}
