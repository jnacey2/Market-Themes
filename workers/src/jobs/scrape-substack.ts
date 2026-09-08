import { pathToFileURL } from "node:url";
import {
  parseSubstackScrapeArgs,
  scrapeSubstackPublications
} from "@market-themes/ingest";

export {
  parseSubstackScrapeArgs,
  scrapeSubstackPublications,
  type SubstackScrapeArgs,
  type SubstackScrapeSummary
} from "@market-themes/ingest";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summaries = await scrapeSubstackPublications(parseSubstackScrapeArgs(process.argv.slice(2)));
  const failed = summaries.filter((summary) => summary.error);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}
