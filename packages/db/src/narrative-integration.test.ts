import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  getActiveNarrativeDefinitions,
  getNarrativeBoardStatus,
  persistDocuments,
  persistNarrativeObservations,
  recomputeNarrativeTrends
} from "./index";

test(
  "persists, recomputes, and reloads an evidence-backed narrative",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
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

    const recomputed = await recomputeNarrativeTrends({
      asOfDate: "2026-08-27",
      lookbackDays: 10,
      lowHistoryDays: 2
    });
    assert.equal(recomputed.definitionsProcessed, definitions.length);

    const board = await getNarrativeBoardStatus();
    const narrative = board.narratives.find((item) => item.id === definition.id);
    assert(narrative);
    assert.equal(narrative.matchedDocuments, 1);
    assert(narrative.evidence.some((item) => item.id === `integration:observation:${suffix}`));
  }
);
