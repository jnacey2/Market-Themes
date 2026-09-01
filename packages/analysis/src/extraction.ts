import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisDocument, ExtractedSignalInput, ToneDirection } from "@market-themes/db";
import {
  signalExtractionPromptVersion,
  signalExtractionSystemPrompt
} from "./prompts";
import {
  parseStructuredOutput,
  signalExtractionOutputFormat
} from "./structured-output";
import { logAnthropicUsage } from "./anthropic-usage";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 8_000;
const DEFAULT_MAX_DOCUMENT_CHARS = 120_000;
const DEFAULT_SECTION_CHARS = 60_000;
const DEFAULT_SECTION_OVERLAP = 2_000;
const DEFAULT_MAX_EVIDENCE_CHARS = 800;

export const marketSignalAnalysisType = "market_signal_extraction";

export type ExtractSignalsOptions = {
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  maxTokens?: number;
  maxDocumentChars?: number;
  sectionChars?: number;
  sectionOverlap?: number;
  maxEvidenceChars?: number;
  signal?: AbortSignal;
};

export async function extractSignalsFromDocument(
  document: AnalysisDocument,
  options: ExtractSignalsOptions = {}
): Promise<ExtractedSignalInput[]> {
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const promptVersion =
    options.promptVersion ?? process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion;
  const maxDocumentChars = options.maxDocumentChars ?? DEFAULT_MAX_DOCUMENT_CHARS;

  const sections =
    document.text.length <= maxDocumentChars
      ? [{ label: "Full document", text: document.text }]
      : splitIntoSections(
          document.text,
          options.sectionChars ?? DEFAULT_SECTION_CHARS,
          options.sectionOverlap ?? DEFAULT_SECTION_OVERLAP
        );

  const allSignals: ExtractedSignalInput[] = [];

  for (const section of sections) {
    const signals = await extractSignalsFromText(document, section, {
      ...options,
      model,
      promptVersion
    });
    allSignals.push(...signals);
  }

  return dedupeSignals(allSignals);
}

async function extractSignalsFromText(
  document: AnalysisDocument,
  section: { label: string; text: string },
  options: Required<Pick<ExtractSignalsOptions, "model" | "promptVersion">> &
    ExtractSignalsOptions
) {
  const client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY
  });
  const message = await client.messages.create(
    {
      model: options.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: signalExtractionSystemPrompt,
      output_config: { format: signalExtractionOutputFormat },
      messages: [
        {
          role: "user",
          content: buildUserPrompt(document, section)
        }
      ]
    },
    options.signal ? { signal: options.signal } : undefined
  );
  logAnthropicUsage("signal-extraction", options.model, message.usage);
  const parsed = parseStructuredOutput(message, "Claude extraction");
  const maxEvidenceChars = options.maxEvidenceChars ?? DEFAULT_MAX_EVIDENCE_CHARS;

  return validateSignals(parsed, document, section, {
    model: options.model,
    promptVersion: options.promptVersion,
    maxEvidenceChars
  });
}

function buildUserPrompt(
  document: AnalysisDocument,
  section: { label: string; text: string }
) {
  return JSON.stringify(
    {
      document: {
        id: document.id,
        sourceId: document.sourceId,
        sourceClass: document.sourceClass,
        title: document.title,
        publisher: document.publisher,
        publishedAt: document.publishedAt,
        tickers: document.tickers,
        summary: document.summary,
        metadata: document.metadata ?? {}
      },
      section: {
        label: section.label,
        text: section.text
      }
    },
    null,
    2
  );
}

function validateSignals(
  parsed: unknown,
  document: AnalysisDocument,
  section: { label: string; text: string },
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars: number;
  }
): ExtractedSignalInput[] {
  if (!isObject(parsed) || !Array.isArray(parsed.signals)) {
    throw new Error("Claude extraction JSON must include a signals array.");
  }

  const validSignals: ExtractedSignalInput[] = [];

  for (const [index, candidate] of parsed.signals.entries()) {
    const signal = validateSignal(candidate, index, document, section, options);

    if (signal) {
      validSignals.push(signal);
    }
  }

  return validSignals;
}

function validateSignal(
  candidate: unknown,
  index: number,
  document: AnalysisDocument,
  section: { label: string; text: string },
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars: number;
  }
): ExtractedSignalInput | null {
  try {
    if (!isObject(candidate)) {
      throw new Error(`Signal ${index} must be an object.`);
    }

    const rawThemeLabel = requiredString(candidate.rawThemeLabel, `signals[${index}].rawThemeLabel`);
    const canonicalThemeLabel = requiredString(
      candidate.canonicalThemeLabel,
      `signals[${index}].canonicalThemeLabel`
    );
    const themeDescription = requiredString(
      candidate.themeDescription,
      `signals[${index}].themeDescription`
    );
    const stance = validateStance(candidate.stance, index);
    const riskTone = validateScore(candidate.riskTone, `signals[${index}].riskTone`);
    const bullishTone = validateScore(candidate.bullishTone, `signals[${index}].bullishTone`);
    const confidence = validateScore(candidate.confidence, `signals[${index}].confidence`);
    const evidenceSnippet = requiredString(
      candidate.evidenceSnippet,
      `signals[${index}].evidenceSnippet`
    );
    const interpretation = requiredString(
      candidate.interpretation,
      `signals[${index}].interpretation`
    );

    if (evidenceSnippet.length > options.maxEvidenceChars) {
      throw new Error(`Signal ${index} evidence snippet exceeds ${options.maxEvidenceChars} chars.`);
    }

    if (!containsSnippet(section.text, evidenceSnippet)) {
      throw new Error(`Signal ${index} evidence snippet was not copied from the source text.`);
    }

    const themeId = `theme:${slugify(canonicalThemeLabel)}`;

    return {
      id: signalId(document.id, options.promptVersion, themeId, evidenceSnippet),
      documentId: document.id,
      themeId,
      rawThemeLabel,
      canonicalThemeLabel,
      themeDescription,
      stance,
      riskTone,
      bullishTone,
      confidence,
      evidenceSnippet,
      interpretation,
      affectedEntities: validateStringArray(candidate.affectedEntities),
      sectionLabel: optionalString(candidate.sectionLabel) ?? section.label,
      speaker: optionalString(candidate.speaker),
      promptVersion: options.promptVersion,
      model: options.model,
      metadata: {
        textHash: document.textHash,
        sourceId: document.sourceId,
        extractionSection: section.label
      },
      scoreContribution: scoreContribution({
        riskTone,
        bullishTone,
        confidence,
        sourceClass: document.sourceClass
      })
    };
  } catch {
    return null;
  }
}

function splitIntoSections(text: string, sectionChars: number, overlap: number) {
  const sections: Array<{ label: string; text: string }> = [];
  let cursor = 0;
  let index = 1;

  while (cursor < text.length) {
    const end = Math.min(cursor + sectionChars, text.length);
    sections.push({
      label: `Section ${index}`,
      text: text.slice(cursor, end)
    });

    if (end === text.length) {
      break;
    }

    cursor = Math.max(end - overlap, cursor + 1);
    index += 1;
  }

  return sections;
}

function dedupeSignals(signals: ExtractedSignalInput[]) {
  const seen = new Set<string>();
  const deduped: ExtractedSignalInput[] = [];

  for (const signal of signals) {
    const key = `${signal.themeId}:${normalizeForComparison(signal.evidenceSnippet)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(signal);
  }

  return deduped;
}

function scoreContribution({
  riskTone,
  bullishTone,
  confidence,
  sourceClass
}: {
  riskTone: number;
  bullishTone: number;
  confidence: number;
  sourceClass: string;
}) {
  const toneStrength = Math.max(riskTone, bullishTone) / 100;
  const confidenceWeight = confidence / 100;
  const sourceWeight = sourceClass === "transcript" ? 1.1 : 1;
  return Number((toneStrength * confidenceWeight * sourceWeight).toFixed(3));
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function optionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateStance(value: unknown, index: number): ToneDirection {
  if (
    value === "risk" ||
    value === "bullish" ||
    value === "mixed" ||
    value === "neutral"
  ) {
    return value;
  }

  throw new Error(`signals[${index}].stance must be risk, bullish, mixed, or neutral.`);
}

function validateScore(value: unknown, field: string) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > 100) {
    throw new Error(`${field} must be a number from 0 to 100.`);
  }

  return numberValue;
}

function containsSnippet(text: string, snippet: string) {
  return normalizeForComparison(text).includes(normalizeForComparison(snippet));
}

function normalizeForComparison(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "uncategorized";
}

function signalId(
  documentId: string,
  promptVersion: string,
  themeId: string,
  evidenceSnippet: string
) {
  return `signal:${createHash("sha256")
    .update(`${documentId}:${promptVersion}:${themeId}:${evidenceSnippet}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
