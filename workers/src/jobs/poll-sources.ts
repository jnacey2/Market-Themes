import { defaultConnectors } from "@market-themes/ingest";
import { persistDocuments } from "@market-themes/db";

for (const connector of defaultConnectors) {
  const documents = await connector.poll();

  if (documents.length === 0) {
    console.log(`[poll-sources] ${connector.id} returned 0 documents`);
    continue;
  }

  const result = await persistDocuments(documents);
  console.log(
    `[poll-sources] ${connector.id} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
  );
}
