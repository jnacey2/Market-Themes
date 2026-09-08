import { pathToFileURL } from "node:url";
import { generateDailyBrief } from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export async function runDailyBrief() {
  const result = await generateDailyBrief({
    date: process.env.BRIEF_DATE || undefined
  });
  return {
    skipped: result.skipped,
    reason: result.reason ?? null,
    briefDate: result.brief?.date ?? null,
    headline: result.brief?.headline ?? null,
    alertsWritten: result.alertsWritten
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.log("[generate-daily-brief] DATABASE_URL is not set; nothing to summarize.");
  } else {
    const result = await runRecordedJob(
      "daily_brief",
      () => runDailyBrief(),
      (value) => (value.briefDate ? 1 : 0)
    );
    console.log(`[generate-daily-brief] ${JSON.stringify(result)}`);
    if (result.headline) console.log(result.headline);
  }
}
