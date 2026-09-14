import { generateResearchQueue } from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";
const result = await runRecordedJob("research_queue",generateResearchQueue,value=>value.leads.length);
console.log(`[research-queue] documents=${result.documentsScanned} leads=${result.leads.length}`);
