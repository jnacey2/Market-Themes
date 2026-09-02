import { persistDocuments } from "@market-themes/db";
import { fetchFmpNews, resolveNewsTickers } from "@market-themes/ingest";

const MACRO_PROXIES = ["SPY", "QQQ", "TLT", "GLD"];

const documents = await fetchFmpNews({
  tickers: await resolveNewsTickers(),
  macroProxies: parseTickers(process.env.FMP_NEWS_MACRO_PROXIES) ?? MACRO_PROXIES,
  lookbackHours: Number(process.env.FMP_NEWS_LOOKBACK_HOURS ?? 6)
});

const result = await persistDocuments(documents);

console.log(
  `[fmp-news-poll] fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
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
