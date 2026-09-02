import { pathToFileURL } from "node:url";
import {
  aggregateAnthropicUsage,
  buildNarrativeDiscoveryRequest,
  createAnthropicBatchApi,
  logAnthropicUsage,
  narrativeCandidateAnalysisType,
  narrativeDiscoveryPromptVersion,
  normalizeNarrativeDiscoveryMessage,
  type AnthropicBatchApi,
  type AnthropicBatchResult
} from "@market-themes/analysis";
import {
  claimDocumentsForNarrativeDiscovery,
  completeNarrativeDiscoveryRun,
  countNarrativeDiscoveryBacklog,
  createAnthropicMessageBatch,
  failDocumentAnalysisRun,
  failNarrativeDiscoveryRun,
  getTrackedNarrativeDefinitions,
  getAnalysisDocumentsByIds,
  getNarrativeCandidateContexts,
  recordAnthropicBatchItemResult,
  type AnthropicMessageBatchRecord,
  type NarrativeCandidateContext,
  type NarrativeDefinition
} from "@market-themes/db";
import {
  anthropicBatchCustomId,
  assertAnthropicBatchRequestLimits,
  newAnthropicBatchId,
  reconcileActiveAnthropicBatch,
  submitPersistedAnthropicBatch,
  withAnthropicBatchAdvisoryLock
} from "./anthropic-batch-runtime";
import { runRecordedJob } from "./recorded-job";

export const narrativeDiscoveryBatchWorkload = "narrative_discovery";

type DiscoveryBatchOptions = {
  maxDocuments: number;
  lookbackDays: number;
  maxAttempts: number;
  model: string;
  promptVersion: string;
};

export async function runNarrativeDiscoveryBatch(options: {
  api?: AnthropicBatchApi;
  maxDocuments?: number;
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !options.api) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for batched narrative discovery."
    );
  }
  const api = options.api ?? createAnthropicBatchApi();
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_narrative_discovery",
    () => executeNarrativeDiscoveryBatch(api, options.maxDocuments)
  );
  return (
    result ?? {
      documentsSubmitted: 0,
      documentsProcessed: 0,
      candidatesTouched: 0,
      evidenceStored: 0,
      failedDocuments: 0,
      remainingBacklog: 0,
      batchStatus: "already_running"
    }
  );
}

export async function pollNarrativeDiscoveryBatch(
  api = createAnthropicBatchApi()
) {
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_narrative_discovery",
    () =>
      reconcileActiveAnthropicBatch({
        workload: narrativeDiscoveryBatchWorkload,
        api,
        processResults: processNarrativeDiscoveryBatchResults,
        abandon: abandonNarrativeDiscoveryBatch
      })
  );
  return result ?? { status: "already_running" as const };
}

async function executeNarrativeDiscoveryBatch(
  api: AnthropicBatchApi,
  maxDocumentsOverride?: number
) {
  const options = discoveryBatchOptions(maxDocumentsOverride);
  const reconciled = await reconcileActiveAnthropicBatch({
    workload: narrativeDiscoveryBatchWorkload,
    api,
    processResults: processNarrativeDiscoveryBatchResults,
    abandon: abandonNarrativeDiscoveryBatch
  });
  if (
    reconciled.status === "in_progress" ||
    reconciled.status === "canceling" ||
    reconciled.status === "submission_unknown"
  ) {
    const backlog = await countNarrativeDiscoveryBacklog({
      analysisType: narrativeCandidateAnalysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      lookbackDays: options.lookbackDays,
      maxAttempts: options.maxAttempts
    });
    return {
      ...discoveryBatchResult(reconciled.status),
      remainingBacklog: backlog.total
    };
  }

  const [definitions, existingCandidates] = await Promise.all([
    getTrackedNarrativeDefinitions(),
    getNarrativeCandidateContexts(options.promptVersion)
  ]);
  const batchId = newAnthropicBatchId(narrativeDiscoveryBatchWorkload);
  const documents = await claimDocumentsForNarrativeDiscovery({
    analysisType: narrativeCandidateAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    limit: options.maxDocuments,
    lookbackDays: options.lookbackDays,
    maxAttempts: options.maxAttempts,
    executionMode: "anthropic_batch",
    anthropicBatchId: batchId
  });
  if (documents.length === 0) {
    return discoveryBatchResult("backlog_empty", reconciled);
  }

  const requests = documents.map((document, index) => ({
    custom_id: anthropicBatchCustomId("nd", index, document.id),
    params: buildNarrativeDiscoveryRequest(
      document,
      definitions,
      existingCandidates,
      { model: options.model }
    )
  }));
  const requestBytes = assertAnthropicBatchRequestLimits(requests);
  let batch: AnthropicMessageBatchRecord;
  try {
    const persisted = await createAnthropicMessageBatch({
      id: batchId,
      workload: narrativeDiscoveryBatchWorkload,
      model: options.model,
      promptVersion: options.promptVersion,
      metadata: {
        definitions,
        existingCandidates,
        requestBytes,
        documentCount: documents.length
      },
      items: documents.map((document, index) => ({
        customId: requests[index].custom_id,
        documentId: document.id,
        analysisRunId: document.analysisRunId,
        metadata: {
          textHash: document.textHash,
          attemptToken: document.attemptToken
        }
      }))
    });
    if (!persisted) throw new Error("Failed to persist the discovery batch.");
    batch = persisted;
  } catch (error) {
    for (const document of documents) {
      await failNarrativeDiscoveryRun(
        document.analysisRunId,
        document.attemptToken,
        error
      ).catch(() => undefined);
    }
    throw error;
  }
  const submitted = await submitPersistedAnthropicBatch({
    batch,
    requests,
    api,
    abandon: abandonNarrativeDiscoveryBatch
  });
  const backlog = await countNarrativeDiscoveryBacklog({
    analysisType: narrativeCandidateAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    lookbackDays: options.lookbackDays,
    maxAttempts: options.maxAttempts
  });
  return {
    ...discoveryBatchResult(submitted.status, reconciled),
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

export async function processNarrativeDiscoveryBatchResults(
  batch: AnthropicMessageBatchRecord,
  results: AsyncIterable<AnthropicBatchResult>
) {
  const definitions = batch.metadata.definitions;
  const existingCandidates = batch.metadata.existingCandidates;
  if (!Array.isArray(definitions) || !Array.isArray(existingCandidates)) {
    throw new Error("Discovery batch omitted its context snapshot.");
  }
  const definitionSnapshot = definitions as NarrativeDefinition[];
  const candidateSnapshot =
    existingCandidates as NarrativeCandidateContext[];
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
  let failedDocuments = 0;
  let candidatesTouched = 0;
  let evidenceStored = 0;
  const usageSummaries: Array<ReturnType<typeof logAnthropicUsage>> = [];

  for await (const result of results) {
    const item = itemsByCustomId.get(result.custom_id);
    if (!item || seen.has(result.custom_id)) continue;
    seen.add(result.custom_id);
    if (result.result.type !== "succeeded") {
      const error = batchResultError(result);
      await failDiscoveryItem(
        batch,
        item,
        result.result.type,
        error.type,
        error.message
      );
      failedDocuments += 1;
      continue;
    }
    const document = documentsById.get(item.documentId);
    let completion:
      | {
          candidatesTouched: number;
          evidenceStored: number;
          usage: ReturnType<typeof logAnthropicUsage>;
        }
      | undefined;
    try {
      if (!document) throw new Error("Discovery document was deleted.");
      if (
        typeof item.metadata.textHash === "string" &&
        item.metadata.textHash !== document.textHash
      ) {
        throw new Error("Document text changed while discovery was batched.");
      }
      if (!item.analysisRunId) {
        throw new Error("Discovery analysis run is missing.");
      }
      const candidates = normalizeNarrativeDiscoveryMessage(
        result.result.message,
        document,
        definitionSnapshot,
        candidateSnapshot,
        {
          model: batch.model,
          promptVersion: batch.promptVersion,
          maxEvidenceChars: 800
        }
      );
      const persisted = await completeNarrativeDiscoveryRun(
        item.analysisRunId,
        candidates,
        {
          attemptToken:
            typeof item.metadata.attemptToken === "string"
              ? item.metadata.attemptToken
              : undefined
        }
      );
      const usage = logAnthropicUsage(
        "narrative-discovery-batch",
        batch.model,
        result.result.message.usage
      );
      usageSummaries.push(usage);
      completion = {
        candidatesTouched: persisted.candidatesTouched,
        evidenceStored: persisted.insertedEvidence,
        usage
      };
    } catch (error) {
      await failDiscoveryItem(
        batch,
        item,
        "processing_error",
        "application_error",
        errorMessage(error)
      );
      failedDocuments += 1;
      continue;
    }
    if (!completion) {
      throw new Error("Discovery batch completion was not prepared.");
    }
    await recordAnthropicBatchItemResult({
      batchId: batch.id,
      customId: item.customId,
      status: "completed",
      usage: completion.usage,
      metadata: {
        candidatesTouched: completion.candidatesTouched,
        evidenceStored: completion.evidenceStored
      }
    });
    documentsProcessed += 1;
    candidatesTouched += completion.candidatesTouched;
    evidenceStored += completion.evidenceStored;
  }

  for (const item of batch.items) {
    if (seen.has(item.customId)) continue;
    await failDiscoveryItem(
      batch,
      item,
      "missing",
      "missing_result",
      "Anthropic batch results omitted this custom_id."
    );
    failedDocuments += 1;
  }

  return {
    documentsProcessed,
    failedDocuments,
    candidatesTouched,
    evidenceStored,
    tokenUsage: aggregateAnthropicUsage(usageSummaries)
  };
}

async function failDiscoveryItem(
  batch: AnthropicMessageBatchRecord,
  item: AnthropicMessageBatchRecord["items"][number],
  status: string,
  errorType: string,
  message: string
) {
  const attemptToken =
    typeof item.metadata.attemptToken === "string"
      ? item.metadata.attemptToken
      : "";
  if (item.analysisRunId && attemptToken) {
    await failNarrativeDiscoveryRun(
      item.analysisRunId,
      attemptToken,
      message
    );
  } else if (item.analysisRunId) {
    await failDocumentAnalysisRun(item.analysisRunId, message);
  }
  await recordAnthropicBatchItemResult({
    batchId: batch.id,
    customId: item.customId,
    status,
    errorType,
    errorMessage: message
  });
}

async function abandonNarrativeDiscoveryBatch(
  batch: AnthropicMessageBatchRecord,
  error: unknown
) {
  for (const item of batch.items) {
    await failDiscoveryItem(
      batch,
      item,
      "abandoned",
      "batch_abandoned",
      errorMessage(error)
    );
  }
}

function discoveryBatchOptions(
  maxDocumentsOverride?: number
): DiscoveryBatchOptions {
  const maxDocuments = boundedBatchSize(
    maxDocumentsOverride ??
      Number(process.env.NARRATIVE_DISCOVERY_MAX_DOCUMENTS ?? 40),
    40
  );
  return {
    maxDocuments,
    lookbackDays: Number(
      process.env.NARRATIVE_DISCOVERY_LOOKBACK_DAYS ?? 30
    ),
    maxAttempts: Number(
      process.env.NARRATIVE_DISCOVERY_MAX_ATTEMPTS ?? 5
    ),
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    promptVersion:
      process.env.NARRATIVE_DISCOVERY_PROMPT_VERSION ??
      narrativeDiscoveryPromptVersion
  };
}

function discoveryBatchResult(
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
    candidatesTouched: numberValue(summary.candidatesTouched),
    evidenceStored: numberValue(summary.evidenceStored),
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
    "narrative_discovery_batch",
    () => runNarrativeDiscoveryBatch(),
    (value) => value.documentsProcessed,
    (value) => value.failedDocuments
  );
  console.log(`[discover-narratives-batch] ${JSON.stringify(result)}`);
}
