import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AnalysisDocument,
  NarrativeDefinition,
  NarrativeObservationInput,
  ToneDirection
} from "@market-themes/db";

export const narrativeClassificationPromptVersion = "narrative_classification_v3";

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
    maxDocumentChars?: number;
  } = {}
): Promise<NarrativeObservationInput[]> {
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  const client = new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  const sourceText = document.text.slice(0, options.maxDocumentChars ?? 120_000);
  const message = await client.messages.create({
    model,
    max_tokens: 8_000,
    temperature: 0,
    system: `Classify a source document against stable market-narrative propositions.
Return only JSON with an "observations" array containing exactly one item per definition.
Match meaning, not keywords. Apply inclusion and exclusion guidance strictly.
Set matched=true only when the exact quoted evidence directly entails the proposition.
Topic, sector, company, or keyword adjacency is not a match.
Do not infer pricing power from inflation, AI demand from semiconductor adjacency,
credit deterioration from hypothetical policy risk, or broad deal recovery from one transaction.
For directional propositions, contradictory evidence is matched=false, not supporting evidence.
The evidenceSnippet must independently support the match without facts added from elsewhere.
Interpretation may explain the quote but must not introduce facts absent from it.
For matched=false use matchScore 0-69 and empty evidenceSnippet.
For matched=true use matchScore 70-100 and copy evidenceSnippet exactly from the source.
When uncertain, return matched=false. Do not make trade recommendations.
Stance is risk, bullish, mixed, or neutral.`,
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          document: {
            id: document.id,
            title: document.title,
            publisher: document.publisher,
            publishedAt: document.publishedAt,
            text: sourceText
          },
          definitions: definitions.map((definition) => ({
            id: definition.id,
            name: definition.name,
            proposition: definition.proposition,
            inclusionGuidance: definition.inclusionGuidance,
            exclusionGuidance: definition.exclusionGuidance,
            positiveExamples: definition.positiveExamples,
            negativeExamples: definition.negativeExamples
          })),
          outputShape: {
            observations: [
              {
                narrativeDefinitionId: "string",
                matched: true,
                matchScore: 0,
                stance: "risk | bullish | mixed | neutral",
                riskTone: 0,
                bullishTone: 0,
                evidenceSnippet: "exact source quote or empty",
                interpretation: "short sourced interpretation",
                affectedEntities: ["string"]
              }
            ]
          }
        })
      }
    ]
  });
  const response = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const parsed = JSON.parse(response) as { observations?: RawObservation[] };
  const byDefinition = new Map(
    (parsed.observations ?? []).map((observation) => [
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
        /(artificial intelligence|\bai\b|data cent(er|re))/.test(text) &&
        /(demand|capacity|backlog|orders|load|compute|infrastructure|growth)/.test(text)
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
