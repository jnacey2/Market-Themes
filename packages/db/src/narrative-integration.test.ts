import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  createDatabaseClient,
  getActiveNarrativeDefinitions,
  getTrackedNarrativeDefinitions,
  getNarrativeBoardStatus,
  getNarrativeHomepageStatus,
  getNarrativeReviewQueue,
  createPublicationFeed,
  listPublicationFeeds,
  persistDocuments,
  persistNarrativeObservations,
  recomputeNarrativeTrends,
  reviewNarrativeObservation,
  setPublicationFeedEnabled
} from "./index";

test(
  "persists, recomputes, and reloads an evidence-backed narrative",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupNarrativeFixture(suffix));
    const documentId = `integration:document:${suffix}`;
    const publishedAt = "2026-08-27T12:00:00.000Z";
    const body = `AI infrastructure demand is rising because capacity remains constrained. ${suffix}`;
    const persisted = await persistDocuments([
      {
        id: documentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Integration market report ${suffix}`,
        publisher: "Integration Publisher",
        publisherId: "integration-publisher",
        publisherOwner: "integration-owner",
        url: `https://example.com/integration/${suffix}`,
        publishedAt,
        tickers: ["TEST"],
        summary: "Integration fixture",
        body,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);
    assert.equal(persisted.insertedDocuments, 1);

    const definitions = await getActiveNarrativeDefinitions();
    const trackedDefinitions = await getTrackedNarrativeDefinitions();
    const definition = definitions.find((item) => item.slug === "ai-infrastructure-demand");
    assert(definition);
    await persistNarrativeObservations([
      {
        id: `integration:observation:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId,
        matched: true,
        matchScore: 95,
        stance: "bullish",
        riskTone: 0,
        bullishTone: 85,
        evidenceSnippet:
          "AI infrastructure demand is rising because capacity remains constrained.",
        interpretation: "The source reports constrained capacity and rising demand.",
        affectedEntities: ["TEST"],
        model: "integration-fixture",
        promptVersion: "integration-v1"
      }
    ]);

    await recomputeNarrativeTrends({
      asOfDate: "2026-08-27",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: "integration-v1"
    });
    const pendingBoard = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    assert(
      pendingBoard.narratives.every(
        (item) =>
          !item.evidence.some(
            (evidence) => evidence.id === `integration:observation:${suffix}`
          )
      )
    );

    await reviewNarrativeObservation(
      {
        id: `integration:observation:${suffix}`,
        status: "approved",
        note: "Approved by integration contract."
      },
      process.env.DATABASE_URL
    );
    const oldDocumentId = `integration:document:old:${suffix}`;
    const oldEvidence =
      "AI infrastructure demand increased in an older reporting period.";
    await persistDocuments([
      {
        id: oldDocumentId,
        sourceId: "integration-news",
        sourceClass: "newspaper",
        title: `Old integration market report ${suffix}`,
        publisher: "Integration Publisher",
        publisherId: "integration-publisher",
        publisherOwner: "integration-owner",
        url: `https://example.com/integration/old/${suffix}`,
        publishedAt: "2026-08-01T12:00:00.000Z",
        tickers: ["TEST"],
        summary: "Out-of-window integration fixture",
        body: `${oldEvidence} ${suffix}`,
        retrievalMethod: "api",
        retentionPolicy: "full_text"
      }
    ]);
    await persistNarrativeObservations([
      {
        id: `integration:observation:old:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId: oldDocumentId,
        matched: true,
        matchScore: 99,
        stance: "bullish",
        riskTone: 0,
        bullishTone: 90,
        evidenceSnippet: oldEvidence,
        interpretation: "Older evidence must not appear in a current preview.",
        affectedEntities: ["OLD"],
        model: "integration-fixture",
        promptVersion: "integration-v1"
      }
    ]);
    await reviewNarrativeObservation({
      id: `integration:observation:old:${suffix}`,
      status: "approved",
      note: "Approved historical fixture."
    });
    await persistNarrativeObservations([
      {
        id: `integration:observation:reclassified:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId,
        matched: false,
        matchScore: 0,
        stance: "neutral",
        riskTone: 0,
        bullishTone: 0,
        evidenceSnippet: "",
        interpretation: "",
        affectedEntities: [],
        model: "integration-fixture",
        promptVersion: "integration-v1"
      }
    ]);
    const preservedReview = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    assert.equal(
      preservedReview.items.find(
        (item) => item.id === `integration:observation:${suffix}`
      )?.reviewStatus,
      "approved"
    );
    await persistNarrativeObservations([
      {
        id: `integration:observation:v2:${suffix}`,
        narrativeDefinitionId: definition.id,
        documentId,
        matched: true,
        matchScore: 96,
        stance: "bullish",
        riskTone: 0,
        bullishTone: 86,
        evidenceSnippet:
          "AI infrastructure demand is rising because capacity remains constrained.",
        interpretation: "The source reports constrained capacity and rising demand.",
        affectedEntities: ["TEST"],
        model: "integration-fixture",
        promptVersion: "integration-v2"
      }
    ]);
    const inheritedReview = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      "integration-v2"
    );
    const inheritedItem = inheritedReview.items.find(
      (item) => item.id === `integration:observation:v2:${suffix}`
    );
    assert.equal(inheritedItem?.reviewStatus, "approved");
    assert.equal(inheritedItem?.reviewNote, "Approved by integration contract.");

    const recomputed = await recomputeNarrativeTrends({
      asOfDate: "2026-08-27",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: "integration-v1"
    });
    assert.equal(
      recomputed.definitionsProcessed,
      trackedDefinitions.length
    );

    const board = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    const narrative = board.narratives.find((item) => item.id === definition.id);
    assert(narrative);
    assert(narrative.matchedDocuments >= 1);
    assert(narrative.evidence.length >= 1);

    await recomputeNarrativeTrends({
      asOfDate: "2026-08-28",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: "integration-v1",
      windows: ["30d"]
    });
    const homepage = await getNarrativeHomepageStatus(
      process.env.DATABASE_URL,
      "integration-v1"
    );
    assert.equal(homepage.degraded, false);
    assert.equal(homepage.latestDate, "2026-08-27");
    assert.equal(homepage.trackedNarrativeCount, definitions.length);
    assert(
      homepage.narratives.some(
        (item) =>
          item.id === definition.id &&
          item.matchedDocuments >= 1 &&
          item.evidencePreview.length >= 1
      )
    );
    assert.equal(
      homepage.narratives.some((item) =>
        item.evidencePreview.some(
          (evidence) => evidence.id === `integration:observation:old:${suffix}`
        )
      ),
      false
    );
  }
);

async function cleanupNarrativeFixture(suffix: string) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from narrative_review_events where observation_key like $1`,
      [`%${suffix}`]
    );
    await client.query(`delete from documents where id = any($1::text[])`, [
      [
        `integration:document:${suffix}`,
        `integration:document:old:${suffix}`
      ]
    ]);
    await client.query(
      `delete from narrative_trends
       where prompt_version in ('integration-v1', 'integration-v2')`
    );
    await client.query(
      `delete from sources
       where id = 'integration-news'
         and not exists (
           select 1 from documents where source_id = 'integration-news'
         )`
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

test(
  "registers and disables a managed publication feed",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const created = await createPublicationFeed({
      name: `Integration Publication ${suffix}`,
      homepageUrl: `https://${suffix}.example.com/`,
      feedUrl: `https://${suffix}.example.com/feed`,
      platform: "rss",
      publisherOwner: "Integration Publisher",
      termsNotes: "Public integration fixture."
    });
    assert.equal(created.enabled, true);

    const enabled = await listPublicationFeeds(
      { enabledOnly: true },
      process.env.DATABASE_URL
    );
    assert(enabled.some((feed) => feed.id === created.id));

    await setPublicationFeedEnabled(created.id, false, process.env.DATABASE_URL);
    const afterDisable = await listPublicationFeeds(
      { enabledOnly: true },
      process.env.DATABASE_URL
    );
    assert.equal(afterDisable.some((feed) => feed.id === created.id), false);
  }
);

test(
  "upgrades a cached Substack preview after authenticated full-text retrieval",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const documentId = `publication:example:${suffix}`;
    const preview = await persistDocuments([
      {
        id: documentId,
        sourceId: `publication:example:${suffix}`,
        sourceClass: "newspaper",
        title: `Preview upgrade ${suffix}`,
        publisher: "Example Letter",
        publisherId: "example-letter",
        publisherOwner: "example-author",
        url: `https://example.substack.com/p/upgrade-${suffix}`,
        canonicalUrl: `https://example.substack.com/p/upgrade-${suffix}`,
        publishedAt: "2026-08-27T12:00:00.000Z",
        tickers: [],
        summary: "Preview only",
        body: "This is a truncated preview; full subscriber content was not available.",
        retrievalMethod: "api",
        retentionPolicy: "full_text",
        metadata: {
          platform: "substack",
          content: "preview",
          substackSlug: `upgrade-${suffix}`
        }
      }
    ]);
    assert.equal(preview.insertedDocuments, 1);

    const upgraded = await persistDocuments([
      {
        id: documentId,
        sourceId: `publication:example:${suffix}`,
        sourceClass: "newspaper",
        title: `Preview upgrade ${suffix}`,
        publisher: "Example Letter",
        publisherId: "example-letter",
        publisherOwner: "example-author",
        url: `https://example.substack.com/p/upgrade-${suffix}`,
        canonicalUrl: `https://example.substack.com/p/upgrade-${suffix}`,
        publishedAt: "2026-08-27T12:00:00.000Z",
        tickers: [],
        summary: "Full subscriber argument",
        body: `Authenticated full subscriber body for ${suffix}. `.repeat(8),
        retrievalMethod: "credentialed",
        retentionPolicy: "full_text",
        metadata: {
          platform: "substack",
          content: "full",
          substackSlug: `upgrade-${suffix}`
        }
      }
    ]);
    assert.equal(upgraded.insertedDocuments, 1);
    assert.ok(upgraded.insertedChunks >= 1);
  }
);
