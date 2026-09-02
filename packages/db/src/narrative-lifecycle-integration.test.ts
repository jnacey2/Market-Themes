import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabaseClient,
  persistDocuments,
  persistNarrativeObservations,
  reconcileNarrativeDefinitionLifecycle,
  reviewNarrativeObservation
} from "./index";

test(
  "activates probationary narratives by unique stories and expires events",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    const model = `lifecycle-model:${suffix}`;
    const promptVersion = `lifecycle-prompt:${suffix}`;
    const activatingId = `narrative:def:lifecycle-activating:${suffix}`;
    const duplicateId = `narrative:def:lifecycle-duplicate:${suffix}`;
    const expiringId = `narrative:def:lifecycle-expiring:${suffix}`;
    const documentIds = [1, 2, 3].map(
      (index) => `lifecycle:document:${index}:${suffix}`
    );
    context.after(() => cleanup(suffix));

    for (const [index, documentId] of documentIds.entries()) {
      await persistDocuments([
        {
          id: documentId,
          sourceId: `lifecycle-source:${index}:${suffix}`,
          sourceClass: "newspaper",
          title: `Lifecycle evidence ${index} ${suffix}`,
          publisher: `Lifecycle Publisher ${index}`,
          publisherId: `lifecycle-publisher-${index}`,
          publisherOwner: `lifecycle-owner-${index}:${suffix}`,
          url: `https://example.com/lifecycle/${index}/${suffix}`,
          publishedAt: new Date().toISOString(),
          tickers: [],
          summary: "Narrative lifecycle fixture.",
          body: `Direct contract-complete evidence ${index} ${suffix}`,
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
           inclusion_guidance, exclusion_guidance, status, kind,
           event_expires_at, metadata
         ) values
           ($1, $2, 1, 'Lifecycle activating', 'A directly supported proposition.',
            'Other', 'Include direct support.', 'Exclude adjacency.',
            'probationary', 'structural', null, '{"origin":"integration"}'),
           ($3, $4, 1, 'Lifecycle duplicate', 'A duplicate-story proposition.',
            'Other', 'Include direct support.', 'Exclude adjacency.',
            'probationary', 'structural', null, '{"origin":"integration"}'),
           ($5, $6, 1, 'Lifecycle expiring', 'A time-limited event.',
            'Other', 'Include direct support.', 'Exclude adjacency.',
            'probationary', 'event', now() - interval '1 minute',
            '{"origin":"integration"}')`,
        [
          activatingId,
          `lifecycle-activating-${suffix}`,
          duplicateId,
          `lifecycle-duplicate-${suffix}`,
          expiringId,
          `lifecycle-expiring-${suffix}`
        ]
      );
    } finally {
      await client.end();
    }

    await persistApprovedObservations(
      activatingId,
      documentIds,
      model,
      promptVersion,
      suffix
    );
    const activated = await reconcileNarrativeDefinitionLifecycle({
      model,
      promptVersion,
      minimumStories: 3,
      minimumPublisherOwners: 3,
      lookbackDays: 7
    });
    assert(activated.activatedDefinitionIds.includes(activatingId));
    assert(activated.expiredDefinitionIds.includes(expiringId));

    const duplicateClient = createDatabaseClient();
    await duplicateClient.connect();
    try {
      await duplicateClient.query(
        `update documents
         set near_duplicate_key = $2
         where id = any($1::text[])`,
        [documentIds.slice(0, 2), `shared-story:${suffix}`]
      );
    } finally {
      await duplicateClient.end();
    }
    await persistApprovedObservations(
      duplicateId,
      documentIds,
      model,
      promptVersion,
      suffix
    );
    const duplicateResult = await reconcileNarrativeDefinitionLifecycle({
      model,
      promptVersion,
      minimumStories: 3,
      minimumPublisherOwners: 3,
      lookbackDays: 7
    });
    assert.equal(duplicateResult.activatedDefinitions, 0);

    const statusClient = createDatabaseClient();
    await statusClient.connect();
    try {
      const statuses = await statusClient.query<{
        id: string;
        status: string;
      }>(
        `select id, status
         from narrative_definitions
         where id = any($1::text[])
         order by id`,
        [[activatingId, duplicateId, expiringId]]
      );
      assert.equal(
        statuses.rows.find((row) => row.id === activatingId)?.status,
        "active"
      );
      assert.equal(
        statuses.rows.find((row) => row.id === duplicateId)?.status,
        "probationary"
      );
      assert.equal(
        statuses.rows.find((row) => row.id === expiringId)?.status,
        "expired"
      );
    } finally {
      await statusClient.end();
    }
  }
);

async function persistApprovedObservations(
  definitionId: string,
  documentIds: string[],
  model: string,
  promptVersion: string,
  suffix: string
) {
  for (const [index, documentId] of documentIds.entries()) {
    const observationId = `lifecycle:observation:${definitionId}:${index}`;
    await persistNarrativeObservations([
      {
        id: observationId,
        narrativeDefinitionId: definitionId,
        documentId,
        matched: true,
        matchScore: 95,
        stance: "neutral",
        riskTone: 20,
        bullishTone: 20,
        evidenceSnippet: `Direct contract-complete evidence ${index}`,
        interpretation: "The fixture directly supports the proposition.",
        affectedEntities: [],
        model,
        promptVersion,
        metadata: {
          contractValidation: {
            satisfied: true,
            inclusionCriteriaSatisfied: ["Direct support"],
            exclusionCriteriaTriggered: []
          },
          suffix
        }
      }
    ]);
    await reviewNarrativeObservation({
      id: observationId,
      status: "approved",
      note: "Lifecycle integration approval."
    });
  }
}

async function cleanup(suffix: string) {
  if (!process.env.DATABASE_URL) return;
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from narrative_definition_events
       where narrative_definition_id like $1`,
      [`%${suffix}`]
    );
    await client.query(
      `delete from narrative_review_events
       where observation_key like $1`,
      [`%${suffix}%`]
    );
    await client.query(
      `delete from narrative_observations
       where narrative_definition_id like $1`,
      [`%${suffix}`]
    );
    await client.query(
      `delete from narrative_definitions where id like $1`,
      [`%${suffix}`]
    );
    await client.query(`delete from documents where id like $1`, [
      `%${suffix}`
    ]);
    await client.query(`delete from sources where id like $1`, [
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
