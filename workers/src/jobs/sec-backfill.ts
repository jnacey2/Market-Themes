import { persistDocuments } from "@market-themes/db";
import { fetchSecFilings, SEC_TARGET_TICKERS } from "@market-themes/ingest";

const userAgent = process.env.SEC_USER_AGENT;

if (!userAgent) {
  throw new Error("SEC_USER_AGENT is required for SEC ingestion.");
}

const batchSize = Number(process.env.SEC_BACKFILL_BATCH_SIZE ?? 10);
const batchIndex = Number(process.env.SEC_BACKFILL_BATCH_INDEX ?? 0);
const months = Number(process.env.SEC_BACKFILL_MONTHS ?? 12);
const maxFilingsPerTicker = Number(
  process.env.SEC_BACKFILL_MAX_FILINGS_PER_TICKER ?? 25
);
const start = batchIndex * batchSize;
const tickers = SEC_TARGET_TICKERS.slice(start, start + batchSize);

if (tickers.length === 0) {
  console.log(
    `[sec-backfill] no tickers for batchIndex=${batchIndex} batchSize=${batchSize}`
  );
  process.exit(0);
}

const documents = await fetchSecFilings({
  tickers,
  userAgent,
  since: monthsAgo(months),
  maxFilingsPerTicker
});

const result = await persistDocuments(documents);

console.log(
  `[sec-backfill] batchIndex=${batchIndex} tickers=${tickers.join(",")} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}
