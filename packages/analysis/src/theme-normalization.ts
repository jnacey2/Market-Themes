import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ThemeGroupForNormalization, ThemeNormalizationMapping } from "@market-themes/db";
import {
  themeNormalizationPromptVersion,
  themeNormalizationSystemPrompt
} from "./prompts";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 12_000;

export type NormalizeThemesOptions = {
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  maxTokens?: number;
};

export async function normalizeThemeGroups(
  groups: ThemeGroupForNormalization[],
  options: NormalizeThemesOptions = {}
): Promise<ThemeNormalizationMapping[]> {
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const promptVersion =
    options.promptVersion ?? process.env.THEME_NORMALIZATION_PROMPT_VERSION ?? themeNormalizationPromptVersion;
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  const message = await client.messages.create({
    model,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: 0,
    system: themeNormalizationSystemPrompt,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ groups }, null, 2)
      }
    ]
  });
  const responseText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return validateMappings(parseJson(responseText), {
    model,
    promptVersion,
    inputThemeIds: new Set(groups.map((group) => group.themeId))
  });
}

export function normalizedThemeId(level: "market" | "sector", label: string, sector?: string | null) {
  const suffix = sector ? `${sector}:${label}` : label;
  return `theme:${level}:${slugify(suffix)}`;
}

function parseJson(responseText: string): unknown {
  const trimmed = responseText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Theme normalization returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function validateMappings(
  parsed: unknown,
  options: {
    model: string;
    promptVersion: string;
    inputThemeIds: Set<string>;
  }
) {
  if (!isRecord(parsed) || !Array.isArray(parsed.mappings)) {
    throw new Error("Theme normalization JSON must include a mappings array.");
  }

  const mappings: ThemeNormalizationMapping[] = [];

  for (const [index, candidate] of parsed.mappings.entries()) {
    if (!isRecord(candidate)) {
      throw new Error(`mappings[${index}] must be an object.`);
    }

    const marketThemeLabel = requiredString(candidate.marketThemeLabel, index, "marketThemeLabel");
    const marketThemeDescription = requiredString(
      candidate.marketThemeDescription,
      index,
      "marketThemeDescription"
    );
    const sector = requiredString(candidate.sector, index, "sector");
    const mappedThemeIds = stringArray(candidate.mappedThemeIds).filter((themeId) =>
      options.inputThemeIds.has(themeId)
    );

    if (mappedThemeIds.length === 0) {
      continue;
    }

    const confidence = score(candidate.confidence, index);
    const confidenceLabel = confidenceLabelFor(candidate.confidenceLabel, confidence);
    const sectorSubthemeLabel = optionalString(candidate.sectorSubthemeLabel);

    mappings.push({
      id: mappingId(mappedThemeIds, options.promptVersion),
      marketThemeId: normalizedThemeId("market", marketThemeLabel),
      marketThemeLabel,
      marketThemeDescription,
      sectorSubthemeId: sectorSubthemeLabel
        ? normalizedThemeId("sector", sectorSubthemeLabel, sector)
        : null,
      sectorSubthemeLabel,
      sectorSubthemeDescription: optionalString(candidate.sectorSubthemeDescription),
      sector,
      mappedThemeIds,
      confidence,
      confidenceLabel,
      rationale: optionalString(candidate.rationale) ?? "",
      status: confidenceLabel === "low" ? "needs_review" : "auto_applied",
      model: options.model,
      promptVersion: options.promptVersion
    });
  }

  return mappings;
}

function requiredString(value: unknown, index: number, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`mappings[${index}].${field} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
}

function score(value: unknown, index: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`mappings[${index}].confidence must be a number from 0 to 100.`);
  }

  return parsed;
}

function confidenceLabelFor(value: unknown, confidence: number): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }

  if (confidence >= 80) {
    return "high";
  }

  if (confidence >= 60) {
    return "medium";
  }

  return "low";
}

function mappingId(themeIds: string[], promptVersion: string) {
  return `mapping:${createHash("sha256")
    .update(`${promptVersion}:${themeIds.sort().join(":")}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "uncategorized";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
