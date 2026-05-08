import { repairMissingDocumentTextsFromChunks } from "@market-themes/db";

const batchSize = Number(process.env.REPAIR_DOCUMENT_TEXTS_BATCH_SIZE ?? 25);
const maxBatches = Number(process.env.REPAIR_DOCUMENT_TEXTS_MAX_BATCHES ?? 20);

let totalRepaired = 0;
let remaining = 0;

for (let batchIndex = 1; batchIndex <= maxBatches; batchIndex += 1) {
  const result = await repairMissingDocumentTextsFromChunks({ limit: batchSize });
  totalRepaired += result.repairedDocuments;
  remaining = result.remainingMissingTextDocuments;

  console.log(
    `[repair-document-texts] batch=${batchIndex}/${maxBatches} repaired=${result.repairedDocuments} total=${totalRepaired} remaining=${remaining}`
  );

  if (result.repairedDocuments === 0 || remaining === 0) {
    break;
  }
}

console.log(`[repair-document-texts] repaired=${totalRepaired} remaining=${remaining}`);
