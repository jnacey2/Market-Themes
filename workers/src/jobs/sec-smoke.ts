import { persistDocuments } from "@market-themes/db";
import { fetchSecFilings, SEC_SMOKE_TEST_TICKERS } from "@market-themes/ingest";

const userAgent = process.env.SEC_USER_AGENT;

if (!userAgent) {
  throw new Error("SEC_USER_AGENT is required for SEC ingestion.");
}

const documents = await fetchSecFilings({
  tickers: SEC_SMOKE_TEST_TICKERS,
  userAgent,
  since: monthsAgo(12),
  maxFilingsPerTicker: Number(process.env.SEC_SMOKE_MAX_FILINGS_PER_TICKER ?? 3)
});

const result = await persistDocuments(documents);

console.log(
  `[sec-smoke] tickers=${SEC_SMOKE_TEST_TICKERS.join(",")} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);

function monthsAgo(months: number) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}
