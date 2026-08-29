import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  claimDocumentsForNarrativeDiscovery,
  completeNarrativeDiscoveryRun,
  createDatabaseClient,
  getNarrativeBoardStatus,
  getNarrativeCandidateQueue,
  getOperationsStatus,
  mergeNarrativeCandidate,
  persistDocuments,
  promoteNarrativeCandidate,
  recomputeNarrativeTrends,
  startDocumentAnalysisRun,
  type NarrativeCandidateInput,
  type SourceClass
} from "./index";

const discoveryPromptVersion = "integration-discovery-v1";
const classificationPromptVersion = "integration-classification-v1";
const model = "integration-model";
const narrativeCandidateAnalysisType = "narrative_candidate_discovery";

test(
  "discovers, breadth-gates, promotes, recomputes, and reloads a narrative",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupCandidateFixtures(suffix));
    const clusterKey = `software-vendor-consolidation-${suffix}`;
    const candidateId = `narrative:candidate:${suffix}`;
    const firstDocumentId = `candidate:document:first:${suffix}`;
    const secondDocumentId = `candidate:document:second:${suffix}`;
    const firstQuote =
      "Customers are consolidating software vendors to reduce overlapping subscription costs.";
    const secondQuote =
      "CIOs are cutting redundant applications and standardizing on fewer strategic software providers.";

    await persistFixtureDocument({
      id: firstDocumentId,
      suffix,
      sourceId: `candidate-news:${suffix}`,
      sourceClass: "newspaper",
      publisher: "Candidate News",
      publisherOwner: `candidate-news-owner:${suffix}`,
      quote: firstQuote
    });
    await persistFixtureDocument({
      id: secondDocumentId,
      suffix,
      sourceId: `candidate-transcript:${suffix}`,
      sourceClass: "transcript",
      publisher: "Candidate Research",
      publisherOwner: `candidate-research-owner:${suffix}`,
      quote: secondQuote
    });

    const firstRun = await startDiscoveryRun(firstDocumentId);
    const firstResult = await completeNarrativeDiscoveryRun(
      firstRun,
      [
        candidateFixture({
          candidateId,
          clusterKey,
          documentId: firstDocumentId,
          quote: firstQuote
        })
      ]
    );
    assert.equal(firstResult.insertedEvidence, 1);

    const idempotent = await completeNarrativeDiscoveryRun(
      firstRun,
      [
        candidateFixture({
          candidateId,
          clusterKey,
          documentId: firstDocumentId,
          quote: firstQuote
        })
      ]
    );
    assert.equal(idempotent.insertedEvidence, 0);

    const initialQueue = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    const building = initialQueue.candidates.find(
      (candidate) => candidate.id === candidateId
    );
    assert(building);
    assert.equal(building.qualified, false);
    await assert.rejects(
      () =>
        promoteNarrativeCandidate({
          id: candidateId,
          classificationModel: model,
          classificationPromptVersion
        }),
      /independent publisher groups/
    );

    const secondRun = await startDiscoveryRun(secondDocumentId);
    await completeNarrativeDiscoveryRun(secondRun, [
      candidateFixture({
        candidateId,
        clusterKey,
        documentId: secondDocumentId,
        quote: secondQuote
      })
    ]);
    const qualifiedQueue = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    const qualified = qualifiedQueue.candidates.find(
      (candidate) => candidate.id === candidateId
    );
    assert(qualified);
    assert.equal(qualified.qualified, true);
    assert.equal(qualified.publisherOwnerBreadth, 2);

    const promoted = await promoteNarrativeCandidate({
      id: candidateId,
      note: "Two independent sources directly support this candidate.",
      classificationModel: model,
      classificationPromptVersion
    });
    assert.equal(promoted.observationsCreated, 2);

    await recomputeNarrativeTrends({
      asOfDate: "2026-08-29",
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: classificationPromptVersion
    });
    const board = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      classificationPromptVersion
    );
    const narrative = board.narratives.find(
      (item) => item.id === promoted.definitionId
    );
    assert(narrative);
    assert.equal(narrative.matchedDocuments, 2);
    assert.equal(narrative.publisherOwnerBreadth, 2);

    const reloaded = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    const approved = reloaded.candidates.find(
      (candidate) => candidate.id === candidateId
    );
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.promotedDefinitionId, promoted.definitionId);

    const operations = await getOperationsStatus(process.env.DATABASE_URL, {
      analysisModel: model,
      analysisPromptVersion: "integration-signal-v1",
      classificationPromptVersion,
      discoveryPromptVersion,
      discoveryLookbackDays: 30
    });
    const newsTelemetry = operations.sourceTelemetry.find(
      (source) => source.sourceId === `candidate-news:${suffix}`
    );
    assert(newsTelemetry);
    assert.equal(newsTelemetry.documentCount, 1);
    assert.equal(newsTelemetry.narrativeDiscoveryBacklog, 0);
    assert.equal(newsTelemetry.matchedApproved >= 1, true);
    assert.equal(newsTelemetry.narrativeClassificationBacklog >= 1, true);
  }
);

test(
  "flattens candidate merge chains and redirects future evidence",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupCandidateFixtures(suffix));
    const targetId = `narrative:candidate:target:${suffix}`;
    const sourceId = `narrative:candidate:source:${suffix}`;
    const finalId = `narrative:candidate:final:${suffix}`;
    const targetDocumentId = `candidate:merge:target:${suffix}`;
    const sourceDocumentId = `candidate:merge:source:${suffix}`;
    const finalDocumentId = `candidate:merge:final:${suffix}`;
    const followupDocumentId = `candidate:merge:followup:${suffix}`;
    await persistFixtureDocument({
      id: targetDocumentId,
      suffix,
      sourceId: `candidate-merge-a:${suffix}`,
      sourceClass: "newspaper",
      publisher: "Merge Publisher A",
      publisherOwner: `merge-owner-a:${suffix}`,
      quote: "Corporate buyers are consolidating their application portfolios."
    });
    await persistFixtureDocument({
      id: sourceDocumentId,
      suffix,
      sourceId: `candidate-merge-b:${suffix}`,
      sourceClass: "transcript",
      publisher: "Merge Publisher B",
      publisherOwner: `merge-owner-b:${suffix}`,
      quote: "Technology leaders are reducing the number of software vendors they manage."
    });
    await persistFixtureDocument({
      id: finalDocumentId,
      suffix,
      sourceId: `candidate-merge-c:${suffix}`,
      sourceClass: "press_release",
      publisher: "Merge Publisher C",
      publisherOwner: `merge-owner-c:${suffix}`,
      quote: "Procurement teams are retiring redundant applications in favor of strategic platforms."
    });
    await completeNarrativeDiscoveryRun(
      await startDiscoveryRun(targetDocumentId),
      [
        candidateFixture({
          candidateId: targetId,
          clusterKey: `application-portfolio-consolidation-${suffix}`,
          documentId: targetDocumentId,
          quote: "Corporate buyers are consolidating their application portfolios."
        })
      ]
    );
    await completeNarrativeDiscoveryRun(
      await startDiscoveryRun(sourceDocumentId),
      [
        candidateFixture({
          candidateId: sourceId,
          clusterKey: `software-vendor-rationalization-${suffix}`,
          documentId: sourceDocumentId,
          quote: "Technology leaders are reducing the number of software vendors they manage."
        })
      ]
    );
    await completeNarrativeDiscoveryRun(
      await startDiscoveryRun(finalDocumentId),
      [
        candidateFixture({
          candidateId: finalId,
          clusterKey: `strategic-platform-consolidation-${suffix}`,
          documentId: finalDocumentId,
          quote: "Procurement teams are retiring redundant applications in favor of strategic platforms."
        })
      ]
    );

    await mergeNarrativeCandidate({ id: sourceId, targetId });
    await mergeNarrativeCandidate({ id: targetId, targetId: finalId });
    await persistFixtureDocument({
      id: followupDocumentId,
      suffix,
      sourceId: `candidate-merge-d:${suffix}`,
      sourceClass: "government",
      publisher: "Merge Publisher D",
      publisherOwner: `merge-owner-d:${suffix}`,
      quote: "Organizations reported moving overlapping technology contracts to fewer providers."
    });
    await completeNarrativeDiscoveryRun(
      await startDiscoveryRun(followupDocumentId),
      [
        candidateFixture({
          candidateId: sourceId,
          clusterKey: `software-vendor-rationalization-${suffix}`,
          documentId: followupDocumentId,
          quote: "Organizations reported moving overlapping technology contracts to fewer providers."
        })
      ]
    );
    const queue = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    const target = queue.candidates.find((candidate) => candidate.id === finalId);
    assert.equal(target?.documentBreadth, 4);
    assert.equal(target?.qualified, true);
    assert.equal(queue.mergedCount >= 2, true);
  }
);

test(
  "claims discovery work fairly across source classes without duplicate work",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupCandidateFixtures(suffix));
    await Promise.all([
      persistFixtureDocument({
        id: `candidate:claim:news:${suffix}`,
        suffix,
        sourceId: `claim-news:${suffix}`,
        sourceClass: "newspaper",
        publisher: "Claim News",
        publisherOwner: `claim-news-owner:${suffix}`,
        quote: "Enterprise buyers are consolidating overlapping software subscriptions."
      }),
      persistFixtureDocument({
        id: `candidate:claim:transcript:${suffix}`,
        suffix,
        sourceId: `claim-transcript:${suffix}`,
        sourceClass: "transcript",
        publisher: "Claim Transcript",
        publisherOwner: `claim-transcript-owner:${suffix}`,
        quote: "Management expects customers to standardize on fewer software platforms."
      })
    ]);
    const promptVersion = `integration-claim-${suffix}`;
    const claimed = await claimDocumentsForNarrativeDiscovery({
      analysisType: narrativeCandidateAnalysisType,
      model,
      promptVersion,
      limit: 2,
      lookbackDays: 30,
      maxAttempts: 3
    });
    assert.equal(claimed.length, 2);
    assert.equal(new Set(claimed.map((document) => document.sourceClass)).size, 2);

    const duplicateClaim = await claimDocumentsForNarrativeDiscovery({
      analysisType: narrativeCandidateAnalysisType,
      model,
      promptVersion,
      limit: 2,
      lookbackDays: 30,
      maxAttempts: 3
    });
    assert.equal(
      duplicateClaim.some((document) =>
        claimed.some((prior) => prior.id === document.id)
      ),
      false
    );
    await Promise.all(
      [...claimed, ...duplicateClaim].map((document) =>
        completeNarrativeDiscoveryRun(document.analysisRunId, [], {
          attemptToken: document.attemptToken
        })
      )
    );
  }
);

test(
  "reclaims a completed discovery document when full text changes",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupCandidateFixtures(suffix));
    const documentId = `candidate:changed-text:${suffix}`;
    await persistFixtureDocument({
      id: documentId,
      suffix,
      sourceId: `changed-text:${suffix}`,
      sourceClass: "manual",
      publisher: "Changed Text Publisher",
      publisherOwner: `changed-text-owner:${suffix}`,
      quote: "The initial preview did not include the full market argument."
    });
    const promptVersion = `integration-changed-text-${suffix}`;
    const claimOptions = {
      analysisType: narrativeCandidateAnalysisType,
      model,
      promptVersion,
      limit: 25,
      lookbackDays: 30,
      maxAttempts: 3
    };
    const initialClaims = await claimDocumentsForNarrativeDiscovery(claimOptions);
    const initial = initialClaims.find((document) => document.id === documentId);
    assert(initial);
    await completeClaims(initialClaims);

    const updatedText =
      "The full article reports that enterprises are consolidating software vendors.";
    const client = createDatabaseClient();
    await client.connect();
    try {
      await client.query(
        `update document_texts
         set content = $2, content_hash = $3, updated_at = now()
         where document_id = $1`,
        [
          documentId,
          updatedText,
          createHash("sha256").update(updatedText).digest("hex")
        ]
      );
    } finally {
      await client.end();
    }

    const refreshedClaims = await claimDocumentsForNarrativeDiscovery(claimOptions);
    const refreshed = refreshedClaims.find((document) => document.id === documentId);
    assert(refreshed);
    assert.notEqual(refreshed.attemptToken, initial.attemptToken);
    assert.equal(refreshed.text, updatedText);
    await completeClaims(refreshedClaims);
  }
);

async function startDiscoveryRun(documentId: string) {
  return startDocumentAnalysisRun(documentId, {
    analysisType: narrativeCandidateAnalysisType,
    model,
    promptVersion: discoveryPromptVersion
  });
}

async function completeClaims(
  documents: Array<{
    analysisRunId: string;
    attemptToken: string;
  }>
) {
  await Promise.all(
    documents.map((document) =>
      completeNarrativeDiscoveryRun(document.analysisRunId, [], {
        attemptToken: document.attemptToken
      })
    )
  );
}

function candidateFixture({
  candidateId,
  clusterKey,
  documentId,
  quote
}: {
  candidateId: string;
  clusterKey: string;
  documentId: string;
  quote: string;
}): NarrativeCandidateInput {
  return {
    id: candidateId,
    clusterKey,
    name: "Software Vendor Consolidation",
    proposition:
      "Enterprises are reducing software costs by consolidating overlapping vendors.",
    category: "Technology",
    inclusionGuidance:
      "Include explicit reductions in vendors or applications tied to cost control.",
    exclusionGuidance: "Exclude routine renewals and one-off product cancellations.",
    model,
    promptVersion: discoveryPromptVersion,
    evidence: [
      {
        id: `candidate:evidence:${documentId}`,
        documentId,
        evidenceSnippet: quote,
        interpretation: "The source reports active software portfolio consolidation.",
        stance: "risk",
        riskTone: 65,
        bullishTone: 10,
        affectedEntities: ["Enterprise software"],
        matchScore: 90,
        model,
        promptVersion: discoveryPromptVersion
      }
    ]
  };
}

async function persistFixtureDocument({
  id,
  suffix,
  sourceId,
  sourceClass,
  publisher,
  publisherOwner,
  quote
}: {
  id: string;
  suffix: string;
  sourceId: string;
  sourceClass: SourceClass;
  publisher: string;
  publisherOwner: string;
  quote: string;
}) {
  const result = await persistDocuments([
    {
      id,
      sourceId,
      sourceClass,
      title: `Candidate narrative fixture ${id}`,
      publisher,
      publisherId: publisher.toLowerCase().replaceAll(" ", "-"),
      publisherOwner,
      url: `https://example.com/candidates/${suffix}/${encodeURIComponent(id)}`,
      publishedAt: "2026-08-29T12:00:00.000Z",
      tickers: [],
      summary: "Candidate narrative integration fixture.",
      body: `${quote} ${suffix}`,
      retrievalMethod: "api",
      retentionPolicy: "full_text"
    }
  ]);
  assert.equal(result.insertedDocuments, 1);
}

async function cleanupCandidateFixtures(suffix: string) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query("begin");
    const promoted = await client.query<{ promoted_definition_id: string }>(
      `select promoted_definition_id
       from narrative_candidates
       where id like $1 and promoted_definition_id is not null`,
      [`%${suffix}`]
    );
    const definitionIds = promoted.rows.map((row) => row.promoted_definition_id);
    await client.query(`delete from narrative_candidates where id like $1`, [
      `%${suffix}`
    ]);
    await client.query(
      `delete from narrative_trends where prompt_version = $1`,
      [classificationPromptVersion]
    );
    if (definitionIds.length > 0) {
      await client.query(
        `delete from narrative_observations
         where narrative_definition_id = any($1::text[])`,
        [definitionIds]
      );
      await client.query(
        `delete from narrative_definitions where id = any($1::text[])`,
        [definitionIds]
      );
    }
    await client.query(
      `delete from document_analysis_runs where prompt_version like $1`,
      [`%${suffix}%`]
    );
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
