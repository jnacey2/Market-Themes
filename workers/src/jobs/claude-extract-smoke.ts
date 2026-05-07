import {
  extractSignalsFromDocument,
  marketSignalAnalysisType,
  signalExtractionPromptVersion
} from "@market-themes/analysis";
import {
  completeDocumentAnalysisRun,
  failDocumentAnalysisRun,
  selectDocumentsForAnalysis,
  startDocumentAnalysisRun
} from "@market-themes/db";

const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
const promptVersion = process.env.CLAUDE_PROMPT_VERSION ?? signalExtractionPromptVersion;
const documentLimit = Number(process.env.CLAUDE_EXTRACTION_DOCUMENT_LIMIT ?? 20);
const lookbackDays = optionalNumber(process.env.CLAUDE_EXTRACTION_LOOKBACK_DAYS);
const maxEvidenceChars = Number(process.env.CLAUDE_MAX_EVIDENCE_CHARS ?? 800);
const excludedSecFilingCategories = parseCsv(
  process.env.CLAUDE_EXCLUDED_SEC_CATEGORIES ?? "capital_markets"
);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for Claude extraction.");
}

const documents = await selectDocumentsForAnalysis({
  analysisType: marketSignalAnalysisType,
  model,
  promptVersion,
  limit: documentLimit,
  lookbackDays,
  excludedSecFilingCategories
});

let completedDocuments = 0;
let failedDocuments = 0;
let insertedSignals = 0;
let themesTouched = 0;

for (const document of documents) {
  console.log(
    `[claude-extract-smoke] analyzing document=${document.id} source=${document.sourceId} published=${document.publishedAt}`
  );

  const runId = await startDocumentAnalysisRun(document.id, {
    analysisType: marketSignalAnalysisType,
    model,
    promptVersion,
    metadata: {
      sourceId: document.sourceId,
      sourceClass: document.sourceClass,
      textHash: document.textHash
    }
  });

  try {
    const signals = await extractWithRetry(document, {
      model,
      promptVersion,
      maxEvidenceChars
    });
    const result = await completeDocumentAnalysisRun(runId, signals);
    completedDocuments += 1;
    insertedSignals += result.insertedSignals;
    themesTouched += result.themesTouched;
    console.log(
      `[claude-extract-smoke] completed document=${document.id} signals=${result.insertedSignals} themes=${result.themesTouched}`
    );
  } catch (error) {
    failedDocuments += 1;
    await failDocumentAnalysisRun(runId, error);
    console.error(
      `[claude-extract-smoke] failed document=${document.id} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

console.log(
  `[claude-extract-smoke] selected=${documents.length} completed=${completedDocuments} failed=${failedDocuments} signals=${insertedSignals} themes=${themesTouched} model=${model} promptVersion=${promptVersion}`
);

async function extractWithRetry(
  document: (typeof documents)[number],
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
      `[claude-extract-smoke] retrying document=${document.id} after error=${
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
