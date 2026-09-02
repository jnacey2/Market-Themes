import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages";
import type {
  AnalysisDocument,
  NarrativeDefinition,
  NarrativeObservationInput,
  ToneDirection
} from "@market-themes/db";
import {
  narrativeClassificationOutputFormat,
  parseStructuredOutput
} from "./structured-output";
import { logAnthropicUsage } from "./anthropic-usage";

export const narrativeClassificationPromptVersion = "narrative_classification_v7";

export const narrativeClassificationSystemPrompt =
  `Classify a source document against stable market-narrative propositions.
Evaluate every definition, but return observations only for definitions that match.
Omit non-matches; the caller records omitted definitions as matched=false.
Match meaning, not keywords. Apply inclusion and exclusion guidance strictly.
Set matched=true only when the exact quoted evidence directly entails the proposition.
Topic, sector, company, or keyword adjacency is not a match.
Do not infer pricing power from inflation, AI demand from semiconductor adjacency,
credit deterioration from hypothetical policy risk, or broad deal recovery from one transaction.
Do not infer AI-driven demand from data-center adjacency without explicit AI language,
industry maturity, circular financing, or the word "compute" alone. Require a concrete
demand, capacity, backlog, order, load, infrastructure-investment, or revenue-growth fact.
Do not infer structural energy-demand growth from short-term weather-driven consumption.
For directional propositions, contradictory evidence is not supporting evidence; omit the definition.
The evidenceSnippet must independently support the match without facts added from elsewhere.
Interpretation may explain the quote but must not introduce facts absent from it.
Before returning a match, explicitly audit the complete inclusion and exclusion
contract. contractSatisfied is true only when the quotation independently supports
every required causal leg. List the satisfied inclusion criteria and any triggered
exclusions. Never return a match when an exclusion is triggered.
Every returned observation must use matched=true, contractSatisfied=true,
matchScore 70-100, and an evidenceSnippet copied exactly from the source. Return an
empty observations array when no definitions match. When uncertain, omit the definition.
Do not make trade recommendations.
Stance is risk, bullish, mixed, or neutral.`;

type RawObservation = {
  narrativeDefinitionId?: string;
  matched?: boolean;
  matchScore?: number;
  stance?: string;
  riskTone?: number;
  bullishTone?: number;
  contractSatisfied?: boolean;
  inclusionCriteriaSatisfied?: string[];
  exclusionCriteriaTriggered?: string[];
  evidenceSnippet?: string;
  interpretation?: string;
  affectedEntities?: string[];
};

export async function classifyDocumentNarratives(
  document: AnalysisDocument,
  definitions: NarrativeDefinition[],
  options: {
    apiKey?: string;
    model?: string;
    promptVersion?: string;
    maxTokens?: number;
    maxDocumentChars?: number;
    promptCaching?: boolean;
    cacheTtl?: "5m" | "1h";
    signal?: AbortSignal;
  } = {}
): Promise<NarrativeObservationInput[]> {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  const client = new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const promptCaching =
    options.promptCaching ??
    process.env.ANTHROPIC_PROMPT_CACHING !== "false";
  const request = buildNarrativeClassificationRequest(
    document,
    definitions,
    {
      model,
      maxTokens: options.maxTokens,
      maxDocumentChars: options.maxDocumentChars,
      promptCaching,
      cacheTtl: options.cacheTtl
    }
  );
  const message = await client.messages.create(
    request,
    options.signal ? { signal: options.signal } : undefined
  );
  logAnthropicUsage("narrative-classification", model, message.usage);
  return normalizeNarrativeClassificationMessage(
    message,
    document,
    definitions,
    model,
    promptVersion
  );
}

export function buildNarrativeClassificationRequest(
  document: AnalysisDocument,
  definitions: NarrativeDefinition[],
  options: {
    model: string;
    maxTokens?: number;
    maxDocumentChars?: number;
    promptCaching?: boolean;
    cacheTtl?: "5m" | "1h";
  }
): MessageCreateParamsNonStreaming {
  const sourceText = document.text.slice(
    0,
    options.maxDocumentChars ?? 120_000
  );
  return {
    model: options.model,
    max_tokens: options.maxTokens ?? 4_000,
    system: narrativeClassificationSystemPrompt,
    output_config: { format: narrativeClassificationOutputFormat },
    messages: [
      {
        role: "user",
        content: buildNarrativeClassificationContent(
          document,
          definitions,
          sourceText,
          options.promptCaching ?? true,
          options.cacheTtl
        )
      }
    ]
  };
}

export function normalizeNarrativeClassificationMessage(
  message: Message,
  document: AnalysisDocument,
  definitions: NarrativeDefinition[],
  model: string,
  promptVersion: string
) {
  const parsed = parseStructuredOutput<{ observations: RawObservation[] }>(
    message,
    "Narrative classification"
  );
  const byDefinition = new Map(
    (parsed.observations as RawObservation[]).map((observation) => [
      observation.narrativeDefinitionId,
      observation
    ])
  );

  return definitions.map((definition) =>
    normalizeObservation(
      byDefinition.get(definition.id),
      definition,
      document,
      model,
      promptVersion
    )
  );
}

export function buildNarrativeClassificationContent(
  document: AnalysisDocument,
  definitions: NarrativeDefinition[],
  sourceText = document.text,
  promptCaching = true,
  cacheTtl?: "5m" | "1h"
) {
  const referenceText = JSON.stringify({
    definitions: definitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      proposition: definition.proposition,
      inclusionGuidance: definition.inclusionGuidance,
      exclusionGuidance: definition.exclusionGuidance,
      positiveExamples: definition.positiveExamples,
      negativeExamples: definition.negativeExamples,
      evidenceContract: modelFacingEvidenceContract(definition)
    }))
  });
  const referenceBlock = promptCaching
    ? {
        type: "text" as const,
        text: referenceText,
        cache_control: {
          type: "ephemeral" as const,
          ...(cacheTtl ? { ttl: cacheTtl } : {})
        }
      }
    : {
        type: "text" as const,
        text: referenceText
      };

  return [
    referenceBlock,
    {
      type: "text" as const,
      text: JSON.stringify({
        document: {
          id: document.id,
          title: document.title,
          publisher: document.publisher,
          publishedAt: document.publishedAt,
          text: sourceText
        }
      })
    }
  ];
}

export function normalizeObservation(
  raw: RawObservation | undefined,
  definition: NarrativeDefinition,
  document: AnalysisDocument,
  model: string,
  promptVersion: string
): NarrativeObservationInput {
  const matchScore = clamp(raw?.matchScore, 0, 100);
  const exclusionCriteriaTriggered = validateStringArray(
    raw?.exclusionCriteriaTriggered
  );
  const requestedMatch =
    raw?.matched === true &&
    raw.contractSatisfied === true &&
    exclusionCriteriaTriggered.length === 0 &&
    matchScore >= 70;
  const evidence = requestedMatch ? String(raw?.evidenceSnippet ?? "").trim().slice(0, 800) : "";
  const matched =
    requestedMatch &&
    evidence.length > 0 &&
    document.text.includes(evidence) &&
    passesNarrativeEvidenceContract(definition, evidence);
  const stance = isStance(raw?.stance) ? raw.stance : "neutral";

  return {
    id: `narrative:obs:${createHash("sha256")
      .update(`${definition.id}:${document.id}:${model}:${promptVersion}`)
      .digest("hex")
      .slice(0, 32)}`,
    narrativeDefinitionId: definition.id,
    documentId: document.id,
    matched,
    matchScore: matched ? matchScore : Math.min(matchScore, 69),
    stance,
    riskTone: clamp(raw?.riskTone, 0, 100),
    bullishTone: clamp(raw?.bullishTone, 0, 100),
    evidenceSnippet: matched ? evidence : "",
    interpretation: matched ? String(raw?.interpretation ?? "").trim().slice(0, 1_000) : "",
    affectedEntities: Array.isArray(raw?.affectedEntities)
      ? raw.affectedEntities.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 20)
      : [],
    model,
    promptVersion,
    metadata: {
      definitionVersion: definition.version,
      contractValidation: {
        satisfied: raw?.contractSatisfied === true,
        inclusionCriteriaSatisfied: validateStringArray(
          raw?.inclusionCriteriaSatisfied
        ),
        exclusionCriteriaTriggered
      }
    }
  };
}

export type EvidenceGuard = {
  /** Case-insensitive regular expressions; every pattern must match the evidence. */
  requiredPatterns: string[];
  /** Case-insensitive regular expressions; no pattern may match the evidence. */
  forbiddenPatterns: string[];
};

/**
 * Deterministic guards for the seeded propositions. These are the source of truth used
 * to seed `metadata.evidenceContract.requiredPatterns` / `forbiddenPatterns` (migration
 * 021); at runtime the guard is read from each definition's metadata so it can be
 * versioned with the definition instead of hard-coded per slug.
 */
export const SEEDED_EVIDENCE_GUARDS: Record<string, EvidenceGuard> = {
  "pricing-power": {
    requiredPatterns: [
      "(price|pricing|average ticket|mix)",
      "(demand|volume|transactions?|units?|traffic|elasticity)"
    ],
    forbiddenPatterns: [
      "(declin|decreas|fell|falling|lower|weak).{0,45}(volume|transactions?|units?|traffic)"
    ]
  },
  "deal-activity-recovery": {
    requiredPatterns: [
      "(pipeline|volumes?|activity|market|advisory|underwriting|issuance|ipos?|m&a)",
      "(recover|rebound|reopen|improv|increas|accelerat|growth|stronger|higher)"
    ],
    forbiddenPatterns: []
  },
  "ai-infrastructure-demand": {
    requiredPatterns: [
      "(artificial intelligence|\\bai\\b)",
      "\\b(demand|capacity|backlog|orders|load)\\b|infrastructure.{0,35}(invest|spend|build|deploy|expand)|(revenue|sales).{0,25}(grow|increas|up\\b)|(grow|increas|up\\b).{0,25}(revenue|sales)"
    ],
    forbiddenPatterns: []
  },
  "ai-capex-discipline": {
    requiredPatterns: [
      "(artificial intelligence|\\bai\\b|data cent(er|re))",
      "(return|roi|utilization|discipline|restrain|moderat|efficien|budget)"
    ],
    forbiddenPatterns: []
  },
  "credit-quality-deterioration": {
    requiredPatterns: [
      "(delinquen|default|charge.?off|loss provision|nonperform|credit quality)",
      "(deteriorat|worsen|increas|higher|rise|rising|stress)"
    ],
    forbiddenPatterns: []
  },
  "refinancing-risk": {
    requiredPatterns: [
      "(borrower|debt|maturit|refinanc)",
      "(higher|cost|difficult|restrict|wall|pressure|risk)"
    ],
    forbiddenPatterns: ["(reinvestment risk|callable note)"]
  },
  "margin-pressure": {
    requiredPatterns: [
      "(gross margin|operating margin|profit margin)",
      "(compress|pressure|declin|decreas|lower|contract)"
    ],
    forbiddenPatterns: []
  },
  "consumer-trade-down": {
    requiredPatterns: [
      "(consumer|customer|shopper|spending|purchase)",
      "(trade.?down|value|afford|lower.?price|smaller|cautious|budget|selective)"
    ],
    forbiddenPatterns: []
  },
  "supply-chain-normalization": {
    requiredPatterns: [
      "(supply|inventory|lead time|freight|logistics|availability)",
      "(normaliz|easing|shorter|improv|recover|rebalanc|declin)"
    ],
    forbiddenPatterns: ["(disruption|shortage|constraint|ransomware)"]
  },
  "energy-demand-growth": {
    requiredPatterns: [
      "(demand|load|consumption)",
      "(accelerat|expand|growth|increas|higher|record|rising)",
      "(economic|industrial|electrif|electric vehicle|data cent(er|re)|artificial intelligence|\\bai\\b)"
    ],
    forbiddenPatterns: [
      "(weather|temperature|summer|winter|heat wave|cold snap|cooling degree|heating degree)"
    ]
  }
};

export function passesNarrativeEvidenceContract(
  definition: NarrativeDefinition,
  evidence: string
) {
  const contract = definition.metadata?.evidenceContract;
  if (!passesDefinitionGuard(readEvidenceGuard(contract), evidence)) return false;
  if (!isObject(contract)) return true;
  const groups = contract.requiredTermGroups;
  if (!Array.isArray(groups)) return true;
  const normalizedEvidence = normalizeForComparison(evidence);
  return groups.every(
    (group) =>
      Array.isArray(group) &&
      group.some(
        (term) =>
          typeof term === "string" &&
          normalizedEvidence.includes(normalizeForComparison(term))
      )
  );
}

export function readEvidenceGuard(contract: unknown): EvidenceGuard | null {
  if (!isObject(contract)) return null;
  const requiredPatterns = validateStringArray(contract.requiredPatterns);
  const forbiddenPatterns = validateStringArray(contract.forbiddenPatterns);
  if (requiredPatterns.length === 0 && forbiddenPatterns.length === 0) return null;
  return { requiredPatterns, forbiddenPatterns };
}

const patternCache = new Map<string, RegExp | null>();

function compileGuardPattern(source: string) {
  const cached = patternCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(source, "i");
  } catch {
    compiled = null;
  }
  patternCache.set(source, compiled);
  return compiled;
}

/**
 * Applies a definition's deterministic evidence guard. Invalid patterns are ignored rather
 * than failing classification, so a typo in metadata degrades to "no guard" for that pattern.
 */
export function passesDefinitionGuard(
  guard: EvidenceGuard | null | undefined,
  evidence: string
) {
  if (!guard) return true;
  const required = guard.requiredPatterns
    .map(compileGuardPattern)
    .filter((pattern): pattern is RegExp => pattern !== null);
  const forbidden = guard.forbiddenPatterns
    .map(compileGuardPattern)
    .filter((pattern): pattern is RegExp => pattern !== null);
  return (
    required.every((pattern) => pattern.test(evidence)) &&
    !forbidden.some((pattern) => pattern.test(evidence))
  );
}

/** The model sees term groups only; regex guards are enforced after the response. */
function modelFacingEvidenceContract(definition: NarrativeDefinition) {
  const contract = definition.metadata?.evidenceContract;
  if (!isObject(contract)) return null;
  const { requiredPatterns: _required, forbiddenPatterns: _forbidden, ...rest } = contract;
  return Object.keys(rest).length === 0 ? null : rest;
}

function clamp(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : minimum;
}

function isStance(value: unknown): value is ToneDirection {
  return ["risk", "bullish", "mixed", "neutral"].includes(String(value));
}

function validateStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
