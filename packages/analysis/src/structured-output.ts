import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

const score = { type: "number", minimum: 0, maximum: 100 } as const;
const stringArray = {
  type: "array",
  items: { type: "string" }
} as const;

export function requireStructuredOutput<T>(
  message: { parsed_output: T | null; stop_reason: string | null },
  operation: string
) {
  if (message.stop_reason !== "end_turn") {
    throw new Error(
      `${operation} stopped before completing structured output: ${
        message.stop_reason ?? "unknown"
      }.`
    );
  }
  if (!message.parsed_output) {
    throw new Error(`${operation} returned no structured output.`);
  }
  return message.parsed_output;
}

export const signalExtractionOutputFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rawThemeLabel: { type: "string" },
          canonicalThemeLabel: { type: "string" },
          themeDescription: { type: "string" },
          stance: {
            type: "string",
            enum: ["risk", "bullish", "mixed", "neutral"]
          },
          riskTone: score,
          bullishTone: score,
          confidence: score,
          affectedEntities: stringArray,
          evidenceSnippet: { type: "string" },
          interpretation: { type: "string" },
          sectionLabel: { type: ["string", "null"] },
          speaker: { type: ["string", "null"] }
        },
        required: [
          "rawThemeLabel",
          "canonicalThemeLabel",
          "themeDescription",
          "stance",
          "riskTone",
          "bullishTone",
          "confidence",
          "affectedEntities",
          "evidenceSnippet",
          "interpretation",
          "sectionLabel",
          "speaker"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["signals"],
  additionalProperties: false
} as const);

export const narrativeClassificationOutputFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          narrativeDefinitionId: { type: "string" },
          matched: { type: "boolean" },
          matchScore: score,
          stance: {
            type: "string",
            enum: ["risk", "bullish", "mixed", "neutral"]
          },
          riskTone: score,
          bullishTone: score,
          evidenceSnippet: { type: "string" },
          interpretation: { type: "string" },
          affectedEntities: stringArray
        },
        required: [
          "narrativeDefinitionId",
          "matched",
          "matchScore",
          "stance",
          "riskTone",
          "bullishTone",
          "evidenceSnippet",
          "interpretation",
          "affectedEntities"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["observations"],
  additionalProperties: false
} as const);

export const narrativeDiscoveryOutputFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          clusterKey: { type: "string" },
          name: { type: "string" },
          proposition: { type: "string" },
          category: {
            type: "string",
            enum: [
              "Technology",
              "Consumer",
              "Credit",
              "Financials",
              "Energy",
              "Capital Markets",
              "Cross-sector",
              "Macro",
              "Other"
            ]
          },
          inclusionGuidance: { type: "string" },
          exclusionGuidance: { type: "string" },
          stance: {
            type: "string",
            enum: ["risk", "bullish", "mixed", "neutral"]
          },
          riskTone: score,
          bullishTone: score,
          matchScore: score,
          affectedEntities: stringArray,
          evidenceSnippet: { type: "string" },
          interpretation: { type: "string" }
        },
        required: [
          "clusterKey",
          "name",
          "proposition",
          "category",
          "inclusionGuidance",
          "exclusionGuidance",
          "stance",
          "riskTone",
          "bullishTone",
          "matchScore",
          "affectedEntities",
          "evidenceSnippet",
          "interpretation"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["candidates"],
  additionalProperties: false
} as const);

export const themeNormalizationOutputFormat = jsonSchemaOutputFormat({
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          marketThemeLabel: { type: "string" },
          marketThemeDescription: { type: "string" },
          sectorSubthemeLabel: { type: ["string", "null"] },
          sectorSubthemeDescription: { type: ["string", "null"] },
          sector: {
            type: "string",
            enum: [
              "Technology",
              "Communication Services",
              "Consumer Discretionary",
              "Consumer Staples",
              "Health Care",
              "Financials",
              "Industrials",
              "Energy",
              "Materials",
              "Utilities",
              "Real Estate",
              "Macro",
              "Cross-sector",
              "Other"
            ]
          },
          mappedThemeIds: stringArray,
          confidence: score,
          confidenceLabel: {
            type: "string",
            enum: ["high", "medium", "low"]
          },
          rationale: { type: "string" }
        },
        required: [
          "marketThemeLabel",
          "marketThemeDescription",
          "sectorSubthemeLabel",
          "sectorSubthemeDescription",
          "sector",
          "mappedThemeIds",
          "confidence",
          "confidenceLabel",
          "rationale"
        ],
        additionalProperties: false
      }
    }
  },
  required: ["mappings"],
  additionalProperties: false
} as const);
