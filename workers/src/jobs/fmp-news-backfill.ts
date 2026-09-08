import { persistDocuments } from "@market-themes/db";
import { fetchFmpNews, resolveNewsTickers } from "@market-themes/ingest";

const MACRO_PROXIES = ["SPY", "QQQ", "TLT", "GLD"];

const lookbackDays = Number(process.env.FMP_NEWS_BACKFILL_DAYS ?? 30);
const batchSize = Number(process.env.FMP_NEWS_BACKFILL_BATCH_SIZE ?? 20);
const batchIndex = Number(process.env.FMP_NEWS_BACKFILL_BATCH_INDEX ?? 0);
const lookbackHours = lookbackDays * 24;

const allTickers = await resolveNewsTickers();
const start = batchIndex * batchSize;
const batchTickers = allTickers.slice(start, start + batchSize);

if (batchTickers.length === 0) {
  console.log(
    `[fmp-news-backfill] no tickers for batchIndex=${batchIndex} batchSize=${batchSize}`
  );
  process.exit(0);
}

console.log(
  `[fmp-news-backfill] batchIndex=${batchIndex} tickers=${batchTickers.length} lookbackDays=${lookbackDays}`
);

const documents = await fetchFmpNews({
  tickers: batchTickers,
  macroProxies: batchIndex === 0
    ? parseTickers(process.env.FMP_NEWS_MACRO_PROXIES) ?? MACRO_PROXIES
    : [],
  lookbackHours,
  newsLimit: 100
});

const result = await persistDocuments(documents);

console.log(
  `[fmp-news-backfill] batchIndex=${batchIndex} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);

function parseTickers(value: string | undefined) {
  if (!value) {
    return null;
  }

  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
