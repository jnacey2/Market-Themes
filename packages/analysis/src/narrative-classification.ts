import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
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

export const narrativeClassificationPromptVersion = "narrative_classification_v6";

type RawObservation = {
  narrativeDefinitionId?: string;
  matched?: boolean;
  matchScore?: number;
  stance?: string;
  riskTone?: number;
  bullishTone?: number;
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
  const sourceText = document.text.slice(0, options.maxDocumentChars ?? 120_000);
  const promptCaching =
    options.promptCaching ??
    process.env.ANTHROPIC_PROMPT_CACHING !== "false";
  const message = await client.messages.create(
    {
      model,
      max_tokens: options.maxTokens ?? 4_000,
      system: `Classify a source document against stable market-narrative propositions.
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
Every returned observation must use matched=true, matchScore 70-100, and an
evidenceSnippet copied exactly from the source. Return an empty observations array
when no definitions match. When uncertain, omit the definition. Do not make trade recommendations.
Stance is risk, bullish, mixed, or neutral.`,
      output_config: { format: narrativeClassificationOutputFormat },
      messages: [
        {
          role: "user",
          content: buildNarrativeClassificationContent(
            document,
            definitions,
            sourceText,
            promptCaching
          )
        }
      ]
    },
    options.signal ? { signal: options.signal } : undefined
  );
  logAnthropicUsage("narrative-classification", model, message.usage);
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
  promptCaching = true
) {
  const referenceText = JSON.stringify({
    definitions: definitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      proposition: definition.proposition,
      inclusionGuidance: definition.inclusionGuidance,
      exclusionGuidance: definition.exclusionGuidance,
      positiveExamples: definition.positiveExamples,
      negativeExamples: definition.negativeExamples
    }))
  });
  const referenceBlock = promptCaching
    ? {
        type: "text" as const,
        text: referenceText,
        cache_control: { type: "ephemeral" as const }
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
  const requestedMatch = raw?.matched === true && matchScore >= 70;
  const evidence = requestedMatch ? String(raw?.evidenceSnippet ?? "").trim().slice(0, 800) : "";
  const matched =
    requestedMatch &&
    evidence.length > 0 &&
    document.text.includes(evidence) &&
    passesDefinitionGuard(definition.slug, evidence);
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
    metadata: { definitionVersion: definition.version }
  };
}

export function passesDefinitionGuard(slug: string, evidence: string) {
  const text = evidence.toLowerCase();

  switch (slug) {
    case "pricing-power":
      return (
        /(price|pricing|average ticket|mix)/.test(text) &&
        /(demand|volume|transactions?|units?|traffic|elasticity)/.test(text) &&
        !/(declin|decreas|fell|falling|lower|weak).{0,45}(volume|transactions?|units?|traffic)/.test(
          text
        )
      );
    case "deal-activity-recovery":
      return (
        /(pipeline|volumes?|activity|market|advisory|underwriting|issuance|ipos?|m&a)/.test(
          text
        ) && /(recover|rebound|reopen|improv|increas|accelerat|growth|stronger|higher)/.test(text)
      );
    case "ai-infrastructure-demand":
      return (
        /(artificial intelligence|\bai\b)/.test(text) &&
        (
          /\b(demand|capacity|backlog|orders|load)\b/.test(text) ||
          /infrastructure.{0,35}(invest|spend|build|deploy|expand)/.test(text) ||
          /(revenue|sales).{0,25}(grow|increas|up\b)/.test(text) ||
          /(grow|increas|up\b).{0,25}(revenue|sales)/.test(text)
        )
      );
    case "ai-capex-discipline":
      return (
        /(artificial intelligence|\bai\b|data cent(er|re))/.test(text) &&
        /(return|roi|utilization|discipline|restrain|moderat|efficien|budget)/.test(text)
      );
    case "credit-quality-deterioration":
      return (
        /(delinquen|default|charge.?off|loss provision|nonperform|credit quality)/.test(text) &&
        /(deteriorat|worsen|increas|higher|rise|rising|stress)/.test(text)
      );
    case "refinancing-risk":
      return (
        /(borrower|debt|maturit|refinanc)/.test(text) &&
        /(higher|cost|difficult|restrict|wall|pressure|risk)/.test(text) &&
        !/(reinvestment risk|callable note)/.test(text)
      );
    case "margin-pressure":
      return (
        /(gross margin|operating margin|profit margin)/.test(text) &&
        /(compress|pressure|declin|decreas|lower|contract)/.test(text)
      );
    case "consumer-trade-down":
      return (
        /(consumer|customer|shopper|spending|purchase)/.test(text) &&
        /(trade.?down|value|afford|lower.?price|smaller|cautious|budget|selective)/.test(text)
      );
    case "supply-chain-normalization":
      return (
        /(supply|inventory|lead time|freight|logistics|availability)/.test(text) &&
        /(normaliz|easing|shorter|improv|recover|rebalanc|declin)/.test(text) &&
        !/(disruption|shortage|constraint|ransomware)/.test(text)
      );
    case "energy-demand-growth":
      return (
        /(demand|load|consumption)/.test(text) &&
        /(accelerat|expand|growth|increas|higher|record|rising)/.test(text) &&
        /(economic|industrial|electrif|electric vehicle|data cent(er|re)|artificial intelligence|\bai\b)/.test(
          text
        ) &&
        !/(weather|temperature|summer|winter|heat wave|cold snap|cooling degree|heating degree)/.test(
          text
        )
      );
    default:
      return true;
  }
}

function clamp(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, minimum), maximum) : minimum;
}

function isStance(value: unknown): value is ToneDirection {
  return ["risk", "bullish", "mixed", "neutral"].includes(String(value));
}
