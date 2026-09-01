import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  CandidatePromotionValidation,
  CandidatePromotionValidationInput
} from "@market-themes/db";
import {
  candidatePromotionValidationPromptVersion,
  candidatePromotionValidationSystemPrompt
} from "./prompts";
import {
  candidatePromotionValidationOutputFormat,
  parseStructuredOutput
} from "./structured-output";

type PreparedEvidence =
  CandidatePromotionValidationInput["evidence"][number] & {
    localContext: string;
    storyFingerprint: string;
  };

type RawValidation = {
  candidateKind?: unknown;
  eventLabel?: unknown;
  promotionDecision?: unknown;
  summaryReason?: unknown;
  evidence?: unknown;
};

type RawEvidenceVerdict = {
  evidenceId?: unknown;
  supportsProposition?: unknown;
  violatesExclusion?: unknown;
  verdict?: unknown;
  eventKey?: unknown;
  primaryEntityKey?: unknown;
  reason?: unknown;
};

export type CandidatePromotionValidationOptions = {
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  maxEvidenceItems?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export async function validateCandidateForPromotion(
  input: CandidatePromotionValidationInput,
  options: CandidatePromotionValidationOptions = {}
): Promise<CandidatePromotionValidation> {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-sonnet-4-5-20250929";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_PROMOTION_VALIDATION_PROMPT_VERSION ??
    candidatePromotionValidationPromptVersion;
  const prepared = prepareCandidateEvidence(
    input.evidence,
    options.maxEvidenceItems ??
      Number(process.env.NARRATIVE_PROMOTION_VALIDATION_MAX_EVIDENCE ?? 10)
  );
  if (prepared.length === 0) {
    return ineligibleWithoutModel(
      input,
      model,
      promptVersion,
      "NO_UNIQUE_EVIDENCE",
      "No unique evidence remained after media-echo deduplication."
    );
  }

  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  const message = await client.messages.create(
    {
      model,
      max_tokens:
        options.maxTokens ??
        Number(process.env.NARRATIVE_PROMOTION_VALIDATION_MAX_TOKENS ?? 2_500),
      system: candidatePromotionValidationSystemPrompt,
      output_config: { format: candidatePromotionValidationOutputFormat },
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            candidate: input.candidate,
            requiredSupport: input.policy,
            evidence: prepared.map((evidence) => ({
              evidenceId: evidence.evidenceId,
              documentId: evidence.documentId,
              title: evidence.title,
              publisher: evidence.publisher,
              publisherOwner: evidence.publisherOwner,
              sourceClass: evidence.sourceClass,
              publishedAt: evidence.publishedAt,
              tickers: evidence.tickers,
              affectedEntities: evidence.affectedEntities,
              matchScore: evidence.matchScore,
              evidenceSnippet: evidence.evidenceSnippet,
              localContext: evidence.localContext,
              interpretation: evidence.interpretation
            }))
          })
        }
      ]
    },
    options.signal ? { signal: options.signal } : undefined
  );
  const raw = parseStructuredOutput<RawValidation>(
    message,
    "Candidate promotion validation"
  );
  return normalizeCandidatePromotionValidation(
    raw,
    input,
    prepared,
    model,
    promptVersion
  );
}

export function prepareCandidateEvidence(
  evidence: CandidatePromotionValidationInput["evidence"],
  maximumItems = 10
) {
  const seenSnippets = new Set<string>();
  const seenTitles = new Set<string>();
  const seenNearDuplicates = new Set<string>();
  const prepared: PreparedEvidence[] = [];
  const sorted = [...evidence].sort(
    (left, right) =>
      right.matchScore - left.matchScore ||
      right.publishedAt.localeCompare(left.publishedAt) ||
      left.evidenceId.localeCompare(right.evidenceId)
  );

  for (const item of sorted) {
    const snippetKey = normalizeText(item.evidenceSnippet);
    const titleKey = normalizeText(item.title);
    const nearDuplicateKey = item.nearDuplicateKey?.trim() ?? "";
    if (
      !snippetKey ||
      seenSnippets.has(snippetKey) ||
      seenTitles.has(titleKey) ||
      (nearDuplicateKey && seenNearDuplicates.has(nearDuplicateKey))
    ) {
      continue;
    }
    seenSnippets.add(snippetKey);
    seenTitles.add(titleKey);
    if (nearDuplicateKey) seenNearDuplicates.add(nearDuplicateKey);
    prepared.push({
      ...item,
      localContext: localContext(item.currentText, item.evidenceSnippet),
      storyFingerprint:
        nearDuplicateKey ||
        hash(`${titleKey}:${createHash("sha256").update(snippetKey).digest("hex")}`)
    });
    if (prepared.length >= maximumItems) break;
  }
  return prepared;
}

export function normalizeCandidatePromotionValidation(
  raw: RawValidation,
  input: CandidatePromotionValidationInput,
  prepared: PreparedEvidence[],
  model: string,
  promptVersion: string
): CandidatePromotionValidation {
  if (!raw || !Array.isArray(raw.evidence)) {
    throw new Error("Candidate promotion validation omitted evidence verdicts.");
  }
  const preparedById = new Map(
    prepared.map((evidence) => [evidence.evidenceId, evidence])
  );
  const rawEvidence = raw.evidence as RawEvidenceVerdict[];
  const returnedIds = new Set<string>();
  const evidence = rawEvidence.map((verdict) => {
    const evidenceId =
      typeof verdict.evidenceId === "string" ? verdict.evidenceId : "";
    const source = preparedById.get(evidenceId);
    if (!source || returnedIds.has(evidenceId)) {
      throw new Error("Candidate promotion validation returned an invalid evidence id.");
    }
    returnedIds.add(evidenceId);
    const supports = verdict.supportsProposition === true;
    const violates = verdict.violatesExclusion === true;
    const isSupport =
      supports && !violates && verdict.verdict === "support";
    return {
      evidenceId,
      documentId: source.documentId,
      verdict: isSupport ? ("support" as const) : ("reject" as const),
      reason: cleanString(verdict.reason, 300) || "No validation reason returned.",
      eventKey: optionalKey(verdict.eventKey),
      primaryEntityKey: optionalKey(verdict.primaryEntityKey),
      storyFingerprint: source.storyFingerprint,
      sourceTextHash: source.sourceTextHash
    };
  });
  if (
    returnedIds.size !== prepared.length ||
    prepared.some((item) => !returnedIds.has(item.evidenceId))
  ) {
    throw new Error("Candidate promotion validation did not adjudicate every evidence item.");
  }

  const supported = evidence.filter((item) => item.verdict === "support");
  const supportedSource = supported.map(
    (item) => preparedById.get(item.evidenceId)!
  );
  const candidateKind =
    raw.candidateKind === "event" ? "event" : "structural";
  const eventLabel =
    candidateKind === "event" ? cleanString(raw.eventLabel, 160) || null : null;
  const eventKeys = new Set(
    supported.map((item) => item.eventKey).filter(Boolean)
  );
  const entityKeys = new Set(
    supported.map((item) => item.primaryEntityKey).filter(Boolean)
  );
  const storyKeys = new Set(supported.map((item) => item.storyFingerprint));
  const publisherOwners = new Set(
    supportedSource
      .map((item) => normalizeText(item.publisherOwner))
      .filter(Boolean)
  );
  const sourceClasses = new Set(
    supportedSource.map((item) => item.sourceClass)
  );
  const reasons: string[] = [];
  if (raw.promotionDecision !== "approve") {
    reasons.push(
      raw.promotionDecision === "manual_review"
        ? "VALIDATOR_REQUIRES_MANUAL_REVIEW"
        : "VALIDATOR_REJECTED"
    );
  }
  if (storyKeys.size < input.policy.minimumDocuments) {
    reasons.push("INSUFFICIENT_UNIQUE_STORIES");
  }
  if (publisherOwners.size < input.policy.minimumPublisherOwners) {
    reasons.push("INSUFFICIENT_PUBLISHER_OWNERS");
  }
  if (supported.some((item) => !item.eventKey)) {
    reasons.push("MISSING_EVENT_KEYS");
  }
  if (supported.some((item) => !item.primaryEntityKey)) {
    reasons.push("MISSING_PRIMARY_ENTITY_KEYS");
  }
  if (candidateKind === "event") {
    if (!eventLabel) reasons.push("EVENT_LABEL_REQUIRED");
    if (eventKeys.size !== 1) reasons.push("EVENT_KEY_MUST_BE_SINGULAR");
  } else {
    if (eventKeys.size < 2 && entityKeys.size < 2) {
      reasons.push("STRUCTURAL_REQUIRES_MULTIPLE_EVENTS_OR_ENTITIES");
    }
    if (sourceClasses.size < 2 && eventKeys.size < 2) {
      reasons.push("STRUCTURAL_REQUIRES_SOURCE_OR_EVENT_BREADTH");
    }
  }
  if (
    /single[- ]company/i.test(input.candidate.exclusionGuidance) &&
    entityKeys.size < 2
  ) {
    reasons.push("SINGLE_COMPANY_EXCLUSION_VIOLATED");
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    candidateId: input.candidate.id,
    status:
      uniqueReasons.length === 0
        ? "eligible"
        : raw.promotionDecision === "manual_review"
          ? "manual_review"
          : "ineligible",
    candidateKind,
    eventLabel,
    summaryReason:
      cleanString(raw.summaryReason, 500) ||
      (uniqueReasons.length === 0
        ? "Candidate passed promotion validation."
        : "Candidate did not pass promotion validation."),
    reasons: uniqueReasons,
    supportedEvidenceIds: supported.map((item) => item.evidenceId),
    breadth: {
      storyBreadth: storyKeys.size,
      eventBreadth: eventKeys.size,
      primaryEntityBreadth: entityKeys.size,
      publisherOwnerBreadth: publisherOwners.size,
      sourceClassBreadth: sourceClasses.size
    },
    evidence,
    promptVersion,
    model,
    evaluatedAt: new Date().toISOString()
  };
}

function ineligibleWithoutModel(
  input: CandidatePromotionValidationInput,
  model: string,
  promptVersion: string,
  reason: string,
  summaryReason: string
): CandidatePromotionValidation {
  return {
    candidateId: input.candidate.id,
    status: "ineligible",
    candidateKind: "structural",
    eventLabel: null,
    summaryReason,
    reasons: [reason],
    supportedEvidenceIds: [],
    breadth: {
      storyBreadth: 0,
      eventBreadth: 0,
      primaryEntityBreadth: 0,
      publisherOwnerBreadth: 0,
      sourceClassBreadth: 0
    },
    evidence: [],
    promptVersion,
    model,
    evaluatedAt: new Date().toISOString()
  };
}

function localContext(text: string, snippet: string) {
  const index = text.indexOf(snippet);
  if (index < 0) return snippet;
  return text.slice(
    Math.max(0, index - 180),
    Math.min(text.length, index + snippet.length + 180)
  );
}

function optionalKey(value: unknown) {
  const cleaned = cleanString(value, 100);
  return cleaned ? slugify(cleaned) : null;
}

function cleanString(value: unknown, maximumLength: number) {
  return typeof value === "string"
    ? value.trim().slice(0, maximumLength)
    : "";
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-").slice(0, 100);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
