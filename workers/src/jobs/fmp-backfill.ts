import { persistDocuments } from "@market-themes/db";
import { fetchFmpTranscripts, SEC_TARGET_TICKERS } from "@market-themes/ingest";

const batchSize = Number(process.env.FMP_BACKFILL_BATCH_SIZE ?? 10);
const batchIndex = Number(process.env.FMP_BACKFILL_BATCH_INDEX ?? 0);
const quarters = Number(process.env.FMP_BACKFILL_QUARTERS ?? 8);
const start = batchIndex * batchSize;
const tickers = SEC_TARGET_TICKERS.slice(start, start + batchSize);

if (tickers.length === 0) {
  console.log(
    `[fmp-backfill] no tickers for batchIndex=${batchIndex} batchSize=${batchSize}`
  );
  process.exit(0);
}

const documents = await fetchFmpTranscripts({
  tickers,
  quarters
});

const result = await persistDocuments(documents);

console.log(
  `[fmp-backfill] batchIndex=${batchIndex} tickers=${tickers.join(",")} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);
