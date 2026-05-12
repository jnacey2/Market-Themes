import { persistDocuments } from "@market-themes/db";
import { fetchFmpNews, SEC_TARGET_TICKERS } from "@market-themes/ingest";

const MACRO_PROXIES = ["SPY", "QQQ", "TLT", "GLD"];

const documents = await fetchFmpNews({
  tickers: parseTickers(process.env.FMP_NEWS_TICKERS) ?? SEC_TARGET_TICKERS,
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
