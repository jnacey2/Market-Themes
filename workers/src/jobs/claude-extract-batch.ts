import { pathToFileURL } from "node:url";
import {
  aggregateAnthropicUsage,
  buildSignalExtractionRequest,
  createAnthropicBatchApi,
  dedupeExtractedSignals,
  logAnthropicUsage,
  marketSignalAnalysisType,
  normalizeSignalExtractionMessage,
  prepareSignalExtractionSections,
  signalExtractionPromptVersion,
  type AnthropicBatchApi,
  type AnthropicBatchRequest,
  type AnthropicBatchResult,
  type SignalExtractionSection
} from "@market-themes/analysis";
import {
  completeDocumentAnalysisRun,
  createAnthropicMessageBatch,
  failDocumentAnalysisRun,
  getAnalysisDocumentsByIds,
  recordAnthropicBatchItemResult,
  selectDocumentsForAnalysis,
  startDocumentAnalysisRun,
  type AnalysisDocument,
  type AnthropicMessageBatchRecord,
  type ExtractedSignalInput
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

export const signalExtractionBatchWorkload = "signal_extraction";

type ExtractionBatchOptions = {
  model: string;
  promptVersion: string;
  maxDocuments: number;
  lookbackDays?: number;
  excludedSecFilingCategories: string[];
  maxAnalysisAttempts: number;
  maxDocumentChars: number;
  sectionChars: number;
  sectionOverlap: number;
  maxEvidenceChars: number;
  maxTokens: number;
};

type PreparedExtractionDocument = {
  document: AnalysisDocument;
  sections: SignalExtractionSection[];
};

export async function runClaudeExtractionBatch(options: {
  api?: AnthropicBatchApi;
  maxDocuments?: number;
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !options.api) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for batched Claude extraction."
    );
  }
  const api = options.api ?? createAnthropicBatchApi();
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_signal_extraction",
    () => executeClaudeExtractionBatch(api, options.maxDocuments)
  );
  return (
    result ?? {
      documentsSubmitted: 0,
      completedDocuments: 0,
      failedDocuments: 0,
      insertedSignals: 0,
      themesTouched: 0,
      batchStatus: "already_running"
    }
  );
}

export async function pollSignalExtractionBatch(
  api = createAnthropicBatchApi()
) {
  const result = await withAnthropicBatchAdvisoryLock(
    "market_themes_signal_extraction",
    () =>
      reconcileActiveAnthropicBatch({
        workload: signalExtractionBatchWorkload,
        api,
        processResults: processSignalExtractionBatchResults,
        abandon: abandonSignalExtractionBatch
      })
  );
  return result ?? { status: "already_running" as const };
}

async function executeClaudeExtractionBatch(
  api: AnthropicBatchApi,
  maxDocumentsOverride?: number
) {
  const reconciled = await reconcileActiveAnthropicBatch({
    workload: signalExtractionBatchWorkload,
    api,
    processResults: processSignalExtractionBatchResults,
    abandon: abandonSignalExtractionBatch
  });
  if (
    reconciled.status === "in_progress" ||
    reconciled.status === "canceling" ||
    reconciled.status === "submission_unknown"
  ) {
    return extractionBatchResult(reconciled.status);
  }

  const options = extractionBatchOptions(maxDocumentsOverride);
  const documents = await selectDocumentsForAnalysis({
    analysisType: marketSignalAnalysisType,
    model: options.model,
    promptVersion: options.promptVersion,
    limit: options.maxDocuments,
    lookbackDays: options.lookbackDays,
    excludedSecFilingCategories: options.excludedSecFilingCategories,
    maxAttempts: options.maxAnalysisAttempts
  });
  if (documents.length === 0) {
    return extractionBatchResult("backlog_empty", reconciled);
  }
  const prepared = fitExtractionDocumentsToBatch(documents, options);
  const batchId = newAnthropicBatchId(signalExtractionBatchWorkload);
  const runIds = new Map<string, string>();
  let requests: AnthropicBatchRequest[];
  let batch: AnthropicMessageBatchRecord;
  try {
    for (const item of prepared) {
      const runId = await startDocumentAnalysisRun(item.document.id, {
        analysisType: marketSignalAnalysisType,
        model: options.model,
        promptVersion: options.promptVersion,
        metadata: {
          sourceId: item.document.sourceId,
          sourceClass: item.document.sourceClass,
          textHash: item.document.textHash,
          executionMode: "anthropic_batch",
          anthropicBatchId: batchId
        }
      });
      runIds.set(item.document.id, runId);
    }

    const preparedBatch = extractionBatchRequests(
      prepared,
      runIds,
      options
    );
    requests = preparedBatch.requests;
    const requestBytes = assertAnthropicBatchRequestLimits(requests);
    const persisted = await createAnthropicMessageBatch({
      id: batchId,
      workload: signalExtractionBatchWorkload,
      model: options.model,
      promptVersion: options.promptVersion,
      metadata: {
        requestBytes,
        documentCount: prepared.length,
        extractionOptions: {
          maxDocumentChars: options.maxDocumentChars,
          sectionChars: options.sectionChars,
          sectionOverlap: options.sectionOverlap,
          maxEvidenceChars: options.maxEvidenceChars,
          maxTokens: options.maxTokens
        }
      },
      items: preparedBatch.items
    });
    if (!persisted) throw new Error("Failed to persist the extraction batch.");
    batch = persisted;
  } catch (error) {
    for (const runId of runIds.values()) {
      await failDocumentAnalysisRun(runId, error).catch(() => undefined);
    }
    throw error;
  }
  const submitted = await submitPersistedAnthropicBatch({
    batch,
    requests,
    api,
    abandon: abandonSignalExtractionBatch
  });
  return {
    ...extractionBatchResult(submitted.status, reconciled),
    documentsSubmitted:
      submitted.status === "submitted" ? prepared.length : 0,
    requestsSubmitted:
      submitted.status === "submitted" ? requests.length : 0,
    batchId,
    providerBatchId:
      "providerBatchId" in submitted
        ? submitted.providerBatchId
        : null
  };
}

export async function processSignalExtractionBatchResults(
  batch: AnthropicMessageBatchRecord,
  results: AsyncIterable<AnthropicBatchResult>
) {
  const extractionOptions = batch.metadata.extractionOptions;
  if (!isRecord(extractionOptions)) {
    throw new Error("Extraction batch omitted its request options.");
  }
  const documents = await getAnalysisDocumentsByIds(
    [...new Set(batch.items.map((item) => item.documentId))]
  );
  const documentsById = new Map(
    documents.map((document) => [document.id, document])
  );
  const itemsByCustomId = new Map(
    batch.items.map((item) => [item.customId, item])
  );
  const signalsByDocument = new Map<string, ExtractedSignalInput[]>();
  const errorsByDocument = new Map<string, Error>();
  const usageByCustomId = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  const providerFailed = new Set<string>();
  const usageSummaries: Array<ReturnType<typeof logAnthropicUsage>> = [];

  for await (const result of results) {
    const item = itemsByCustomId.get(result.custom_id);
    if (!item || seen.has(result.custom_id)) continue;
    seen.add(result.custom_id);
    if (result.result.type !== "succeeded") {
      const error = batchResultError(result);
      errorsByDocument.set(item.documentId, new Error(error.message));
      providerFailed.add(item.customId);
      await recordAnthropicBatchItemResult({
        batchId: batch.id,
        customId: item.customId,
        status: result.result.type,
        errorType: error.type,
        errorMessage: error.message
      });
      continue;
    }
    const document = documentsById.get(item.documentId);
    try {
      if (!document) throw new Error("Extraction document was deleted.");
      if (
        typeof item.metadata.textHash === "string" &&
        item.metadata.textHash !== document.textHash
      ) {
        throw new Error("Document text changed while extraction was batched.");
      }
      const sections = prepareSignalExtractionSections(document, {
        maxDocumentChars: numberValue(
          extractionOptions.maxDocumentChars,
          120_000
        ),
        sectionChars: numberValue(extractionOptions.sectionChars, 60_000),
        sectionOverlap: numberValue(extractionOptions.sectionOverlap, 2_000)
      });
      const sectionIndex = numberValue(item.metadata.sectionIndex, -1);
      const section = sections[sectionIndex];
      if (!section) throw new Error("Extraction section index is invalid.");
      const signals = normalizeSignalExtractionMessage(
        result.result.message,
        document,
        section,
        {
          model: batch.model,
          promptVersion: batch.promptVersion,
          maxEvidenceChars: numberValue(
            extractionOptions.maxEvidenceChars,
            800
          )
        }
      );
      const existing = signalsByDocument.get(document.id) ?? [];
      existing.push(...signals);
      signalsByDocument.set(document.id, existing);
      const usage = logAnthropicUsage(
        "signal-extraction-batch",
        batch.model,
        result.result.message.usage
      );
      usageByCustomId.set(item.customId, usage);
      usageSummaries.push(usage);
    } catch (error) {
      errorsByDocument.set(item.documentId, asError(error));
    }
  }

  for (const item of batch.items) {
    if (!seen.has(item.customId)) {
      errorsByDocument.set(
        item.documentId,
        new Error("Anthropic batch results omitted an extraction section.")
      );
    }
  }

  let completedDocuments = 0;
  let failedDocuments = 0;
  let insertedSignals = 0;
  let themesTouched = 0;
  const itemsByDocument = groupItemsByDocument(batch);
  for (const [documentId, items] of itemsByDocument) {
    const runId = items[0]?.analysisRunId;
    const error = errorsByDocument.get(documentId);
    if (!runId || error) {
      if (runId) await failDocumentAnalysisRun(runId, error ?? "Missing run.");
      for (const item of items) {
        if (providerFailed.has(item.customId)) continue;
        await recordAnthropicBatchItemResult({
          batchId: batch.id,
          customId: item.customId,
          status: "processing_error",
          errorType: "application_error",
          errorMessage: error?.message ?? "Extraction analysis run is missing.",
          usage: usageByCustomId.get(item.customId) ?? {}
        });
      }
      failedDocuments += 1;
      continue;
    }
    const signals = dedupeExtractedSignals(
      signalsByDocument.get(documentId) ?? []
    );
    let persisted:
      | { insertedSignals: number; themesTouched: number }
      | undefined;
    try {
      persisted = await completeDocumentAnalysisRun(runId, signals);
    } catch (completionError) {
      const message = errorMessage(completionError);
      await failDocumentAnalysisRun(runId, completionError);
      for (const item of items) {
        await recordAnthropicBatchItemResult({
          batchId: batch.id,
          customId: item.customId,
          status: "processing_error",
          errorType: "persistence_error",
          errorMessage: message
        });
      }
      failedDocuments += 1;
      continue;
    }
    if (!persisted) {
      throw new Error("Extraction batch completion was not prepared.");
    }
    for (const item of items) {
      await recordAnthropicBatchItemResult({
        batchId: batch.id,
        customId: item.customId,
        status: "completed",
        usage: usageByCustomId.get(item.customId) ?? {}
      });
    }
    completedDocuments += 1;
    insertedSignals += persisted.insertedSignals;
    themesTouched += persisted.themesTouched;
  }

  return {
    completedDocuments,
    failedDocuments,
    insertedSignals,
    themesTouched,
    tokenUsage: aggregateAnthropicUsage(usageSummaries)
  };
}

async function abandonSignalExtractionBatch(
  batch: AnthropicMessageBatchRecord,
  error: unknown
) {
  const failedRuns = new Set<string>();
  for (const item of batch.items) {
    if (item.analysisRunId && !failedRuns.has(item.analysisRunId)) {
      failedRuns.add(item.analysisRunId);
      await failDocumentAnalysisRun(item.analysisRunId, error);
    }
    await recordAnthropicBatchItemResult({
      batchId: batch.id,
      customId: item.customId,
      status: "abandoned",
      errorType: "batch_abandoned",
      errorMessage: errorMessage(error)
    });
  }
}

function extractionBatchOptions(
  maxDocumentsOverride?: number
): ExtractionBatchOptions {
  const sectionChars = positiveInteger(
    process.env.CLAUDE_SECTION_CHARS,
    60_000
  );
  return {
    model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    promptVersion:
      process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion,
    maxDocuments: boundedBatchSize(
      maxDocumentsOverride ??
        Number(process.env.CLAUDE_EXTRACTION_MAX_DOCUMENTS ?? 100),
      100
    ),
    lookbackDays: optionalNumber(
      process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS
    ),
    excludedSecFilingCategories: parseCsv(
      process.env.CLAUDE_EXCLUDED_SEC_CATEGORIES ?? "capital_markets"
    ),
    maxAnalysisAttempts: Number(
      process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5
    ),
    maxDocumentChars: positiveInteger(
      process.env.CLAUDE_MAX_DOCUMENT_CHARS,
      120_000
    ),
    sectionChars,
    sectionOverlap: Math.min(
      nonNegativeInteger(process.env.CLAUDE_SECTION_OVERLAP, 2_000),
      sectionChars - 1
    ),
    maxEvidenceChars: positiveInteger(
      process.env.CLAUDE_MAX_EVIDENCE_CHARS,
      800
    ),
    maxTokens: positiveInteger(
      process.env.CLAUDE_EXTRACTION_MAX_TOKENS,
      8_000
    )
  };
}

function fitExtractionDocumentsToBatch(
  documents: AnalysisDocument[],
  options: ExtractionBatchOptions
) {
  const prepared: PreparedExtractionDocument[] = [];
  for (const document of documents) {
    const candidate = [
      ...prepared,
      {
        document,
        sections: prepareSignalExtractionSections(document, options)
      }
    ];
    const requests = previewExtractionRequests(candidate, options);
    try {
      assertAnthropicBatchRequestLimits(requests);
      prepared.push(candidate[candidate.length - 1]);
    } catch (error) {
      if (prepared.length === 0) throw error;
      break;
    }
  }
  return prepared;
}

function previewExtractionRequests(
  prepared: PreparedExtractionDocument[],
  options: ExtractionBatchOptions
) {
  let requestIndex = 0;
  return prepared.flatMap(({ document, sections }) =>
    sections.map((section) => ({
      custom_id: anthropicBatchCustomId(
        "se",
        requestIndex++,
        `${document.id}:${section.label}`
      ),
      params: buildSignalExtractionRequest(document, section, {
        model: options.model,
        maxTokens: options.maxTokens
      })
    }))
  );
}

function extractionBatchRequests(
  prepared: PreparedExtractionDocument[],
  runIds: Map<string, string>,
  options: ExtractionBatchOptions
): {
  requests: AnthropicBatchRequest[];
  items: Array<{
    customId: string;
    documentId: string;
    analysisRunId: string;
    metadata: Record<string, unknown>;
  }>;
} {
  const requests = previewExtractionRequests(prepared, options);
  let requestIndex = 0;
  const items = prepared.flatMap(({ document, sections }) =>
    sections.map((section, sectionIndex) => {
      const customId = requests[requestIndex++].custom_id;
      return {
        customId,
        documentId: document.id,
        analysisRunId: runIds.get(document.id)!,
        metadata: {
          textHash: document.textHash,
          sectionIndex,
          sectionLabel: section.label
        }
      };
    })
  );
  return { requests, items };
}

function groupItemsByDocument(batch: AnthropicMessageBatchRecord) {
  const grouped = new Map<string, AnthropicMessageBatchRecord["items"]>();
  for (const item of batch.items) {
    const items = grouped.get(item.documentId) ?? [];
    items.push(item);
    grouped.set(item.documentId, items);
  }
  return grouped;
}

function extractionBatchResult(
  batchStatus: string,
  reconciled?: {
    status: string;
    summary?: Record<string, unknown>;
  }
) {
  const summary = reconciled?.summary ?? {};
  return {
    documentsSubmitted: 0,
    completedDocuments: numberValue(summary.completedDocuments, 0),
    failedDocuments: numberValue(summary.failedDocuments, 0),
    insertedSignals: numberValue(summary.insertedSignals, 0),
    themesTouched: numberValue(summary.themesTouched, 0),
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

function numberValue(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedBatchSize(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 0), 100_000);
}

function optionalNumber(value: string | undefined) {
  if (value === undefined || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.floor(number)
    : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.floor(number)
    : fallback;
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRecordedJob(
    "signal_extraction_batch",
    () => runClaudeExtractionBatch(),
    (result) => result.completedDocuments,
    (result) => result.failedDocuments
  ).then((result) => {
    console.log(`[claude-extract-batch] ${JSON.stringify(result)}`);
  });
}
