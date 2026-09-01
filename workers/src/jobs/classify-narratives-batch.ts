import { pathToFileURL } from "node:url";
import {
  anthropicBatchCustomId,
  assertAnthropicBatchRequestLimits,
  newAnthropicBatchId,
  reconcileActiveAnthropicBatch,
  submitPersistedAnthropicBatch,
  withAnthropicBatchAdvisoryLock
} from "./anthropic-batch-runtime";
import {
  aggregateAnthropicUsage,
  buildNarrativeClassificationRequest,
  createAnthropicBatchApi,
  logAnthropicUsage,
  narrativeClassificationPromptVersion,
  normalizeNarrativeClassificationMessage,
  type AnthropicBatchApi,
  type AnthropicBatchResult
} from "@market-themes/analysis";
import {
  countNarrativeClassificationBacklog,
  createAnthropicMessageBatch,
  getActiveNarrativeDefinitions,
  getAnalysisDocumentsByIds,
  persistNarrativeObservations,
  recordAnthropicBatchItemResult,
  selectDocumentsForNarrativeClassification,
  type AnthropicMessageBatchRecord,
  type NarrativeDefinition
} from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export const narrativeClassificationBatchWorkload =
  "narrative_classification";

export async function runNarrativeClassificationBatch(options: {
  api?: AnthropicBatchApi;
  maxDocuments?: number;
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !options.api) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for batched narrative classification."
    );
  }
  const api = options.api ?? createAnthropicBatchApi();
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_narrative_classification",
    () => executeNarrativeClassificationBatch(api, options.maxDocuments)
  );
  return (
    result ?? {
      documentsSubmitted: 0,
      documentsProcessed: 0,
      observationsStored: 0,
      matchedObservations: 0,
      failedDocuments: 0,
      remainingBacklog: 0,
      batchStatus: "already_running"
    }
  );
}

export async function pollNarrativeClassificationBatch(
  api = createAnthropicBatchApi()
) {
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_narrative_classification",
    () =>
      reconcileActiveAnthropicBatch({
        workload: narrativeClassificationBatchWorkload,
        api,
        processResults: processNarrativeClassificationBatchResults,
        abandon: abandonNarrativeClassificationBatch
      })
  );
  return result ?? { status: "already_running" as const };
}

async function executeNarrativeClassificationBatch(
  api: AnthropicBatchApi,
  configuredMaxDocuments?: number
) {
  const model =
    process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
  const promptVersion =
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  const reconciled = await reconcileActiveAnthropicBatch({
    workload: narrativeClassificationBatchWorkload,
    api,
    processResults: processNarrativeClassificationBatchResults,
    abandon: abandonNarrativeClassificationBatch
  });
  if (
    reconciled.status === "in_progress" ||
    reconciled.status === "canceling" ||
    reconciled.status === "submission_unknown"
  ) {
    const backlog = await countNarrativeClassificationBacklog({
      model,
      promptVersion
    });
    return {
      ...classificationBatchResult(reconciled.status),
      remainingBacklog: backlog.total
    };
  }

  const configuredDocumentLimit =
    configuredMaxDocuments ??
    Number(process.env.NARRATIVE_CLASSIFICATION_MAX_DOCUMENTS ?? 40);
  const maxDocuments = boundedBatchSize(configuredDocumentLimit, 40);
  const definitions = await getActiveNarrativeDefinitions();
  if (definitions.length === 0 || maxDocuments <= 0) {
    return classificationBatchResult("backlog_empty", reconciled);
  }
  const documents = await selectDocumentsForNarrativeClassification({
    model,
    promptVersion,
    limit: maxDocuments
  });
  if (documents.length === 0) {
    return classificationBatchResult("backlog_empty", reconciled);
  }

  const requests = documents.map((document, index) => ({
    custom_id: anthropicBatchCustomId("nc", index, document.id),
    params: buildNarrativeClassificationRequest(document, definitions, {
      model,
      promptCaching: process.env.ANTHROPIC_PROMPT_CACHING !== "false",
      cacheTtl: "1h"
    })
  }));
  const requestBytes = assertAnthropicBatchRequestLimits(requests);
  const batchId = newAnthropicBatchId(
    narrativeClassificationBatchWorkload
  );
  const batch = await createAnthropicMessageBatch({
    id: batchId,
    workload: narrativeClassificationBatchWorkload,
    model,
    promptVersion,
    metadata: {
      definitions,
      requestBytes,
      documentCount: documents.length
    },
    items: documents.map((document, index) => ({
      customId: requests[index].custom_id,
      documentId: document.id,
      metadata: { textHash: document.textHash }
    }))
  });
  if (!batch) throw new Error("Failed to persist the classification batch.");
  const submitted = await submitPersistedAnthropicBatch({
    batch,
    requests,
    api,
    abandon: abandonNarrativeClassificationBatch
  });
  const backlog = await countNarrativeClassificationBacklog({
    model,
    promptVersion
  });
  return {
    ...classificationBatchResult(submitted.status, reconciled),
    documentsSubmitted:
      submitted.status === "submitted" ? documents.length : 0,
    remainingBacklog: backlog.total,
    batchId,
    providerBatchId:
      "providerBatchId" in submitted
        ? submitted.providerBatchId
        : null
  };
}

export async function processNarrativeClassificationBatchResults(
  batch: AnthropicMessageBatchRecord,
  results: AsyncIterable<AnthropicBatchResult>
) {
  const definitions = batch.metadata.definitions;
  if (!Array.isArray(definitions)) {
    throw new Error("Classification batch omitted its definition snapshot.");
  }
  const definitionSnapshot = definitions as NarrativeDefinition[];
  const documents = await getAnalysisDocumentsByIds(
    batch.items.map((item) => item.documentId)
  );
  const documentsById = new Map(
    documents.map((document) => [document.id, document])
  );
  const itemsByCustomId = new Map(
    batch.items.map((item) => [item.customId, item])
  );
  const seen = new Set<string>();
  let documentsProcessed = 0;
  let observationsStored = 0;
  let matchedObservations = 0;
  let failedDocuments = 0;
  const usageSummaries: Array<ReturnType<typeof logAnthropicUsage>> = [];

  for await (const result of results) {
    const item = itemsByCustomId.get(result.custom_id);
    if (!item || seen.has(result.custom_id)) continue;
    seen.add(result.custom_id);
    if (result.result.type !== "succeeded") {
      const error = batchResultError(result);
      await recordAnthropicBatchItemResult({
        batchId: batch.id,
        customId: item.customId,
        status: result.result.type,
        errorType: error.type,
        errorMessage: error.message
      });
      failedDocuments += 1;
      continue;
    }
    const document = documentsById.get(item.documentId);
    let completion:
      | {
          observationsStored: number;
          matchedObservations: number;
          usage: ReturnType<typeof logAnthropicUsage>;
        }
      | undefined;
    try {
      if (!document) throw new Error("Classification document was deleted.");
      if (
        typeof item.metadata.textHash === "string" &&
        item.metadata.textHash !== document.textHash
      ) {
        throw new Error(
          "Document text changed while classification was batched."
        );
      }
      const observations = normalizeNarrativeClassificationMessage(
        result.result.message,
        document,
        definitionSnapshot,
        batch.model,
        batch.promptVersion
      );
      const persisted = await persistNarrativeObservations(observations);
      const usage = logAnthropicUsage(
        "narrative-classification-batch",
        batch.model,
        result.result.message.usage
      );
      usageSummaries.push(usage);
      completion = {
        observationsStored: persisted.inserted,
        matchedObservations: observations.filter(
          (observation) => observation.matched
        ).length,
        usage
      };
    } catch (error) {
      await recordAnthropicBatchItemResult({
        batchId: batch.id,
        customId: item.customId,
        status: "processing_error",
        errorType: "application_error",
        errorMessage: errorMessage(error)
      });
      failedDocuments += 1;
      continue;
    }
    if (!completion) {
      throw new Error("Classification batch completion was not prepared.");
    }
    await recordAnthropicBatchItemResult({
      batchId: batch.id,
      customId: item.customId,
      status: "completed",
      usage: completion.usage,
      metadata: {
        observationsStored: completion.observationsStored,
        matchedObservations: completion.matchedObservations
      }
    });
    documentsProcessed += 1;
    observationsStored += completion.observationsStored;
    matchedObservations += completion.matchedObservations;
  }

  for (const item of batch.items) {
    if (seen.has(item.customId)) continue;
    await recordAnthropicBatchItemResult({
      batchId: batch.id,
      customId: item.customId,
      status: "missing",
      errorType: "missing_result",
      errorMessage: "Anthropic batch results omitted this custom_id."
    });
    failedDocuments += 1;
  }

  return {
    documentsProcessed,
    observationsStored,
    matchedObservations,
    failedDocuments,
    tokenUsage: aggregateAnthropicUsage(usageSummaries)
  };
}

async function abandonNarrativeClassificationBatch(
  batch: AnthropicMessageBatchRecord,
  error: unknown
) {
  for (const item of batch.items) {
    await recordAnthropicBatchItemResult({
      batchId: batch.id,
      customId: item.customId,
      status: "abandoned",
      errorType: "batch_abandoned",
      errorMessage: errorMessage(error)
    });
  }
}

function classificationBatchResult(
  batchStatus: string,
  reconciled?: {
    status: string;
    summary?: Record<string, unknown>;
  }
) {
  const summary = reconciled?.summary ?? {};
  return {
    documentsSubmitted: 0,
    documentsProcessed: numberValue(summary.documentsProcessed),
    observationsStored: numberValue(summary.observationsStored),
    matchedObservations: numberValue(summary.matchedObservations),
    failedDocuments: numberValue(summary.failedDocuments),
    remainingBacklog: 0,
    batchStatus
  };
}

function batchResultError(result: AnthropicBatchResult) {
  if (result.result.type === "errored") {
    return {
      type: result.result.error.error.type,
      message: result.result.error.error.message
    };
  }
  return {
    type: result.result.type,
    message: `Anthropic batch request ${result.result.type}.`
  };
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function boundedBatchSize(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 0), 100_000);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRecordedJob(
    "narrative_classification_batch",
    () => runNarrativeClassificationBatch(),
    (value) => value.documentsProcessed,
    (value) => value.failedDocuments
  );
  console.log(`[classify-narratives-batch] ${JSON.stringify(result)}`);
}
