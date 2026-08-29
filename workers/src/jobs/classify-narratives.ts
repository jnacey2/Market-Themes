import {
  classifyDocumentNarratives,
  narrativeClassificationPromptVersion
} from "@market-themes/analysis";
import {
  closeDatabaseClient,
  countNarrativeClassificationBacklog,
  createDatabaseClient,
  getActiveNarrativeDefinitions,
  persistNarrativeObservations,
  selectDocumentsForNarrativeClassification,
  type AnalysisDocument,
  type NarrativeDefinition
} from "@market-themes/db";
import { pathToFileURL } from "node:url";

type ClassificationOptions = {
  batchSize?: number;
  maxDocuments?: number;
  maxBatches?: number;
  maxRuntimeMs?: number;
  concurrency?: number;
  documentTimeoutMs?: number;
};

export async function classifyNarrativeBatches(
  options: ClassificationOptions = {}
) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for narrative classification.");
  }
  const lockClient = createDatabaseClient();
  await lockClient.connect();
  try {
    const lock = await lockClient.query<{ acquired: boolean }>(
      `select pg_try_advisory_lock(
         hashtext('market_themes_narrative_classification')
       ) as acquired`
    );
    if (!lock.rows[0]?.acquired) {
      const model =
        process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
      const promptVersion =
        process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
        narrativeClassificationPromptVersion;
      const backlog = await countNarrativeClassificationBacklog({
        model,
        promptVersion
      });
      return {
        documentsSelected: 0,
        documentsProcessed: 0,
        observationsStored: 0,
        matchedObservations: 0,
        failedDocuments: 0,
        remainingBacklog: backlog.total,
        backlogBySourceClass: backlog.bySourceClass,
        stopReason: "already_running" as const
      };
    }
    return await runClassification(options);
  } finally {
    await lockClient
      .query(
        `select pg_advisory_unlock(
           hashtext('market_themes_narrative_classification')
         )`
      )
      .catch(() => undefined);
    await closeDatabaseClient(lockClient);
  }
}

async function runClassification(options: ClassificationOptions) {
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
  const promptVersion =
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  const batchSize = options.batchSize ?? Number(process.env.NARRATIVE_CLASSIFICATION_BATCH_SIZE ?? 10);
  const configuredMaxDocuments =
    options.maxDocuments ??
    (options.maxBatches === undefined ? undefined : batchSize * options.maxBatches) ??
    Number(process.env.NARRATIVE_CLASSIFICATION_MAX_DOCUMENTS ?? 0);
  const maxDocuments = Math.max(0, configuredMaxDocuments);
  const maxRuntimeMs =
    options.maxRuntimeMs ??
    Number(process.env.NARRATIVE_CLASSIFICATION_MAX_RUNTIME_MS ?? 2_400_000);
  const concurrency =
    options.concurrency ??
    Number(process.env.NARRATIVE_CLASSIFICATION_CONCURRENCY ?? 2);
  const documentTimeoutMs =
    options.documentTimeoutMs ??
    Number(process.env.NARRATIVE_CLASSIFICATION_DOCUMENT_TIMEOUT_MS ?? 600_000);
  let documentsProcessed = 0;
  let observationsStored = 0;
  let matchedObservations = 0;
  let failedDocuments = 0;
  let documentsSelected = 0;
  const failedDocumentIds = new Set<string>();
  const startedAt = Date.now();
  let stopReason:
    | "backlog_empty"
    | "document_budget_reached"
    | "runtime_reached"
    | "failed_documents_exhausted";

  while (true) {
    if (Date.now() - startedAt >= maxRuntimeMs) {
      stopReason = "runtime_reached";
      break;
    }
    const remainingBudget =
      maxDocuments === 0
        ? Math.min(batchSize, Math.max(1, concurrency))
        : Math.min(
            batchSize,
            Math.max(1, concurrency),
            maxDocuments - documentsSelected
          );
    if (remainingBudget <= 0) {
      stopReason = "document_budget_reached";
      break;
    }
    const definitions = await getActiveNarrativeDefinitions();
    if (definitions.length === 0) {
      stopReason = "backlog_empty";
      break;
    }
    const documents = await selectDocumentsForNarrativeClassification({
      model,
      promptVersion,
      limit: remainingBudget,
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

    const results = await runWithConcurrency(
      documents,
      Math.max(1, concurrency),
      async (document) =>
        classifyDocument(document, definitions, {
          model,
          promptVersion,
          documentTimeoutMs: Math.max(
            1,
            Math.min(documentTimeoutMs, maxRuntimeMs - (Date.now() - startedAt))
          )
        })
    );
    for (const result of results) {
      if (result.status === "completed") {
        observationsStored += result.observationsStored;
        matchedObservations += result.matchedObservations;
        documentsProcessed += 1;
      } else {
        failedDocuments += 1;
        failedDocumentIds.add(result.documentId);
        console.error(
          `[classify-narratives] document=${result.documentId} failed: ${result.error}`
        );
      }
    }
  }

  const remainingBacklog = await countNarrativeClassificationBacklog({
    model,
    promptVersion
  });
  if (documentsSelected > 0 && documentsProcessed === 0 && failedDocuments > 0) {
    throw new Error(
      `Narrative classification failed for all ${failedDocuments} selected documents.`
    );
  }
  return {
    documentsSelected,
    documentsProcessed,
    observationsStored,
    matchedObservations,
    failedDocuments,
    remainingBacklog: remainingBacklog.total,
    backlogBySourceClass: remainingBacklog.bySourceClass,
    stopReason
  };
}

async function classifyDocument(
  document: AnalysisDocument,
  definitions: NarrativeDefinition[],
  options: {
    model: string;
    promptVersion: string;
    documentTimeoutMs: number;
  }
) {
  try {
    const observations = await withTimeout(
      (signal) =>
        classifyDocumentNarratives(document, definitions, {
          model: options.model,
          promptVersion: options.promptVersion,
          signal
        }),
      options.documentTimeoutMs,
      `classification timed out after ${options.documentTimeoutMs}ms`
    );
    const result = await persistNarrativeObservations(observations);
    return {
      status: "completed" as const,
      documentId: document.id,
      observationsStored: result.inserted,
      matchedObservations: observations.filter((observation) => observation.matched).length
    };
  } catch (error) {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await classifyNarrativeBatches();
  console.log(`[classify-narratives] ${JSON.stringify(result)}`);
}
