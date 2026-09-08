import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type {
  AnalysisDocument,
  NarrativeDefinition,
  NarrativeObservationInput,
  ToneDirection
} from "@market-themes/db";

export const narrativeClassificationPromptVersion =
  "narrative_classification_v6";

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
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<NarrativeObservationInput[]> {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-sonnet-4-5-20250929";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  if (!definitions.length) return [];
  if (!document.text.trim())
    throw new Error("Cannot classify an empty document.");
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
    fetch: options.fetchImpl
  });
  const sectionSize = options.maxDocumentChars ?? 120_000;
  if (!Number.isInteger(sectionSize) || sectionSize < 100)
    throw new Error("Section size must be at least 100 characters.");
  const sections: string[] = [];
  const overlap = Math.min(1_000, Math.floor(sectionSize / 10));
  for (
    let offset = 0;
    offset < document.text.length;
    offset += sectionSize - overlap
  ) {
    sections.push(document.text.slice(offset, offset + sectionSize));
    if (offset + sectionSize >= document.text.length) break;
  }
  if (sections.length > 50)
    throw new Error(
      "Document exceeds the 50-section analysis budget; split it before classification."
    );
  const merged = new Map<string, NarrativeObservationInput>();
  let inputTokens = 0;
  let outputTokens = 0;
  for (const sourceText of sections) {
    options.signal?.throwIfAborted();
    const message = await client.messages.create(
      {
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
Do not infer AI-driven demand from data-center adjacency without explicit AI language,
industry maturity, circular financing, or the word "compute" alone. Require a concrete
demand, capacity, backlog, order, load, infrastructure-investment, or revenue-growth fact.
Do not infer structural energy-demand growth from short-term weather-driven consumption.
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
      },
      { signal: options.signal }
    );
    inputTokens += message.usage.input_tokens;
    outputTokens += message.usage.output_tokens;
    if (message.stop_reason !== "end_turn")
      throw new Error(
        `Incomplete classification response: ${message.stop_reason}`
      );
    const response = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const parsed = validateNarrativeResponse(JSON.parse(response), definitions);
    for (const raw of parsed) {
      if (raw.matched && !sourceText.includes(raw.evidenceSnippet!)) {
        throw new Error(
          "Classification quote was not present in the examined section."
        );
      }
      const definition = definitions.find(
        (item) => item.id === raw.narrativeDefinitionId
      )!;
      const observation = normalizeObservation(
        raw,
        definition,
        document,
        model,
        promptVersion
      );
      const previous = merged.get(definition.id);
      if (
        !previous ||
        (observation.matched &&
          (!previous.matched || observation.matchScore > previous.matchScore))
      ) {
        merged.set(definition.id, observation);
      }
    }
  }
  return definitions.map((definition) => {
    const observation = merged.get(definition.id)!;
    return {
      ...observation,
      metadata: {
        ...observation.metadata,
        textHash: document.textHash,
        examinedCharacters: document.text.length,
        sections: sections.length,
        complete: true,
        inputTokens,
        outputTokens
      }
    };
  });
}

export function validateNarrativeResponse(
  value: unknown,
  definitions: NarrativeDefinition[]
): RawObservation[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("observations" in value) ||
    !Array.isArray(value.observations)
  ) {
    throw new Error(
      "Classification response must contain an observations array."
    );
  }
  const expected = new Set(definitions.map((definition) => definition.id));
  const seen = new Set<string>();
  if (value.observations.length !== expected.size)
    throw new Error(
      "Classification response has missing or extra observations."
    );
  for (const item of value.observations) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.narrativeDefinitionId !== "string" ||
      !expected.has(item.narrativeDefinitionId) ||
      seen.has(item.narrativeDefinitionId)
    ) {
      throw new Error(
        "Classification response has unknown or duplicate definition IDs."
      );
    }
    seen.add(item.narrativeDefinitionId);
    if (
      typeof item.matched !== "boolean" ||
      !isStance(item.stance) ||
      typeof item.evidenceSnippet !== "string" ||
      typeof item.interpretation !== "string" ||
      !Array.isArray(item.affectedEntities) ||
      !item.affectedEntities.every(
        (entity: unknown) => typeof entity === "string"
      ) ||
      ![item.matchScore, item.riskTone, item.bullishTone].every(
        (score) =>
          typeof score === "number" &&
          Number.isFinite(score) &&
          score >= 0 &&
          score <= 100
      ) ||
      (item.matched
        ? item.matchScore < 70 ||
          !item.evidenceSnippet.trim() ||
          item.evidenceSnippet.length > 800
        : item.matchScore >= 70 || item.evidenceSnippet !== "")
    ) {
      throw new Error("Classification observation has invalid fields.");
    }
  }
  return value.observations as RawObservation[];
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
