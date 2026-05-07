import {
  extractSignalsFromDocument,
  marketSignalAnalysisType,
  signalExtractionPromptVersion
} from "@market-themes/analysis";
import {
  completeDocumentAnalysisRun,
  failDocumentAnalysisRun,
  recoverStaleDocumentAnalysisRuns,
  selectDocumentsForAnalysis,
  startDocumentAnalysisRun,
  type AnalysisDocument
} from "@market-themes/db";

const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
const promptVersion = process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion;
const batchSize = Number(process.env.CLAUDE_EXTRACTION_BATCH_SIZE ?? 25);
const maxBatches = Number(process.env.CLAUDE_EXTRACTION_MAX_BATCHES ?? 1);
const concurrency = Number(process.env.CLAUDE_EXTRACTION_CONCURRENCY ?? 2);
const documentTimeoutMs = Number(process.env.CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS ?? 600_000);
const lookbackDays = optionalNumber(process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS);
const maxEvidenceChars = Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800);
const staleAfterMinutes = Number(process.env.CLAUDE_STALE_RUN_MINUTES ?? 90);
const excludedSecFilingCategories = parseCsv(
  process.env.CLAUDE_EXCLUDED_SEC_CATEGORIES ?? "capital_markets"
);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for Claude extraction.");
}

const recovered = await recoverStaleDocumentAnalysisRuns({
  analysisType: marketSignalAnalysisType,
  model,
  promptVersion,
  staleAfterMinutes
});

if (recovered.recoveredRuns > 0) {
  console.log(
    `[claude-extract-backfill] recoveredStaleRuns=${recovered.recoveredRuns} documents=${recovered.documentIds.join(",")}`
  );
}

let totalSelected = 0;
let totalCompleted = 0;
let totalFailed = 0;
let totalSignals = 0;
let totalThemesTouched = 0;

for (let batchIndex = 1; batchIndex <= maxBatches; batchIndex += 1) {
  const documents = await selectDocumentsForAnalysis({
    analysisType: marketSignalAnalysisType,
    model,
    promptVersion,
    limit: batchSize,
    lookbackDays,
    excludedSecFilingCategories
  });

  totalSelected += documents.length;
  console.log(
    `[claude-extract-backfill] batch=${batchIndex}/${maxBatches} selected=${documents.length} batchSize=${batchSize}`
  );

  if (documents.length === 0) {
    break;
  }

  const results = await runWithConcurrency(
    documents,
    Math.max(1, concurrency),
    (document) => analyzeDocument(document, batchIndex)
  );

  for (const result of results) {
    if (result.status === "completed") {
      totalCompleted += 1;
      totalSignals += result.insertedSignals;
      totalThemesTouched += result.themesTouched;
    } else {
      totalFailed += 1;
    }
  }
}

console.log(
  `[claude-extract-backfill] selected=${totalSelected} completed=${totalCompleted} failed=${totalFailed} signals=${totalSignals} themes=${totalThemesTouched} model=${model} promptVersion=${promptVersion} batchSize=${batchSize} maxBatches=${maxBatches}`
);

async function analyzeDocument(document: AnalysisDocument, batchIndex: number) {
  console.log(
    `[claude-extract-backfill] analyzing document=${document.id} source=${document.sourceId} published=${document.publishedAt}`
  );

  const runId = await startDocumentAnalysisRun(document.id, {
    analysisType: marketSignalAnalysisType,
    model,
    promptVersion,
    metadata: {
      sourceId: document.sourceId,
      sourceClass: document.sourceClass,
      textHash: document.textHash,
      backfillBatch: batchIndex
    }
  });

  try {
    const signals = await withTimeout(
      extractWithRetry(document, {
        model,
        promptVersion,
        maxEvidenceChars
      }),
      documentTimeoutMs,
      `Claude extraction timed out after ${documentTimeoutMs}ms for ${document.id}`
    );
    const result = await completeDocumentAnalysisRun(runId, signals);
    console.log(
      `[claude-extract-backfill] completed document=${document.id} signals=${result.insertedSignals} themes=${result.themesTouched}`
    );
    return {
      status: "completed" as const,
      insertedSignals: result.insertedSignals,
      themesTouched: result.themesTouched
    };
  } catch (error) {
    await failDocumentAnalysisRun(runId, error);
    console.error(
      `[claude-extract-backfill] failed document=${document.id} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      status: "failed" as const
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  );

  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: NodeJS.Timeout | undefined;
  const guardedPromise = promise.catch((error) => {
    throw error;
  });

  return Promise.race([
    guardedPromise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function extractWithRetry(
  document: AnalysisDocument,
  options: {
    model: string;
    promptVersion: string;
    maxEvidenceChars: number;
  }
) {
  try {
    return await extractSignalsFromDocument(document, options);
  } catch (firstError) {
    console.warn(
      `[claude-extract-backfill] retrying document=${document.id} after error=${
        firstError instanceof Error ? firstError.message : String(firstError)
      }`
    );
    return extractSignalsFromDocument(document, options);
  }
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
