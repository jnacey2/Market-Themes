import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  autoPromoteNarrativeCandidates,
  claimDocumentsForNarrativeDiscovery,
  completeNarrativeDiscoveryRun,
  createDatabaseClient,
  getNarrativeBoardStatus,
  getNarrativeCandidateQueue,
  getNarrativeReviewQueue,
  getOperationsStatus,
  mergeNarrativeCandidate,
  persistDocuments,
  persistNarrativeObservations,
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
  "auto-promotes only strongly corroborated candidate evidence",
  { skip: !process.env.DATABASE_URL },
  async (context) => {
    const suffix = randomUUID();
    context.after(() => cleanupCandidateFixtures(suffix));
    const candidateId = `narrative:candidate:auto:${suffix}`;
    const clusterKey = `autonomous-software-consolidation-${suffix}`;
    const evidence = [
      {
        id: `candidate:auto:news:${suffix}`,
        sourceId: `candidate-auto-news:${suffix}`,
        sourceClass: "newspaper" as const,
        publisher: "Auto Publisher A",
        publisherOwner: `auto-owner-a:${suffix}`,
        quote: "Enterprises are retiring overlapping software tools to reduce costs."
      },
      {
        id: `candidate:auto:filing:${suffix}`,
        sourceId: `candidate-auto-filing:${suffix}`,
        sourceClass: "filing" as const,
        publisher: "Auto Publisher B",
        publisherOwner: `auto-owner-b:${suffix}`,
        quote: "Customers are consolidating application portfolios onto fewer platforms."
      },
      {
        id: `candidate:auto:transcript:${suffix}`,
        sourceId: `candidate-auto-transcript:${suffix}`,
        sourceClass: "transcript" as const,
        publisher: "Auto Publisher C",
        publisherOwner: `auto-owner-c:${suffix}`,
        quote: "Technology budgets are shifting from point products to integrated suites."
      },
      {
        id: `candidate:auto:low-score:${suffix}`,
        sourceId: `candidate-auto-low:${suffix}`,
        sourceClass: "newspaper" as const,
        publisher: "Auto Publisher D",
        publisherOwner: `auto-owner-d:${suffix}`,
        quote: "A fourth source discussed software consolidation with lower confidence.",
        matchScore: 85
      }
    ];
    for (const item of evidence) {
      await persistFixtureDocument({
        id: item.id,
        suffix,
        sourceId: item.sourceId,
        sourceClass: item.sourceClass,
        publisher: item.publisher,
        publisherOwner: item.publisherOwner,
        quote: item.quote,
        publishedAt: new Date().toISOString()
      });
      await completeNarrativeDiscoveryRun(
        await startDiscoveryRun(item.id),
        [
          candidateFixture({
            candidateId,
            clusterKey,
            documentId: item.id,
            quote: item.quote,
            matchScore: item.matchScore,
            textHash: fixtureTextHash(item.quote, suffix)
          })
        ]
      );
    }

    const weakCandidateId = `narrative:candidate:auto-weak:${suffix}`;
    for (const index of [1, 2, 3]) {
      const documentId = `candidate:auto:weak-${index}:${suffix}`;
      const quote = `Weak candidate evidence ${index} has only two independent sources.`;
      await persistFixtureDocument({
        id: documentId,
        suffix,
        sourceId: `candidate-auto-weak-${index}:${suffix}`,
        sourceClass: "newspaper",
        publisher: `Weak Publisher ${index}`,
        publisherOwner: `weak-owner-${index}:${suffix}`,
        quote,
        publishedAt: new Date().toISOString(),
        metadata: index === 3 ? { content: "preview" } : {}
      });
      await completeNarrativeDiscoveryRun(
        await startDiscoveryRun(documentId),
        [
          candidateFixture({
            candidateId: weakCandidateId,
            clusterKey: `weak-autonomous-candidate-${suffix}`,
            documentId,
            quote,
            textHash: fixtureTextHash(quote, suffix)
          })
        ]
      );
    }

    const sameOwnerCandidateId = `narrative:candidate:auto-same-owner:${suffix}`;
    const ownerVariants = [
      `Shared Owner ${suffix}`,
      ` shared owner ${suffix} `,
      `SHARED OWNER ${suffix}`
    ];
    for (const [index, publisherOwner] of ownerVariants.entries()) {
      const documentId = `candidate:auto:same-owner-${index}:${suffix}`;
      const quote = `Same-owner candidate evidence ${index} must not inflate breadth.`;
      await persistFixtureDocument({
        id: documentId,
        suffix,
        sourceId: `candidate-auto-same-owner-${index}:${suffix}`,
        sourceClass: "newspaper",
        publisher: `Same Owner Publisher ${index}`,
        publisherOwner,
        quote,
        publishedAt: new Date().toISOString()
      });
      await completeNarrativeDiscoveryRun(
        await startDiscoveryRun(documentId),
        [
          candidateFixture({
            candidateId: sameOwnerCandidateId,
            clusterKey: `same-owner-autonomous-candidate-${suffix}`,
            documentId,
            quote,
            textHash: fixtureTextHash(quote, suffix)
          })
        ]
      );
    }

    const staleCandidateId = `narrative:candidate:auto-stale:${suffix}`;
    const staleDocumentIds: string[] = [];
    for (const index of [1, 2, 3]) {
      const documentId = `candidate:auto:stale-${index}:${suffix}`;
      const quote = `Stale-text candidate evidence ${index} initially supports the proposition.`;
      staleDocumentIds.push(documentId);
      await persistFixtureDocument({
        id: documentId,
        suffix,
        sourceId: `candidate-auto-stale-${index}:${suffix}`,
        sourceClass: "newspaper",
        publisher: `Stale Publisher ${index}`,
        publisherOwner: `stale-owner-${index}:${suffix}`,
        quote,
        publishedAt: new Date().toISOString()
      });
      await completeNarrativeDiscoveryRun(
        await startDiscoveryRun(documentId),
        [
          candidateFixture({
            candidateId: staleCandidateId,
            clusterKey: `stale-autonomous-candidate-${suffix}`,
            documentId,
            quote,
            textHash: fixtureTextHash(quote, suffix)
          })
        ]
      );
    }
    const staleText = "The upgraded source no longer contains the prior evidence.";
    const staleClient = createDatabaseClient();
    await staleClient.connect();
    try {
      await staleClient.query(
        `update document_texts
         set content = $2, content_hash = $3, updated_at = now()
         where document_id = $1`,
        [
          staleDocumentIds[2],
          staleText,
          createHash("sha256").update(staleText).digest("hex")
        ]
      );
    } finally {
      await staleClient.end();
    }

    const autoClassificationPrompt = `integration-auto-promotion:${suffix}`;
    const result = await autoPromoteNarrativeCandidates({
      discoveryPromptVersion,
      classificationModel: model,
      classificationPromptVersion: autoClassificationPrompt,
      minimumMatchScore: 90,
      minimumDocuments: 3,
      minimumPublisherOwners: 3,
      evidenceWindowDays: 7,
      excludedPublisherOwners: ["youtube", "youtube.com", "youtu.be"],
      limit: 5
    });
    assert.equal(result.candidatesEvaluated, 1);
    assert.equal(result.candidatesPromoted, 1);
    assert.equal(result.observationsCreated, 3);
    assert.equal(result.failedCandidates.length, 0);
    await assert.rejects(
      () =>
        promoteNarrativeCandidate({
          id: weakCandidateId,
          classificationModel: model,
          classificationPromptVersion: autoClassificationPrompt,
          minimumDocuments: 1,
          minimumPublisherOwners: 1,
          evidenceWindowDays: 7,
          reviewActorType: "automatic",
          automaticPolicy: {
            minimumMatchScore: 0,
            minimumDocuments: 1,
            minimumPublisherOwners: 1,
            evidenceWindowDays: 7,
            excludedPublisherOwners: ["youtube", "youtube.com", "youtu.be"]
          }
        }),
      /independent publisher groups/
    );
    await assert.rejects(
      () =>
        promoteNarrativeCandidate({
          id: staleCandidateId,
          classificationModel: model,
          classificationPromptVersion: autoClassificationPrompt,
          reviewActorType: "automatic",
          automaticPolicy: {
            minimumMatchScore: 90,
            minimumDocuments: 3,
            minimumPublisherOwners: 3,
            evidenceWindowDays: 7,
            excludedPublisherOwners: ["youtube", "youtube.com", "youtu.be"]
          }
        }),
      /independent publisher groups/
    );

    const queue = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    const promoted = queue.candidates.find(
      (candidate) => candidate.id === candidateId
    );
    const weak = queue.candidates.find(
      (candidate) => candidate.id === weakCandidateId
    );
    const sameOwner = queue.candidates.find(
      (candidate) => candidate.id === sameOwnerCandidateId
    );
    const stale = queue.candidates.find(
      (candidate) => candidate.id === staleCandidateId
    );
    assert.equal(promoted?.status, "approved");
    assert.equal(weak?.status, "pending");
    assert.equal(sameOwner?.status, "pending");
    assert.equal(stale?.status, "pending");

    await recomputeNarrativeTrends({
      asOfDate: new Date().toISOString().slice(0, 10),
      lookbackDays: 10,
      lowHistoryDays: 2,
      promptVersion: autoClassificationPrompt
    });
    const board = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      autoClassificationPrompt
    );
    const narrative = board.narratives.find(
      (item) => item.id === result.promotedDefinitionIds[0]
    );
    assert.equal(narrative?.matchedDocuments, 3);
    assert.equal(narrative?.publisherOwnerBreadth, 3);

    const client = createDatabaseClient();
    await client.connect();
    try {
      const audit = await client.query<{
        observation_count: string;
        event_count: string;
        automatic_provenance_count: string;
        complete_audit_count: string;
      }>(
        `select
           (select count(*)::text
              from narrative_observations
              where narrative_definition_id = $1) as observation_count,
           (select count(*)::text
              from narrative_review_events
              where actor_type = 'automatic'
                and metadata->>'action' = 'candidate_promotion'
                and metadata->>'candidateId' = $2) as event_count,
           (select count(*)::text
              from narrative_observations
              where narrative_definition_id = $1
                and metadata->'reviewProvenance'->>'actorType' = 'automatic')
             as automatic_provenance_count,
           (select count(*)::text
              from narrative_review_events
              where actor_type = 'automatic'
                and metadata->>'candidateId' = $2
                and metadata->'reviewProvenance'->>'promotedDefinitionId' = $1
                and jsonb_array_length(
                  metadata->'reviewProvenance'->'qualifyingEvidence'
                ) = 3) as complete_audit_count`,
        [result.promotedDefinitionIds[0], candidateId]
      );
      assert.equal(Number(audit.rows[0].observation_count), 3);
      assert.equal(Number(audit.rows[0].event_count), 3);
      assert.equal(Number(audit.rows[0].automatic_provenance_count), 3);
      assert.equal(Number(audit.rows[0].complete_audit_count), 3);
    } finally {
      await client.end();
    }

    await persistNarrativeObservations([
      {
        id: `auto-promoted-reclassification:${suffix}`,
        narrativeDefinitionId: result.promotedDefinitionIds[0],
        documentId: evidence[0].id,
        matched: true,
        matchScore: 70,
        stance: "risk",
        riskTone: 60,
        bullishTone: 0,
        evidenceSnippet: evidence[0].quote,
        interpretation: "Reclassified under a later prompt.",
        affectedEntities: [],
        model,
        promptVersion: `${autoClassificationPrompt}:v2`
      }
    ]);
    const inherited = await getNarrativeReviewQueue(
      process.env.DATABASE_URL,
      `${autoClassificationPrompt}:v2`
    );
    assert.equal(
      inherited.items.find(
        (item) => item.id === `auto-promoted-reclassification:${suffix}`
      )?.reviewStatus,
      "pending"
    );
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
  quote,
  matchScore = 90,
  textHash
}: {
  candidateId: string;
  clusterKey: string;
  documentId: string;
  quote: string;
  matchScore?: number;
  textHash?: string;
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
        matchScore,
        model,
        promptVersion: discoveryPromptVersion,
        metadata: textHash ? { textHash } : undefined
      }
    ]
  };
}

function fixtureTextHash(quote: string, suffix: string) {
  return createHash("sha256").update(`${quote} ${suffix}`).digest("hex");
}

async function persistFixtureDocument({
  id,
  suffix,
  sourceId,
  sourceClass,
  publisher,
  publisherOwner,
  quote,
  metadata = {},
  publishedAt = "2026-08-29T12:00:00.000Z",
  url
}: {
  id: string;
  suffix: string;
  sourceId: string;
  sourceClass: SourceClass;
  publisher: string;
  publisherOwner: string;
  quote: string;
  metadata?: Record<string, unknown>;
  publishedAt?: string;
  url?: string;
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
      url:
        url ??
        `https://example.com/candidates/${suffix}/${encodeURIComponent(id)}`,
      publishedAt,
      tickers: [],
      summary: "Candidate narrative integration fixture.",
      body: `${quote} ${suffix}`,
      retrievalMethod: "api",
      retentionPolicy: "full_text",
      metadata
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
        `delete from narrative_trends
         where narrative_definition_id = any($1::text[])`,
        [definitionIds]
      );
      await client.query(
        `delete from narrative_review_events
         where metadata->>'candidateId' like $1`,
        [`%${suffix}`]
      );
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
