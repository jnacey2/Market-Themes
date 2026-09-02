import { persistDocuments } from "@market-themes/db";
import { fetchFmpTranscripts, resolveTargetTickers } from "@market-themes/ingest";

const documents = await fetchFmpTranscripts({
  tickers: await resolveTargetTickers({
    explicit: parseTickers(process.env.FMP_TARGET_TICKERS)
  }),
  quarters: 1,
  latestOnly: true
});

const result = await persistDocuments(documents);

console.log(
  `[fmp-poll] fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}`
);

function parseTickers(value: string | undefined) {
  if (!value) {
    return null;
  }

  return value
    .split(",")
    .map((ticker) => ticker.trim())
    .filter(Boolean);
}
