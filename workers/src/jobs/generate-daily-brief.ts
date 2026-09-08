import { generateDailyNarrativeBrief } from "@market-themes/db";
const brief = await generateDailyNarrativeBrief();
console.log(`[generate-daily-brief] saved ${brief.date}: ${brief.headline}`);
