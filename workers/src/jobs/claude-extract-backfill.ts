import { pathToFileURL } from "node:url";
import {
  extractSignalsFromDocument,
  marketSignalAnalysisType,
  signalExtractionPromptVersion
} from "@market-themes/analysis";
import {
  completeDocumentAnalysisRun,
  failDocumentAnalysisRun,
  getBackfillJobForWorker,
  recoverStaleDocumentAnalysisRuns,
  selectDocumentsForAnalysis,
  startDocumentAnalysisRun,
  updateBackfillJobProgress,
  type AnalysisDocument,
  type BackfillJobRunConfig
} from "@market-themes/db";

type ClaudeBackfillOptions = {
  batchSize: number;
  maxBatches: number;
  concurrency: number;
  documentTimeoutMs: number;
  lookbackDays?: number;
  excludedSecFilingCategories: string[];
  maxAnalysisAttempts: number;
  model: string;
  promptVersion: string;
  maxEvidenceChars: number;
  staleAfterMinutes: number;
  jobId?: string;
  shouldStop?: () => Promise<boolean>;
};

type BackfillDocumentResult =
  | { status: "completed"; insertedSignals: number; themesTouched: number }
  | { status: "failed" }
  | { status: "skipped" };

export async function runClaimedClaudeBackfillJob(job: BackfillJobRunConfig) {
  const heartbeat = setInterval(() => {
    void updateBackfillJobProgress(job.id, {}).catch((error) =>
      console.error("Backfill heartbeat failed", error)
    );
  }, 30_000);
  try {
    const result = await runClaudeExtractionBackfill({
      batchSize: job.batchSize,
      maxBatches: job.maxBatches,
      concurrency: job.concurrency,
      documentTimeoutMs: job.documentTimeoutMs,
      lookbackDays: job.lookbackDays ?? undefined,
      excludedSecFilingCategories: job.excludedSecFilingCategories,
      maxAnalysisAttempts: Number(
        process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5
      ),
      model: job.model,
      promptVersion: job.promptVersion,
      maxEvidenceChars: Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800),
      staleAfterMinutes: job.staleAfterMinutes,
      jobId: job.id,
      shouldStop: async () => {
        const currentJob = await getBackfillJobForWorker(job.id);
        return !currentJob || currentJob.status !== "running";
      }
    });

    await updateBackfillJobProgress(job.id, {
      status: result.stopRequested
        ? "cancelled"
        : result.failedDocuments > 0
          ? "failed"
          : "completed",
      currentDocumentIds: [],
      lastMessage: result.stopRequested
        ? "Stopped after finishing in-flight documents."
        : result.failedDocuments > 0
          ? `Finished with ${result.failedDocuments} failed documents; inspect errors before retrying.`
          : "Completed requested Claude extraction batches.",
      completedAtNow: true
    });
  } catch (error) {
    await updateBackfillJobProgress(job.id, {
      status: "failed",
      currentDocumentIds: [],
      lastError: error instanceof Error ? error.message : String(error),
      lastMessage: "Backfill job failed.",
      completedAtNow: true
    });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runClaudeExtractionBackfill(
  options = defaultBackfillOptions()
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude extraction.");
  }

  console.log("[claude-extract-backfill] recovering stale analysis runs");
  if (options.jobId) {
    await updateBackfillJobProgress(options.jobId, {
      lastMessage: "Recovering stale analysis runs before selecting documents."
    });
  }

  const recovered = await recoverStaleDocumentAnalysisRuns({
    analysisType: marketSignalAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    staleAfterMinutes: options.staleAfterMinutes
  });

  if (recovered.recoveredRuns > 0) {
    console.log(
      `[claude-extract-backfill] recoveredStaleRuns=${recovered.recoveredRuns} documents=${recovered.documentIds.join(",")}`
    );
  }

  if (options.jobId) {
    await updateBackfillJobProgress(options.jobId, {
      lastMessage:
        recovered.recoveredRuns > 0
          ? `Recovered ${recovered.recoveredRuns} stale analysis runs.`
          : "Starting Claude extraction backfill."
    });
  }

  let totalSelected = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalSignals = 0;
  let totalThemesTouched = 0;
  let stopRequested = false;

  for (let batchIndex = 1; batchIndex <= options.maxBatches; batchIndex += 1) {
    if (await shouldStop(options)) {
      stopRequested = true;
      break;
    }

    console.log(
      `[claude-extract-backfill] selecting documents for batch=${batchIndex}`
    );
    if (options.jobId) {
      await updateBackfillJobProgress(options.jobId, {
        lastMessage: `Selecting documents for batch ${batchIndex}.`
      });
    }

    const documents = await selectDocumentsForAnalysis({
      analysisType: marketSignalAnalysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      limit: options.batchSize,
      lookbackDays: options.lookbackDays,
      excludedSecFilingCategories: options.excludedSecFilingCategories,
      maxAttempts: options.maxAnalysisAttempts
    });

    totalSelected += documents.length;
    console.log(
      `[claude-extract-backfill] batch=${batchIndex}/${options.maxBatches} selected=${documents.length} batchSize=${options.batchSize}`
    );

    if (options.jobId) {
      await updateBackfillJobProgress(options.jobId, {
        selectedDocumentsDelta: documents.length,
        currentDocumentIds: documents.map((document) => document.id),
        lastMessage: `Selected ${documents.length} documents for batch ${batchIndex}.`
      });
    }

    if (documents.length === 0) {
      break;
    }

    const results = await runWithConcurrency(
      documents,
      Math.max(1, options.concurrency),
      (document) => analyzeDocument(document, batchIndex, options),
      () => shouldStop(options)
    );

    const completed = results.filter(
      (result) => result?.status === "completed"
    );
    const failed = results.filter((result) => result?.status === "failed");
    const insertedSignals = completed.reduce(
      (sum, result) => sum + result.insertedSignals,
      0
    );
    const themesTouched = completed.reduce(
      (sum, result) => sum + result.themesTouched,
      0
    );

    totalCompleted += completed.length;
    totalFailed += failed.length;
    totalSignals += insertedSignals;
    totalThemesTouched += themesTouched;

    if (options.jobId) {
      await updateBackfillJobProgress(options.jobId, {
        completedDocumentsDelta: completed.length,
        failedDocumentsDelta: failed.length,
        insertedSignalsDelta: insertedSignals,
        themesTouchedDelta: themesTouched,
        currentDocumentIds: [],
        lastMessage: `Finished batch ${batchIndex}: ${completed.length} completed, ${failed.length} failed.`
      });
    }

    if (await shouldStop(options)) {
      stopRequested = true;
      break;
    }
  }

  console.log(
    `[claude-extract-backfill] selected=${totalSelected} completed=${totalCompleted} failed=${totalFailed} signals=${totalSignals} themes=${totalThemesTouched} model=${options.model} promptVersion=${options.promptVersion} batchSize=${options.batchSize} maxBatches=${options.maxBatches}`
  );

  return {
    selectedDocuments: totalSelected,
    completedDocuments: totalCompleted,
    failedDocuments: totalFailed,
    insertedSignals: totalSignals,
    themesTouched: totalThemesTouched,
    stopRequested
  };
}

async function analyzeDocument(
  document: AnalysisDocument,
  batchIndex: number,
  options: ClaudeBackfillOptions
): Promise<BackfillDocumentResult> {
  console.log(
    `[claude-extract-backfill] analyzing document=${document.id} source=${document.sourceId} published=${document.publishedAt}`
  );

  const claim = await startDocumentAnalysisRun(document.id, {
    analysisType: marketSignalAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    maxAttempts: options.maxAnalysisAttempts,
    metadata: {
      sourceId: document.sourceId,
      sourceClass: document.sourceClass,
      textHash: document.textHash,
      backfillBatch: batchIndex,
      backfillJobId: options.jobId ?? null
    }
  });

  if (!claim) return { status: "skipped" };

  const controller = new AbortController();
  const cancellation = options.jobId
    ? setInterval(() => {
        void getBackfillJobForWorker(options.jobId!)
          .then((job) => {
            if (!job || !["running", "stop_requested"].includes(job.status))
              controller.abort(new Error("Backfill cancelled."));
          })
          .catch((error) => console.error("Cancellation check failed", error));
      }, 5_000)
    : undefined;
  try {
    const signals = await withTimeout(
      extractWithRetry(document, {
        model: options.model,
        promptVersion: options.promptVersion,
        maxEvidenceChars: options.maxEvidenceChars,
        signal: controller.signal
      }),
      options.documentTimeoutMs,
      `Claude extraction timed out after ${options.documentTimeoutMs}ms for ${document.id}`,
      controller
    );
    const result = await completeDocumentAnalysisRun(claim, signals);
    console.log(
      `[claude-extract-backfill] completed document=${document.id} signals=${result.insertedSignals} themes=${result.themesTouched}`
    );
    return {
      status: "completed",
      insertedSignals: result.insertedSignals,
      themesTouched: result.themesTouched
    };
  } catch (error) {
    await failDocumentAnalysisRun(claim, error);
    console.error(
      `[claude-extract-backfill] failed document=${document.id} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return {
      status: "failed"
    };
  } finally {
    if (cancellation) clearInterval(cancellation);
  }
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  shouldStopPicking: () => Promise<boolean>
) {
  const results: Array<R | undefined> = [];
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < items.length) {
      if (await shouldStopPicking()) {
        break;
      }

      // The stop check yields; another worker may consume the final item.
      if (nextIndex >= items.length) break;
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

async function shouldStop(options: ClaudeBackfillOptions) {
  return options.shouldStop ? options.shouldStop() : false;
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  controller = new AbortController()
) {
  let timeout: NodeJS.Timeout | undefined;
  const guardedPromise = promise.catch((error) => {
    throw error;
  });

  return Promise.race([
    guardedPromise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new Error(message));
        reject(new Error(message));
      }, timeoutMs);
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
    signal?: AbortSignal;
  }
) {
  try {
    return await extractSignalsFromDocument(document, options);
  } catch (firstError) {
    options.signal?.throwIfAborted();
    console.warn(
      `[claude-extract-backfill] retrying document=${document.id} after error=${
        firstError instanceof Error ? firstError.message : String(firstError)
      }`
    );
    return extractSignalsFromDocument(document, options);
  }
}

function defaultBackfillOptions(): ClaudeBackfillOptions {
  return {
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
    promptVersion: process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion,
    batchSize: Number(process.env.CLAUDE_EXTRACTION_BATCH_SIZE ?? 25),
    maxBatches: Number(process.env.CLAUDE_EXTRACTION_MAX_BATCHES ?? 1),
    concurrency: Number(process.env.CLAUDE_EXTRACTION_CONCURRENCY ?? 2),
    documentTimeoutMs: Number(process.env.CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS ?? 600_000),
    lookbackDays: optionalNumber(process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS),
    maxEvidenceChars: Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800),
    staleAfterMinutes: Number(process.env.CLAUDE_STALE_RUN_MINUTES ?? 90),
    maxAnalysisAttempts: Number(process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5),
    excludedSecFilingCategories: parseCsv(
      process.env.CLAUDE_EXCLUDED_SEC_CATEGORIES ?? "capital_markets"
    )
  };
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runClaudeExtractionBackfill();
  if (result.failedDocuments > 0)
    process.exitCode = result.completedDocuments > 0 ? 2 : 1;
}
