import { pathToFileURL } from "node:url";
import {
  extractSignalsFromDocument,
  marketSignalAnalysisType,
  signalExtractionPromptVersion
} from "@market-themes/analysis";
import {
  closeDatabaseClient,
  completeDocumentAnalysisRun,
  createDatabaseClient,
  failDocumentAnalysisRun,
  getBackfillJobForWorker,
  recoverStaleDocumentAnalysisRuns,
  selectDocumentsForAnalysis,
  startDocumentAnalysisRun,
  updateBackfillJobProgress,
  type AnalysisDocument,
  type BackfillJobRunConfig
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

type ClaudeBackfillOptions = {
  batchSize: number;
  maxBatches: number;
  maxDocuments?: number;
  concurrency: number;
  documentTimeoutMs: number;
  maxRuntimeMs: number;
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
  | { status: "failed" };

export async function runClaimedClaudeBackfillJob(job: BackfillJobRunConfig) {
  try {
    const result = await runClaudeExtractionBackfill({
      batchSize: job.batchSize,
      maxBatches: job.maxBatches,
      maxDocuments: Math.max(
        0,
        job.batchSize * job.maxBatches - job.selectedDocuments
      ),
      concurrency: job.concurrency,
      documentTimeoutMs: job.documentTimeoutMs,
      maxRuntimeMs: Number(
        process.env.CLAUDE_EXTRACTION_MAX_RUNTIME_MS ?? 3_000_000
      ),
      lookbackDays: job.lookbackDays ?? undefined,
      excludedSecFilingCategories: job.excludedSecFilingCategories,
      maxAnalysisAttempts: Number(process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5),
      model: job.model,
      promptVersion: job.promptVersion,
      maxEvidenceChars: Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800),
      staleAfterMinutes: job.staleAfterMinutes,
      jobId: job.id,
      shouldStop: async () => {
        const currentJob = await getBackfillJobForWorker(job.id);
        return !currentJob || currentJob.status === "stop_requested";
      }
    });

    if (result.skippedAlreadyRunning) {
      await updateBackfillJobProgress(job.id, {
        status: "queued",
        currentDocumentIds: [],
        lastMessage: "Another extraction run is active; this job will retry."
      });
      return;
    }
    if (result.stopReason === "runtime_reached") {
      await updateBackfillJobProgress(job.id, {
        status: "queued",
        currentDocumentIds: [],
        lastMessage:
          "Runtime budget reached; queued to continue the remaining document limit."
      });
      return;
    }
    await updateBackfillJobProgress(job.id, {
      status: result.stopRequested ? "cancelled" : "completed",
      currentDocumentIds: [],
      lastMessage: result.stopRequested
        ? "Stopped after finishing in-flight documents."
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
  }
}

export async function runClaudeExtractionBackfill(options = defaultBackfillOptions()) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for Claude extraction.");
  }
  const lockClient = createDatabaseClient();
  await lockClient.connect();
  let acquired = false;
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `select pg_try_advisory_lock(
         hashtext('market_themes_signal_extraction')
       ) as acquired`
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      console.log(
        "[claude-extract-backfill] another extraction run owns the advisory lock; skipping"
      );
      return {
        selectedDocuments: 0,
        completedDocuments: 0,
        failedDocuments: 0,
        insertedSignals: 0,
        themesTouched: 0,
        stopRequested: false,
        skippedAlreadyRunning: true,
        stopReason: "already_running" as const
      };
    }
    return await executeClaudeExtractionBackfill(options);
  } finally {
    if (acquired) {
      await lockClient
        .query(
          `select pg_advisory_unlock(
             hashtext('market_themes_signal_extraction')
           )`
        )
        .catch(() => undefined);
    }
    await closeDatabaseClient(lockClient);
  }
}

async function executeClaudeExtractionBackfill(options: ClaudeBackfillOptions) {
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
  const startedAt = Date.now();
  const selectedDocumentIds = new Set<string>();
  const documentBudget = Math.max(
    0,
    Math.min(
      options.batchSize * options.maxBatches,
      options.maxDocuments ?? options.batchSize * options.maxBatches
    )
  );
  let selectionRound = 0;
  let stopReason:
    | "backlog_empty"
    | "document_budget_reached"
    | "runtime_reached"
    | "stop_requested" = "backlog_empty";

  while (totalSelected < documentBudget) {
    if (await shouldStop(options)) {
      stopRequested = true;
      stopReason = "stop_requested";
      break;
    }
    if (Date.now() - startedAt >= options.maxRuntimeMs) {
      stopReason = "runtime_reached";
      break;
    }

    selectionRound += 1;
    const selectionLimit = Math.min(
      options.batchSize,
      Math.max(1, options.concurrency),
      documentBudget - totalSelected
    );
    console.log(
      `[claude-extract-backfill] selecting documents for round=${selectionRound}`
    );
    if (options.jobId) {
      await updateBackfillJobProgress(options.jobId, {
        lastMessage: `Selecting documents for round ${selectionRound}.`
      });
    }

    const documents = await selectDocumentsForAnalysis({
      analysisType: marketSignalAnalysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      limit: selectionLimit,
      lookbackDays: options.lookbackDays,
      excludedSecFilingCategories: options.excludedSecFilingCategories,
      excludedDocumentIds: [...selectedDocumentIds],
      maxAttempts: options.maxAnalysisAttempts
    });

    documents.forEach((document) => selectedDocumentIds.add(document.id));
    totalSelected += documents.length;
    console.log(
      `[claude-extract-backfill] round=${selectionRound} selected=${documents.length} remainingBudget=${documentBudget - totalSelected}`
    );

    if (options.jobId) {
      await updateBackfillJobProgress(options.jobId, {
        selectedDocumentsDelta: documents.length,
        currentDocumentIds: documents.map((document) => document.id),
        lastMessage: `Selected ${documents.length} documents for round ${selectionRound}.`
      });
    }

    if (documents.length === 0) {
      stopReason = "backlog_empty";
      break;
    }

    const results = await runWithConcurrency(
      documents,
      Math.max(1, options.concurrency),
      (document) =>
        analyzeDocument(document, selectionRound, {
          ...options,
          documentTimeoutMs: Math.max(
            1,
            Math.min(
              options.documentTimeoutMs,
              options.maxRuntimeMs - (Date.now() - startedAt)
            )
          )
        }),
      () => shouldStop(options)
    );

    const completed = results.filter((result) => result?.status === "completed");
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
        lastMessage: `Finished round ${selectionRound}: ${completed.length} completed, ${failed.length} failed.`
      });
    }

    if (await shouldStop(options)) {
      stopRequested = true;
      stopReason = "stop_requested";
      break;
    }
    if (Date.now() - startedAt >= options.maxRuntimeMs) {
      stopReason = "runtime_reached";
      break;
    }
  }
  if (
    !stopRequested &&
    totalSelected >= documentBudget &&
    stopReason === "backlog_empty"
  ) {
    stopReason = "document_budget_reached";
  }

  console.log(
    `[claude-extract-backfill] selected=${totalSelected} completed=${totalCompleted} failed=${totalFailed} signals=${totalSignals} themes=${totalThemesTouched} model=${options.model} promptVersion=${options.promptVersion} documentBudget=${documentBudget} stopReason=${stopReason}`
  );
  if (totalSelected > 0 && totalCompleted === 0 && totalFailed > 0) {
    throw new Error(
      `Claude extraction failed for all ${totalFailed} selected documents.`
    );
  }

  return {
    selectedDocuments: totalSelected,
    completedDocuments: totalCompleted,
    failedDocuments: totalFailed,
    insertedSignals: totalSignals,
    themesTouched: totalThemesTouched,
    stopRequested,
    skippedAlreadyRunning: false,
    stopReason
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

  const runId = await startDocumentAnalysisRun(document.id, {
    analysisType: marketSignalAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    metadata: {
      sourceId: document.sourceId,
      sourceClass: document.sourceClass,
      textHash: document.textHash,
      backfillBatch: batchIndex,
      backfillJobId: options.jobId ?? null
    }
  });

  try {
    const signals = await withTimeout(
      (signal) =>
        extractWithRetry(
          document,
          {
            model: options.model,
            promptVersion: options.promptVersion,
            maxEvidenceChars: options.maxEvidenceChars
          },
          signal
        ),
      options.documentTimeoutMs,
      `Claude extraction timed out after ${options.documentTimeoutMs}ms for ${document.id}`
    );
    const result = await completeDocumentAnalysisRun(runId, signals);
    console.log(
      `[claude-extract-backfill] completed document=${document.id} signals=${result.insertedSignals} themes=${result.themesTouched}`
    );
    return {
      status: "completed",
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
      status: "failed"
    };
  }
}

async function runWithConcurrency<T, R>(
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

function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string
) {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  return Promise.race([
    operation(controller.signal),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
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
  },
  signal: AbortSignal
) {
  try {
    return await extractSignalsFromDocument(document, { ...options, signal });
  } catch (firstError) {
    console.warn(
      `[claude-extract-backfill] retrying document=${document.id} after error=${
        firstError instanceof Error ? firstError.message : String(firstError)
      }`
    );
    return extractSignalsFromDocument(document, { ...options, signal });
  }
}

function defaultBackfillOptions(): ClaudeBackfillOptions {
  return {
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
    promptVersion: process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion,
    batchSize: Number(process.env.CLAUDE_EXTRACTION_BATCH_SIZE ?? 25),
    maxBatches: Number(process.env.CLAUDE_EXTRACTION_MAX_BATCHES ?? 1),
    maxDocuments: Number(process.env.CLAUDE_EXTRACTION_MAX_DOCUMENTS ?? 100),
    concurrency: Number(process.env.CLAUDE_EXTRACTION_CONCURRENCY ?? 2),
    documentTimeoutMs: Number(process.env.CLAUDE_EXTRACTION_DOCUMENT_TIMEOUT_MS ?? 600_000),
    maxRuntimeMs: Number(process.env.CLAUDE_EXTRACTION_MAX_RUNTIME_MS ?? 3_000_000),
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRecordedJob(
    "signal_extraction",
    () => runClaudeExtractionBackfill(),
    (result) => result.completedDocuments,
    (result) => result.failedDocuments
  );
}
