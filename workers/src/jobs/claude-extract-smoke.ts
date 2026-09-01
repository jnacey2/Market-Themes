import { pathToFileURL } from "node:url";
import { signalExtractionPromptVersion } from "@market-themes/analysis";
import { runClaudeExtractionBackfill } from "./claude-extract-backfill";

export async function runClaudeExtractionSmoke() {
  const documentLimit = boundedInteger(
    process.env.CLAUDE_EXTRACTION_DOCUMENT_LIMIT,
    20,
    100
  );
  const result = await runClaudeExtractionBackfill({
    model:
      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    promptVersion:
      process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion,
    batchSize: documentLimit,
    maxBatches: 1,
    concurrency: boundedInteger(
      process.env.CLAUDE_EXTRACTION_CONCURRENCY,
      1,
      2
    ),
    documentTimeoutMs: Number(
      process.env.CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS ?? 600_000
    ),
    maxRuntimeMs: Number(
      process.env.CLAUDE_EXTRACTION_MAX_RUNTIME_MS ?? 1_800_000
    ),
    lookbackDays: optionalNumber(process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS),
    maxEvidenceChars: Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800),
    staleAfterMinutes: Number(process.env.CLAUDE_STALE_RUN_MINUTES ?? 90),
    maxAnalysisAttempts: Number(process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5),
    excludedSecFilingCategories: parseCsv(
      process.env.CLAUDE_EXCLUDED_SEC_CATEGORIES ?? "capital_markets"
    )
  });
  console.log(`[claude-extract-smoke] ${JSON.stringify(result)}`);
  return result;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum: number
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), maximum)
    : fallback;
}

function optionalNumber(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runClaudeExtractionSmoke();
}
