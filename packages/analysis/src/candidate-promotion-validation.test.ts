import assert from "node:assert/strict";
import test from "node:test";
import type { CandidatePromotionValidationInput } from "@market-themes/db";
import {
  DEFAULT_PROMOTION_VALIDATION_MODEL,
  normalizeCandidatePromotionValidation,
  prepareCandidateEvidence,
  resolveCandidatePromotionValidationModel
} from "./candidate-promotion-validation";

const baseInput: CandidatePromotionValidationInput = {
  candidate: {
    id: "candidate:test",
    name: "Oil Supply Shock",
    proposition: "A regional conflict is disrupting oil supply.",
    category: "Energy",
    inclusionGuidance: "Include direct conflict-driven supply disruption.",
    exclusionGuidance: "Exclude routine price volatility."
  },
  policy: {
    minimumMatchScore: 90,
    minimumDocuments: 3,
    minimumPublisherOwners: 3,
    evidenceWindowDays: 7,
    excludedPublisherOwners: []
  },
  evidence: [1, 2, 3].map((index) => ({
    evidenceId: `evidence:${index}`,
    documentId: `document:${index}`,
    title: `Independent oil report ${index}`,
    publisher: `Publisher ${index}`,
    publisherOwner: `owner-${index}`,
    sourceClass: "newspaper",
    publishedAt: "2026-09-01T12:00:00.000Z",
    url: `https://example${index}.com/report`,
    tickers: [],
    nearDuplicateKey: `story-${index}`,
    affectedEntities: ["Oil"],
    matchScore: 95,
    evidenceSnippet: `Conflict report ${index} says oil supply is disrupted.`,
    interpretation: "Conflict is affecting supply.",
    currentText: `Context. Conflict report ${index} says oil supply is disrupted. More context.`,
    sourceTextHash: `hash-${index}`
  }))
};

test("uses a dedicated Haiku model without changing the pipeline model", () => {
  assert.equal(
    resolveCandidatePromotionValidationModel(undefined, {
      NARRATIVE_PROMOTION_VALIDATION_MODEL:
        "claude-haiku-4-5-20251001",
      ANTHROPIC_MODEL: "claude-sonnet-4-5-20250929"
    }),
    "claude-haiku-4-5-20251001"
  );
  assert.equal(
    resolveCandidatePromotionValidationModel("explicit-model", {
      NARRATIVE_PROMOTION_VALIDATION_MODEL:
        "claude-haiku-4-5-20251001"
    }),
    "explicit-model"
  );
  assert.equal(
    resolveCandidatePromotionValidationModel(undefined, {}),
    DEFAULT_PROMOTION_VALIDATION_MODEL
  );
});

test("deduplicates syndicated titles and quotations before validation", () => {
  const duplicated = [
    baseInput.evidence[0],
    {
      ...baseInput.evidence[1],
      title: baseInput.evidence[0].title,
      evidenceSnippet: baseInput.evidence[0].evidenceSnippet
    },
    baseInput.evidence[2]
  ];
  const prepared = prepareCandidateEvidence(duplicated);
  assert.equal(prepared.length, 2);
  assert.deepEqual(
    prepared.map((item) => item.evidenceId),
    ["evidence:1", "evidence:3"]
  );
});

test("approves a labelled event supported by unique reports and owners", () => {
  const prepared = prepareCandidateEvidence(baseInput.evidence);
  const result = normalizeCandidatePromotionValidation(
    {
      candidateKind: "event",
      eventLabel: "Regional oil supply disruption",
      promotionDecision: "approve",
      summaryReason: "Three independent reports support one market-moving event.",
      evidence: prepared.map((item) => ({
        evidenceId: item.evidenceId,
        supportsProposition: true,
        violatesExclusion: false,
        verdict: "support",
        eventKey: "regional-oil-conflict",
        primaryEntityKey: "oil",
        reason: "The quote directly reports conflict-driven disruption."
      }))
    },
    baseInput,
    prepared,
    "test-model",
    "validation-v1"
  );
  assert.equal(result.status, "eligible");
  assert.equal(result.candidateKind, "event");
  assert.equal(result.breadth.storyBreadth, 3);
  assert.equal(result.breadth.eventBreadth, 1);
  assert.equal(result.breadth.publisherOwnerBreadth, 3);
});

test("blocks a generalized structural candidate based on one company and event", () => {
  const input: CandidatePromotionValidationInput = {
    ...baseInput,
    candidate: {
      ...baseInput.candidate,
      name: "Fast Fashion IPO Collapse",
      proposition: "Fast-fashion companies are listing far below private valuations.",
      exclusionGuidance:
        "Single-company events without a sector pattern do not qualify."
    }
  };
  const prepared = prepareCandidateEvidence(input.evidence);
  const result = normalizeCandidatePromotionValidation(
    {
      candidateKind: "structural",
      eventLabel: null,
      promotionDecision: "approve",
      summaryReason: "All reports cover one issuer's IPO.",
      evidence: prepared.map((item) => ({
        evidenceId: item.evidenceId,
        supportsProposition: true,
        violatesExclusion: false,
        verdict: "support",
        eventKey: "shein-ipo",
        primaryEntityKey: "shein",
        reason: "The quote reports the same Shein IPO."
      }))
    },
    input,
    prepared,
    "test-model",
    "validation-v1"
  );
  assert.equal(result.status, "ineligible");
  assert(result.reasons.includes("STRUCTURAL_REQUIRES_MULTIPLE_EVENTS_OR_ENTITIES"));
  assert(result.reasons.includes("SINGLE_COMPANY_EXCLUSION_VIOLATED"));
});

test("fails closed when adjudication omits or invents evidence ids", () => {
  const prepared = prepareCandidateEvidence(baseInput.evidence);
  assert.throws(
    () =>
      normalizeCandidatePromotionValidation(
        {
          candidateKind: "event",
          eventLabel: "Oil event",
          promotionDecision: "approve",
          summaryReason: "",
          evidence: [
            {
              evidenceId: "unknown",
              supportsProposition: true,
              violatesExclusion: false,
              verdict: "support",
              eventKey: "oil-event",
              primaryEntityKey: "oil",
              reason: ""
            }
          ]
        },
        baseInput,
        prepared,
        "test-model",
        "validation-v1"
      ),
    /invalid evidence id/
  );
});
