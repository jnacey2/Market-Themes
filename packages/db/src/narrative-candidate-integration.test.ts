import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  autoApproveNarrativeObservations,
  autoPromoteNarrativeCandidates,
  claimDocumentsForNarrativeDiscovery,
  completeNarrativeDiscoveryRun,
  createDatabaseClient,
  getNarrativeBoardStatus,
  getNarrativeHomepageStatus,
  getCandidatePromotionValidationInput,
  getNarrativeCandidateQueue,
  getNarrativeReviewQueue,
  getOperationsStatus,
  mergeNarrativeCandidate,
  evidenceCollisionThreshold,
  markValidationAsDuplicate,
  narrativeDescriptionsOverlap,
  NarrativeCandidateDuplicateError,
  persistDocuments,
  persistNarrativeObservations,
  promoteNarrativeCandidate,
  reconcileNarrativeDefinitionLifecycle,
  recomputeNarrativeTrends,
  retractNarrativeDefinition,
  selectDocumentsForNarrativeClassification,
  startDocumentAnalysisRun,
  type NarrativeCandidateInput,
  type CandidatePromotionValidation,
  type CandidatePromotionValidationInput,
  type SourceClass
} from "./index";

const discoveryPromptVersion = "integration-discovery-v1";
const classificationPromptVersion = "integration-classification-v1";
const model = "integration-model";
const narrativeCandidateAnalysisType = "narrative_candidate_discovery";

test("detects semantically overlapping tracked narratives", () => {
  assert.equal(
    narrativeDescriptionsOverlap(
      "Oil Shock Inflation Path",
      "Higher oil prices are reviving inflation fears and rate hike bets.",
      "Energy Shock Reprices Inflation And Rates",
      "Rising energy prices lift inflation expectations and reprice interest rates."
    ),
    true
  );
  assert.equal(
    narrativeDescriptionsOverlap(
      "Oil Supply Disruption",
      "Conflict is reducing tanker traffic through a key shipping route.",
      "Consumer Trade-Down",
      "Consumers are choosing lower-priced products under budget pressure."
    ),
    false
  );
});

test("a name that repeats another's core tokens with extra qualifiers is a duplicate", () => {
  assert.equal(
    narrativeDescriptionsOverlap(
      "US-Iran Hormuz Escalation September 2026 Week",
      "US-Iran military strikes resumed at the start of the week following weeks of relative calm, creating acute geopolitical escalation risk that threatens Strait of Hormuz energy supply and is repricing bond markets higher.",
      "US-Iran Hormuz Escalation Oil Price Shock",
      "Intensified US-Iran fighting over the Strait of Hormuz is triggering renewed oil price spikes and extending market expectations for prolonged conflict, creating acute geopolitical energy supply disruption risk."
    ),
    true,
    "shared core tokens (us, iran, hormuz, escalation) outweigh differing qualifiers"
  );
  assert.equal(
    narrativeDescriptionsOverlap(
      "Energy Demand Growth",
      "Electricity, natural-gas, or fuel demand is accelerating because of economic activity, electrification, or data-center load.",
      "Energy Shock Drives Cross-Asset Repricing",
      "An energy-price shock is simultaneously pushing sovereign yields higher and pressuring equities or other rate-sensitive assets."
    ),
    false,
    "one shared sector word is not enough"
  );
  assert.equal(evidenceCollisionThreshold(2), 3);
  assert.equal(evidenceCollisionThreshold(3), 3);
  assert.equal(evidenceCollisionThreshold(5), 4);
  assert.equal(evidenceCollisionThreshold(10), 7);
});

test("a duplicate collision parks the validation for manual review", () => {
  const validation: CandidatePromotionValidation = {
    candidateId: "narrative:candidate:dup",
    status: "eligible",
    candidateKind: "structural",
    eventLabel: null,
    summaryReason: "Validator approved.",
    reasons: ["Three corroborating stories."],
    supportedEvidenceIds: ["e1", "e2", "e3"],
    breadth: {
      storyBreadth: 3,
      eventBreadth: 1,
      primaryEntityBreadth: 1,
      publisherOwnerBreadth: 3,
      sourceClassBreadth: 1
    },
    evidence: [],
    promptVersion: "validation-v1",
    model: "validator",
    evaluatedAt: "2026-09-04T00:00:00.000Z"
  };
  const error = new NarrativeCandidateDuplicateError(
    'Candidate evidence already supports tracked narrative "Amazon Advertising Antitrust Risk" (narrative:def:amazon:v1): 3 of 4 qualifying documents are matched to it; merge or refine instead of creating another definition.',
    {
      kind: "evidence",
      definitionId: "narrative:def:amazon:v1",
      name: "Amazon Advertising Antitrust Risk"
    }
  );
  const now = new Date("2026-09-05T08:00:00.000Z");
  const parked = markValidationAsDuplicate(validation, error, now);
  assert.equal(parked.status, "manual_review");
  assert.equal(parked.evaluatedAt, now.toISOString());
  assert.match(parked.summaryReason, /Duplicate of tracked narrative "Amazon Advertising Antitrust Risk"/);
  assert.match(parked.summaryReason, /evidence match/);
  assert.equal(parked.reasons.length, 2);
  assert.equal(parked.reasons[0], "Three corroborating stories.");
  assert.deepEqual(parked.supportedEvidenceIds, validation.supportedEvidenceIds);
  // Idempotent: re-parking does not stack the same reason.
  assert.equal(markValidationAsDuplicate(parked, error, now).reasons.length, 2);
  // The original validation is not mutated.
  assert.equal(validation.status, "eligible");
});

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
      /unique stories|publisher groups/
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
    assert.equal(qualified.storyBreadth, 2);
    assert.equal(qualified.publisherOwnerBreadth, 2);
    const manualValidationInput = await getCandidatePromotionValidationInput(
      candidateId,
      {
        minimumMatchScore: 75,
        minimumDocuments: 2,
        minimumPublisherOwners: 2,
        evidenceWindowDays: 30,
        excludedPublisherOwners: []
      },
      process.env.DATABASE_URL,
      "manual"
    );
    assert(manualValidationInput);

    const promoted = await promoteNarrativeCandidate({
      id: candidateId,
      note: "Two independent sources directly support this candidate.",
      classificationModel: model,
      classificationPromptVersion,
      promotionValidation: eligibleValidation(manualValidationInput)
    });
    assert.equal(promoted.observationsCreated, 2);
    const seedReclassification = await selectDocumentsForNarrativeClassification({
      model,
      promptVersion: classificationPromptVersion,
      limit: 100,
      lookbackDays: 365
    });
    assert(
      seedReclassification.some((item) => item.id === firstDocumentId)
    );
    assert(
      seedReclassification.some((item) => item.id === secondDocumentId)
    );
    await persistNarrativeObservations(
      [
        { documentId: firstDocumentId, quote: firstQuote },
        { documentId: secondDocumentId, quote: secondQuote }
      ].map((item, index) => ({
        id: `candidate:reclassified:${index}:${suffix}`,
        narrativeDefinitionId: promoted.definitionId,
        documentId: item.documentId,
        matched: true,
        matchScore: 95,
        stance: "neutral" as const,
        riskTone: 20,
        bullishTone: 20,
        evidenceSnippet: item.quote,
        interpretation: "Fresh classification confirms the full contract.",
        affectedEntities: [],
        model,
        promptVersion: classificationPromptVersion,
        metadata: contractValidationMetadata()
      }))
    );
    await autoApproveNarrativeObservations({
      model,
      promptVersion: classificationPromptVersion,
      minimumMatchScore: 90,
      minimumDocuments: 2,
      minimumPublisherOwners: 2,
      lookbackDays: 30,
      excludedPublisherOwners: []
    });
    const lifecycle = await reconcileNarrativeDefinitionLifecycle({
      model,
      promptVersion: classificationPromptVersion,
      minimumStories: 2,
      minimumPublisherOwners: 2,
      lookbackDays: 30
    });
    assert.equal(lifecycle.activatedDefinitions, 1);

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
    const autoPolicy = {
      minimumMatchScore: 90,
      minimumDocuments: 3,
      minimumPublisherOwners: 3,
      evidenceWindowDays: 7,
      excludedPublisherOwners: ["youtube", "youtube.com", "youtu.be"]
    };
    const autoPromotionOptions = {
      discoveryPromptVersion,
      classificationModel: model,
      classificationPromptVersion: autoClassificationPrompt,
      minimumMatchScore: 90,
      minimumDocuments: 3,
      minimumPublisherOwners: 3,
      evidenceWindowDays: 7,
      excludedPublisherOwners: autoPolicy.excludedPublisherOwners,
      limit: 5
    };
    // All of the strong candidate's evidence was published today: a one-day
    // burst passes breadth but not persistence, so it is held back without
    // spending a validation call.
    let validations = 0;
    const gated = await autoPromoteNarrativeCandidates({
      ...autoPromotionOptions,
      persistencePolicy: {
        minimumSpanDays: 7,
        attachMinimumShare: 0.5,
        attachMinimumDocuments: 2
      },
      validateCandidate: async (input) => {
        validations += 1;
        return eligibleValidation(input);
      }
    });
    assert.equal(gated.candidatesEvaluated, 0);
    assert.equal(gated.candidatesAwaitingPersistence, 1);
    assert.equal(gated.candidatesPromoted, 0);
    assert.equal(validations, 0);

    const result = await autoPromoteNarrativeCandidates({
      ...autoPromotionOptions,
      persistencePolicy: {
        minimumSpanDays: 0,
        attachMinimumShare: 0.5,
        attachMinimumDocuments: 2
      },
      validateCandidate: async (input) => eligibleValidation(input)
    });
    assert.equal(result.candidatesEvaluated, 1);
    assert.equal(result.candidatesPromoted, 1);
    assert.equal(result.observationsCreated, 3);
    assert.equal(result.failedCandidates.length, 0);
    await persistNarrativeObservations(
      evidence.slice(0, 3).map((item, index) => ({
        id: `auto-promoted:fresh-classification:${index}:${suffix}`,
        narrativeDefinitionId: result.promotedDefinitionIds[0],
        documentId: item.id,
        matched: true,
        matchScore: 95,
        stance: "neutral" as const,
        riskTone: 20,
        bullishTone: 20,
        evidenceSnippet: item.quote,
        interpretation: "Fresh classification confirms the full contract.",
        affectedEntities: [],
        model,
        promptVersion: autoClassificationPrompt,
        metadata: contractValidationMetadata()
      }))
    );
    await autoApproveNarrativeObservations({
      model,
      promptVersion: autoClassificationPrompt,
      minimumMatchScore: 90,
      minimumDocuments: 3,
      minimumPublisherOwners: 3,
      lookbackDays: 7,
      excludedPublisherOwners: []
    });
    const lifecycle = await reconcileNarrativeDefinitionLifecycle({
      model,
      promptVersion: autoClassificationPrompt,
      minimumStories: 3,
      minimumPublisherOwners: 3,
      lookbackDays: 7
    });
    assert.equal(lifecycle.activatedDefinitions, 1);
    const weakValidationInput = await getCandidatePromotionValidationInput(
      weakCandidateId,
      autoPolicy
    );
    assert(weakValidationInput);
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
          },
          promotionValidation: eligibleValidation(weakValidationInput)
        }),
      /breadth policy|unique stories|publisher groups/
    );
    const staleValidationInput = await getCandidatePromotionValidationInput(
      staleCandidateId,
      autoPolicy
    );
    assert(staleValidationInput);
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
          },
          promotionValidation: eligibleValidation(staleValidationInput)
        }),
      /breadth policy|unique stories|publisher groups/
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
    assert.equal(sameOwner?.qualified, false);
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
                and metadata->'reviewProvenance'->'automaticPolicy'
                      ->>'minimumDocuments' = '3'
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
    const definitionId = result.promotedDefinitionIds[0];
    await retractNarrativeDefinition({
      id: definitionId,
      reason: "Integration test contract violation."
    });
    const retractedBoard = await getNarrativeBoardStatus(
      process.env.DATABASE_URL,
      autoClassificationPrompt
    );
    assert.equal(
      retractedBoard.narratives.some((item) => item.id === definitionId),
      false
    );
    const retractedHomepage = await getNarrativeHomepageStatus(
      process.env.DATABASE_URL,
      autoClassificationPrompt
    );
    assert.equal(
      retractedHomepage.narratives.some((item) => item.id === definitionId),
      false
    );
    const retractedQueue = await getNarrativeCandidateQueue(
      process.env.DATABASE_URL,
      discoveryPromptVersion
    );
    assert.equal(
      retractedQueue.candidates.find((item) => item.id === candidateId)
        ?.promotedDefinitionStatus,
      "inactive"
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
    const refreshedCandidateId = `narrative:candidate:refreshed:${suffix}`;
    await Promise.all(
      initialClaims.map((document) =>
        completeNarrativeDiscoveryRun(
          document.analysisRunId,
          document.id === documentId
            ? [
                candidateFixture({
                  candidateId: refreshedCandidateId,
                  clusterKey: `refreshed-evidence-${suffix}`,
                  documentId,
                  quote: "The initial preview did not include the full market argument.",
                  textHash: document.textHash
                })
              ]
            : [],
          { attemptToken: document.attemptToken }
        )
      )
    );

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
    await Promise.all(
      refreshedClaims.map((document) =>
        completeNarrativeDiscoveryRun(
          document.analysisRunId,
          document.id === documentId
            ? [
                candidateFixture({
                  candidateId: refreshedCandidateId,
                  clusterKey: `refreshed-evidence-${suffix}`,
                  documentId,
                  quote: updatedText,
                  textHash: document.textHash
                })
              ]
            : [],
          { attemptToken: document.attemptToken }
        )
      )
    );
    const evidenceClient = createDatabaseClient();
    await evidenceClient.connect();
    try {
      const evidence = await evidenceClient.query<{
        evidence_snippet: string;
        text_hash: string;
      }>(
        `select evidence_snippet, metadata->>'textHash' as text_hash
         from narrative_candidate_evidence
         where candidate_id = $1 and document_id = $2`,
        [refreshedCandidateId, documentId]
      );
      assert.equal(evidence.rows[0].evidence_snippet, updatedText);
      assert.equal(evidence.rows[0].text_hash, refreshed.textHash);
    } finally {
      await evidenceClient.end();
    }
  }
);

async function startDiscoveryRun(documentId: string) {
  return startDocumentAnalysisRun(documentId, {
    analysisType: narrativeCandidateAnalysisType,
    model,
    promptVersion: discoveryPromptVersion
  });
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

function contractValidationMetadata() {
  return {
    contractValidation: {
      satisfied: true,
      inclusionCriteriaSatisfied: ["Full proposition"],
      exclusionCriteriaTriggered: []
    }
  };
}

function eligibleValidation(
  input: CandidatePromotionValidationInput
): CandidatePromotionValidation {
  const evidence = input.evidence.map((item, index) => ({
    evidenceId: item.evidenceId,
    documentId: item.documentId,
    verdict: "support" as const,
    reason: "Integration validator confirms direct support.",
    eventKey: `event-${index + 1}`,
    primaryEntityKey: `entity-${index + 1}`,
    storyFingerprint: item.nearDuplicateKey ?? `story-${index + 1}`,
    sourceTextHash: item.sourceTextHash
  }));
  return {
    candidateId: input.candidate.id,
    status: "eligible",
    candidateKind: "structural",
    eventLabel: null,
    summaryReason: "Integration validation passed.",
    reasons: [],
    supportedEvidenceIds: evidence.map((item) => item.evidenceId),
    breadth: {
      storyBreadth: new Set(evidence.map((item) => item.storyFingerprint)).size,
      eventBreadth: new Set(evidence.map((item) => item.eventKey)).size,
      primaryEntityBreadth: new Set(
        evidence.map((item) => item.primaryEntityKey)
      ).size,
      publisherOwnerBreadth: new Set(
        input.evidence.map((item) => item.publisherOwner.trim().toLowerCase())
      ).size,
      sourceClassBreadth: new Set(
        input.evidence.map((item) => item.sourceClass)
      ).size
    },
    evidence,
    promptVersion: "integration-validation-v1",
    model: "integration-validator",
    evaluatedAt: new Date().toISOString()
  };
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
        `delete from narrative_definition_events
         where narrative_definition_id = any($1::text[])`,
        [definitionIds]
      );
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
