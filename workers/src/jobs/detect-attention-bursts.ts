import { pathToFileURL } from "node:url";
import {
  DEFAULT_BURST_OPTIONS,
  detectAttentionBursts
} from "@market-themes/analysis";
import { loadBurstCorpus, persistAttentionBursts } from "@market-themes/db";
import { runRecordedJob } from "./recorded-job";

export async function runAttentionBurstDetection(
  overrides: { asOfDate?: string; baselineDays?: number; windowDays?: number } = {}
) {
  const asOfDate =
    overrides.asOfDate ??
    process.env.ATTENTION_BURST_AS_OF_DATE ??
    new Date().toISOString().slice(0, 10);
  const windowDays =
    overrides.windowDays ??
    Number(process.env.ATTENTION_BURST_WINDOW_DAYS ?? DEFAULT_BURST_OPTIONS.windowDays);
  const baselineDays =
    overrides.baselineDays ??
    Number(process.env.ATTENTION_BURST_BASELINE_DAYS ?? DEFAULT_BURST_OPTIONS.baselineDays);
  const corpus = await loadBurstCorpus({
    asOfDate,
    lookbackDays: windowDays + baselineDays
  });
  const bursts = detectAttentionBursts(corpus, asOfDate, {
    windowDays,
    baselineDays,
    minimumStories: Number(
      process.env.ATTENTION_BURST_MIN_STORIES ?? DEFAULT_BURST_OPTIONS.minimumStories
    ),
    minimumOwners: Number(
      process.env.ATTENTION_BURST_MIN_OWNERS ?? DEFAULT_BURST_OPTIONS.minimumOwners
    ),
    minimumZ: Number(process.env.ATTENTION_BURST_MIN_Z ?? DEFAULT_BURST_OPTIONS.minimumZ),
    maxResults: Number(
      process.env.ATTENTION_BURST_MAX_RESULTS ?? DEFAULT_BURST_OPTIONS.maxResults
    )
  });
  const persisted = await persistAttentionBursts(asOfDate, bursts);
  return {
    asOfDate,
    corpusDocuments: corpus.length,
    burstsDetected: bursts.length,
    novelBursts: bursts.filter((burst) => burst.novel).length,
    burstsWritten: persisted.written,
    topTerms: bursts.slice(0, 10).map((burst) => burst.term)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) {
    console.log("[detect-attention-bursts] DATABASE_URL is not set; nothing to scan.");
  } else {
    const result = await runRecordedJob(
      "attention_bursts",
      () => runAttentionBurstDetection(),
      (value) => value.burstsDetected
    );
    console.log(`[detect-attention-bursts] ${JSON.stringify(result)}`);
  }
}
