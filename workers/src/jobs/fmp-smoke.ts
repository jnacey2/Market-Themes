import { persistDocuments } from "@market-themes/db";
import { fetchFmpSmokeTranscripts } from "@market-themes/ingest";

const documents = await fetchFmpSmokeTranscripts({
  quarters: Number(process.env.FMP_SMOKE_QUARTERS ?? 2)
});

const result = await persistDocuments(documents);

console.log(
  `[fmp-smoke] fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);
