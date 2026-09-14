import { pathToFileURL } from "node:url";
import { getResearchTargetTickers, persistDocuments } from "@market-themes/db";
import { fetchSecFilings, fetchFmpTranscripts } from "@market-themes/ingest";
import { runRecordedJob } from "./recorded-job";

export async function pollResearchSources() {
  const explicit = process.env.FMP_TARGET_TICKERS?.split(",").map(t => t.trim()).filter(Boolean);
  const tickers = explicit?.length ? explicit.slice(0,30) : await getResearchTargetTickers();
  let inserted = 0;
  let fetched = 0;
  const errors: string[] = [];
  if (tickers.length && process.env.SEC_USER_AGENT) {
    try {
      const documents = await fetchSecFilings({ tickers, since: new Date(Date.now()-30*86400000), maxFilingsPerTicker: 4,
        userAgent: process.env.SEC_USER_AGENT,
        formConfig: { includeCoreForms:true, includeForeignForms:true, include8kForms:true, includeProxyForms:false, includeCapitalMarketsForms:false, includeOwnershipForms:false, includeStructuredOwnershipForms:false, includeStressForms:false, include8kExhibits:true, include6kExhibits:true } });
      fetched += documents.length;
      inserted += (await persistDocuments(documents)).insertedDocuments;
    } catch (error) { errors.push(`SEC: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const ticker of tickers) {
    try {
      const documents = await fetchFmpTranscripts({ tickers:[ticker], latestOnly:true, quarters:1 });
      fetched += documents.length;
      inserted += (await persistDocuments(documents)).insertedDocuments;
    } catch (error) { errors.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { tickers, fetched, inserted, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRecordedJob("research_sources",pollResearchSources,value=>value.fetched,value=>value.errors.length);
  console.log(`[research-sources] ${JSON.stringify(result)}`);
}
