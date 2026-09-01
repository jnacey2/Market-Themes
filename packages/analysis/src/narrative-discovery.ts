import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming
} from "@anthropic-ai/sdk/resources/messages";
import type {
  AnalysisDocument,
  NarrativeCandidateContext,
  NarrativeCandidateInput,
  NarrativeDefinition,
  ToneDirection
} from "@market-themes/db";
import {
  narrativeDiscoveryPromptVersion,
  narrativeDiscoverySystemPrompt
} from "./prompts";
import {
  narrativeDiscoveryOutputFormat,
  parseStructuredOutput
} from "./structured-output";
import { logAnthropicUsage } from "./anthropic-usage";

export const narrativeCandidateAnalysisType = "narrative_candidate_discovery";

type RawCandidate = {
  clusterKey?: unknown;
  name?: unknown;
  proposition?: unknown;
  category?: unknown;
  inclusionGuidance?: unknown;
  exclusionGuidance?: unknown;
  candidateKind?: unknown;
  eventLabel?: unknown;
  stance?: unknown;
  riskTone?: unknown;
  bullishTone?: unknown;
  matchScore?: unknown;
  affectedEntities?: unknown;
  evidenceSnippet?: unknown;
  interpretation?: unknown;
};

export type NarrativeDiscoveryOptions = {
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  maxTokens?: number;
  maxDocumentChars?: number;
  maxEvidenceChars?: number;
  signal?: AbortSignal;
};

export async function discoverNarrativeCandidates(
  document: AnalysisDocument,
  trackedNarratives: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  options: NarrativeDiscoveryOptions = {}
): Promise<NarrativeCandidateInput[]> {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION ??
    narrativeDiscoveryPromptVersion;
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  const request = buildNarrativeDiscoveryRequest(
    document,
    trackedNarratives,
    existingCandidates,
    {
      model,
      maxTokens: options.maxTokens,
      maxDocumentChars: options.maxDocumentChars
    }
  );
  const message = await client.messages.create(
    request,
    options.signal ? { signal: options.signal } : undefined
  );
  logAnthropicUsage("narrative-discovery", model, message.usage);
  return normalizeNarrativeDiscoveryMessage(
    message,
    document,
    trackedNarratives,
    existingCandidates,
    {
      model,
      promptVersion,
      maxEvidenceChars: options.maxEvidenceChars ?? 800
    }
  );
}

export function buildNarrativeDiscoveryRequest(
  document: AnalysisDocument,
  trackedNarratives: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  options: {
    model: string;
    maxTokens?: number;
    maxDocumentChars?: number;
  }
): MessageCreateParamsNonStreaming {
  const maxDocumentChars = options.maxDocumentChars ?? 120_000;
  return {
    model: options.model,
    max_tokens: options.maxTokens ?? 4_000,
    system: narrativeDiscoverySystemPrompt,
    output_config: { format: narrativeDiscoveryOutputFormat },
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          document: {
            id: document.id,
            sourceId: document.sourceId,
            sourceClass: document.sourceClass,
            title: document.title,
            publisher: document.publisher,
            publishedAt: document.publishedAt,
            tickers: document.tickers,
            text: document.text.slice(0, maxDocumentChars)
          },
          trackedNarratives: trackedNarratives.map((narrative) => ({
            slug: narrative.slug,
            name: narrative.name,
            proposition: narrative.proposition
          })),
          existingCandidates: existingCandidates.slice(0, 100)
        })
      }
    ]
  };
}

export function normalizeNarrativeDiscoveryMessage(
  message: Message,
  document: AnalysisDocument,
  trackedNarratives: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars?: number;
  }
) {
  return normalizeNarrativeDiscoveryResponse(
    parseStructuredOutput(message, "Narrative discovery"),
    document,
    trackedNarratives,
    existingCandidates,
    options
  );
}

export function normalizeNarrativeDiscoveryResponse(
  parsed: unknown,
  document: AnalysisDocument,
  trackedNarratives: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars?: number;
  }
): NarrativeCandidateInput[] {
  if (!isObject(parsed) || !Array.isArray(parsed.candidates)) {
    throw new Error("Narrative discovery JSON must include a candidates array.");
  }
  const trackedSlugs = new Set(trackedNarratives.map((narrative) => narrative.slug));
  const existingByKey = new Map(
    existingCandidates.map((candidate) => [
      slugifyCandidateKey(candidate.clusterKey),
      candidate
    ])
  );
  const maxEvidenceChars = options.maxEvidenceChars ?? 800;
  const byClusterKey = new Map<string, NarrativeCandidateInput>();

  for (const value of parsed.candidates.slice(0, 3)) {
    const candidate = normalizeCandidate(
      value,
      document,
      trackedSlugs,
      trackedNarratives,
      existingCandidates,
      existingByKey,
      {
        ...options,
        maxEvidenceChars
      }
    );
    if (!candidate) continue;

    const prior = byClusterKey.get(candidate.clusterKey);
    if (
      !prior ||
      candidate.evidence[0].matchScore > prior.evidence[0].matchScore
    ) {
      byClusterKey.set(candidate.clusterKey, candidate);
    }
  }

  return [...byClusterKey.values()];
}

export function slugifyCandidateKey(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "emerging-narrative";
}

function normalizeCandidate(
  value: unknown,
  document: AnalysisDocument,
  trackedSlugs: Set<string>,
  trackedNarratives: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  existingByKey: Map<string, NarrativeCandidateContext>,
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars: number;
  }
): NarrativeCandidateInput | null {
  if (!isObject(value)) return null;
  const raw = value as RawCandidate;
  const name = cleanString(raw.name, 80);
  const proposition = cleanString(raw.proposition, 500);
  const evidenceSnippet = cleanString(raw.evidenceSnippet, options.maxEvidenceChars);
  const matchScore = score(raw.matchScore);
  if (!name || !proposition || !evidenceSnippet || matchScore < 75) return null;
  if (!containsSnippet(document.text, evidenceSnippet)) return null;

  const requestedKey = slugifyCandidateKey(
    cleanString(raw.clusterKey, 80) || name
  );
  if (
    trackedSlugs.has(requestedKey) ||
    trackedNarratives.some((narrative) =>
      descriptionsOverlap(
        name,
        proposition,
        narrative.name,
        narrative.proposition
      )
    )
  ) {
    return null;
  }
  const existing =
    existingByKey.get(requestedKey) ??
    existingCandidates.find((candidate) =>
      descriptionsOverlap(
        name,
        proposition,
        candidate.name,
        candidate.proposition
      )
    );
  const clusterKey = existing?.clusterKey ?? requestedKey;
  const kind = raw.candidateKind === "event" ? "event" : "structural";
  const eventLabel =
    kind === "event" ? cleanString(raw.eventLabel, 160) : null;
  if (kind === "event" && !eventLabel) return null;
  const candidateId = `narrative:candidate:${createHash("sha256")
    .update(`${options.promptVersion}:${clusterKey}`)
    .digest("hex")
    .slice(0, 32)}`;
  const evidenceId = `narrative:candidate:evidence:${createHash("sha256")
    .update(`${candidateId}:${document.id}`)
    .digest("hex")
    .slice(0, 32)}`;

  return {
    id: candidateId,
    clusterKey,
    name,
    proposition,
    category: candidateCategory(raw.category),
    inclusionGuidance:
      cleanString(raw.inclusionGuidance, 500) ||
      `Include direct evidence supporting: ${proposition}`,
    exclusionGuidance:
      cleanString(raw.exclusionGuidance, 500) ||
      "Exclude generic topic mentions and isolated events without a directional signal.",
    kind,
    eventLabel,
    model: options.model,
    promptVersion: options.promptVersion,
    metadata: {
      sourceId: document.sourceId,
      sourceClass: document.sourceClass
    },
    evidence: [
      {
        id: evidenceId,
        documentId: document.id,
        evidenceSnippet,
        interpretation: cleanString(raw.interpretation, 1_000),
        stance: tone(raw.stance),
        riskTone: score(raw.riskTone),
        bullishTone: score(raw.bullishTone),
        affectedEntities: stringArray(raw.affectedEntities).slice(0, 20),
        matchScore,
        model: options.model,
        promptVersion: options.promptVersion,
        metadata: { textHash: document.textHash }
      }
    ]
  };
}

function cleanString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function score(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 100) : 0;
}

function tone(value: unknown): ToneDirection {
  return ["risk", "bullish", "mixed", "neutral"].includes(String(value))
    ? (value as ToneDirection)
    : "neutral";
}

function candidateCategory(value: unknown) {
  const category = cleanString(value, 60);
  return [
    "Technology",
    "Consumer",
    "Credit",
    "Financials",
    "Energy",
    "Capital Markets",
    "Cross-sector",
    "Macro",
    "Other"
  ].includes(category)
    ? category
    : "Other";
}

function containsSnippet(text: string, snippet: string) {
  return text.includes(snippet);
}

function descriptionsOverlap(
  leftName: string,
  leftProposition: string,
  rightName: string,
  rightProposition: string
) {
  return (
    tokenSimilarity(leftName, rightName) >= 0.74 ||
    tokenSimilarity(leftProposition, rightProposition) >= 0.72
  );
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = meaningfulTokens(left);
  const rightTokens = meaningfulTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function meaningfulTokens(value: string) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "because",
    "for",
    "from",
    "is",
    "of",
    "or",
    "the",
    "to"
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !stopWords.has(token))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
