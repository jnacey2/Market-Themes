import {
  classifyDocumentNarratives,
  narrativeClassificationPromptVersion
} from "@market-themes/analysis";
import {
  getActiveNarrativeDefinitions,
  persistNarrativeObservations,
  selectDocumentsForNarrativeClassification
} from "@market-themes/db";
import { pathToFileURL } from "node:url";

export async function classifyNarrativeBatches(options: {
  batchSize?: number;
  maxBatches?: number;
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for narrative classification.");
  }

  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
  const promptVersion =
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    narrativeClassificationPromptVersion;
  const batchSize = options.batchSize ?? Number(process.env.NARRATIVE_CLASSIFICATION_BATCH_SIZE ?? 10);
  const maxBatches = options.maxBatches ?? Number(process.env.NARRATIVE_CLASSIFICATION_MAX_BATCHES ?? 4);
  const definitions = await getActiveNarrativeDefinitions();
  let documentsProcessed = 0;
  let observationsStored = 0;
  let failedDocuments = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const documents = await selectDocumentsForNarrativeClassification({
      model,
      promptVersion,
      limit: batchSize
    });
    if (documents.length === 0) break;

    for (const document of documents) {
      try {
        const observations = await classifyDocumentNarratives(document, definitions, {
          model,
          promptVersion
        });
        const result = await persistNarrativeObservations(observations);
        observationsStored += result.inserted;
        documentsProcessed += 1;
      } catch (error) {
        failedDocuments += 1;
        console.error(
          `[classify-narratives] document=${document.id} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return { documentsProcessed, observationsStored, failedDocuments };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await classifyNarrativeBatches();
  console.log(`[classify-narratives] ${JSON.stringify(result)}`);
}
