import { pathToFileURL } from "node:url";
import {
  discoverNarrativeCandidates,
  narrativeCandidateAnalysisType,
  narrativeDiscoveryPromptVersion
} from "@market-themes/analysis";
import {
  claimDocumentsForNarrativeDiscovery,
  completeNarrativeDiscoveryRun,
  countNarrativeDiscoveryBacklog,
  failNarrativeDiscoveryRun,
  getTrackedNarrativeDefinitions,
  getNarrativeCandidateContexts,
  getNarrativeCandidateQueue,
  recoverStaleDocumentAnalysisRuns,
  type ClaimedNarrativeDiscoveryDocument,
  type NarrativeCandidateContext,
  type NarrativeDefinition
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

type DiscoveryOptions = {
  batchSize: number;
  maxDocuments: number;
  maxRuntimeMs: number;
  concurrency: number;
  documentTimeoutMs: number;
  lookbackDays: number;
  maxAttempts: number;
  staleAfterMinutes: number;
  model: string;
  promptVersion: string;
};

export async function discoverNarrativeBatches(
  overrides: Partial<DiscoveryOptions> = {}
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for narrative discovery.");
  }
  const options = { ...defaultOptions(), ...overrides };
  const definitions = await getTrackedNarrativeDefinitions();
  const recovered = await recoverStaleDocumentAnalysisRuns({
    analysisType: narrativeCandidateAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    staleAfterMinutes: options.staleAfterMinutes
  });
  const startedAt = Date.now();
  const failedDocumentIds = new Set<string>();
  let documentsSelected = 0;
  let documentsProcessed = 0;
  let failedDocuments = 0;
  let candidatesTouched = 0;
  let evidenceStored = 0;
  let stopReason:
    | "backlog_empty"
    | "document_budget_reached"
    | "runtime_reached"
    | "failed_documents_exhausted";

  while (true) {
    if (Date.now() - startedAt >= options.maxRuntimeMs) {
      stopReason = "runtime_reached";
      break;
    }
    const remainingBudget =
      options.maxDocuments === 0
        ? Math.min(options.batchSize, Math.max(1, options.concurrency))
        : Math.min(
            options.batchSize,
            Math.max(1, options.concurrency),
            options.maxDocuments - documentsSelected
          );
    if (remainingBudget <= 0) {
      stopReason = "document_budget_reached";
      break;
    }

    const documents = await claimDocumentsForNarrativeDiscovery({
      analysisType: narrativeCandidateAnalysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      limit: remainingBudget,
      lookbackDays: options.lookbackDays,
      maxAttempts: options.maxAttempts,
      excludedDocumentIds: [...failedDocumentIds]
    });
    if (documents.length === 0) {
      stopReason =
        failedDocumentIds.size > 0
          ? "failed_documents_exhausted"
          : "backlog_empty";
      break;
    }
    documentsSelected += documents.length;
    const existingCandidates = await getNarrativeCandidateContexts(
      options.promptVersion
    );
    const results = await runWithConcurrency(
      documents,
      Math.max(1, options.concurrency),
      (document) =>
        discoverDocument(document, definitions, existingCandidates, {
          ...options,
          documentTimeoutMs: Math.max(
            1,
            Math.min(
              options.documentTimeoutMs,
              options.maxRuntimeMs - (Date.now() - startedAt)
            )
          )
        })
    );
    for (const result of results) {
      if (result.status === "completed") {
        documentsProcessed += 1;
        candidatesTouched += result.candidatesTouched;
        evidenceStored += result.evidenceStored;
      } else {
        failedDocuments += 1;
        failedDocumentIds.add(result.documentId);
        console.error(
          `[discover-narratives] document=${result.documentId} failed: ${result.error}`
        );
      }
    }
  }

  const [remainingBacklog, queue] = await Promise.all([
    countNarrativeDiscoveryBacklog({
      analysisType: narrativeCandidateAnalysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      lookbackDays: options.lookbackDays,
      maxAttempts: options.maxAttempts
    }),
    getNarrativeCandidateQueue(undefined, options.promptVersion)
  ]);
  if (documentsSelected > 0 && documentsProcessed === 0 && failedDocuments > 0) {
    throw new Error(
      `Narrative discovery failed for all ${failedDocuments} selected documents.`
    );
  }
  return {
    recoveredStaleRuns: recovered.recoveredRuns,
    documentsSelected,
    documentsProcessed,
    failedDocuments,
    candidatesTouched,
    evidenceStored,
    pendingCandidates: queue.pendingCount,
    qualifiedCandidates: queue.qualifiedCount,
    remainingBacklog: remainingBacklog.total,
    backlogBySourceClass: remainingBacklog.bySourceClass,
    stopReason
  };
}

async function discoverDocument(
  document: ClaimedNarrativeDiscoveryDocument,
  definitions: NarrativeDefinition[],
  existingCandidates: NarrativeCandidateContext[],
  options: DiscoveryOptions
) {
  try {
    const candidates = await withTimeout(
      (signal) =>
        discoverNarrativeCandidates(
          document,
          definitions,
          existingCandidates,
          {
            model: options.model,
            promptVersion: options.promptVersion,
            signal
          }
        ),
      options.documentTimeoutMs,
      `narrative discovery timed out after ${options.documentTimeoutMs}ms`
    );
    const result = await completeNarrativeDiscoveryRun(
      document.analysisRunId,
      candidates,
      { attemptToken: document.attemptToken }
    );
    console.log(
      `[discover-narratives] document=${document.id} candidates=${result.candidatesTouched} evidence=${result.insertedEvidence}`
    );
    return {
      status: "completed" as const,
      documentId: document.id,
      candidatesTouched: result.candidatesTouched,
      evidenceStored: result.insertedEvidence
    };
  } catch (error) {
    await failNarrativeDiscoveryRun(
      document.analysisRunId,
      document.attemptToken,
      error
    );
    return {
      status: "failed" as const,
      documentId: document.id,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runNext())
  );
  return results;
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
    if (timeout) clearTimeout(timeout);
  });
}

function defaultOptions(): DiscoveryOptions {
  return {
    batchSize: Number(process.env.NARRATIVE_DISCOVERY_BATCH_SIZE ?? 10),
    maxDocuments: Number(process.env.NARRATIVE_DISCOVERY_MAX_DOCUMENTS ?? 40),
    maxRuntimeMs: Number(
      process.env.NARRATIVE_DISCOVERY_MAX_RUNTIME_MS ?? 1_200_000
    ),
    concurrency: Number(process.env.NARRATIVE_DISCOVERY_CONCURRENCY ?? 2),
    documentTimeoutMs: Number(
      process.env.NARRATIVE_DISCOVERY_DOCUMENT_TIMEOUT_MS ?? 600_000
    ),
    lookbackDays: Number(process.env.NARRATIVE_DISCOVERY_LOOKBACK_DAYS ?? 30),
    maxAttempts: Number(process.env.NARRATIVE_DISCOVERY_MAX_ATTEMPTS ?? 5),
    staleAfterMinutes: Number(
      process.env.NARRATIVE_DISCOVERY_STALE_MINUTES ?? 90
    ),
    model:
      process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    promptVersion:
      process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION ??
      narrativeDiscoveryPromptVersion
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRecordedJob(
    "narrative_discovery",
    () => discoverNarrativeBatches(),
    (value) => value.documentsProcessed
  );
  console.log(`[discover-narratives] ${JSON.stringify(result)}`);
}
