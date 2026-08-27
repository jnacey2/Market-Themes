import { defaultConnectors } from "@market-themes/ingest";
import { persistDocuments, recordConnectorCheckpoint } from "@market-themes/db";
import { pathToFileURL } from "node:url";

export async function pollSources() {
  let fetched = 0;
  let inserted = 0;
  let failed = 0;

  for (const connector of defaultConnectors) {
    try {
      const documents = await connector.poll();
      fetched += documents.length;

      if (documents.length === 0) {
        console.log(`[poll-sources] ${connector.id} returned 0 documents`);
        await recordConnectorCheckpoint({ connectorId: connector.id, success: true });
        continue;
      }

      const result = await persistDocuments(documents);
      inserted += result.insertedDocuments;
      await recordConnectorCheckpoint({
        connectorId: connector.id,
        success: true,
        documentsFetched: documents.length,
        documentsInserted: result.insertedDocuments,
        lastDocumentAt: newestDocumentDate(documents)
      });
      console.log(
        `[poll-sources] ${connector.id} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[poll-sources] ${connector.id} failed: ${message}`);
      await recordConnectorCheckpoint({
        connectorId: connector.id,
        success: false,
        error: message
      });
    }
  }

  return { fetched, inserted, failed };
}

function newestDocumentDate(documents: Array<{ publishedAt: string }>) {
  return documents.reduce<string | null>(
    (latest, document) =>
      !latest || document.publishedAt > latest ? document.publishedAt : latest,
    null
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await pollSources();
}
