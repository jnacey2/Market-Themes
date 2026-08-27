import { pathToFileURL } from "node:url";
import {
  finishPipelineRun,
  recomputeNarrativeTrends,
  recomputeThemeTrends,
  startPipelineRun
} from "@market-themes/db";
import { pollSources } from "./poll-sources";
import { runClaudeExtractionBackfill } from "./claude-extract-backfill";
import { normalizeThemeBatches } from "./normalize-theme-batches";
import { classifyNarrativeBatches } from "./classify-narratives";

export async function runPipeline() {
  const runId = await startPipelineRun("full_pipeline", {
    trigger: process.env.PIPELINE_TRIGGER ?? "scheduled"
  });

  try {
    const ingestion =
      process.env.PIPELINE_SKIP_INGEST === "true"
        ? { fetched: 0, inserted: 0, failed: 0 }
        : await pollSources();
    const extraction = await runClaudeExtractionBackfill();
    const normalization = await normalizeThemeBatches();
    const narrativeClassification = await classifyNarrativeBatches();
    const trends = await recomputeThemeTrends({
      lookbackDays: Number(process.env.TREND_LOOKBACK_DAYS ?? 365),
      lowHistoryDays: Number(process.env.TREND_LOW_HISTORY_DAYS ?? 30),
      storageDays: Number(process.env.TREND_STORAGE_DAYS ?? 365),
      windows: ["7d", "30d"]
    });
    const narrativeTrends = await recomputeNarrativeTrends({
      lookbackDays: Number(process.env.NARRATIVE_TREND_LOOKBACK_DAYS ?? 365),
      lowHistoryDays: Number(process.env.NARRATIVE_TREND_LOW_HISTORY_DAYS ?? 30),
      windows: ["7d", "30d"]
    });

    const failedCount =
      ingestion.failed + extraction.failedDocuments + narrativeClassification.failedDocuments;

    if (failedCount > 0) {
      throw new Error(`Pipeline completed with ${failedCount} failed operations.`);
    }

    await finishPipelineRun(runId, {
      status: "completed",
      processedCount:
        ingestion.inserted +
        extraction.completedDocuments +
        normalization.signalsUpdated +
        narrativeClassification.documentsProcessed,
      metadata: {
        ingestion,
        extraction,
        normalization,
        narrativeClassification,
        trends,
        narrativeTrends
      }
    });

    return {
      ingestion,
      extraction,
      normalization,
      narrativeClassification,
      trends,
      narrativeTrends
    };
  } catch (error) {
    await finishPipelineRun(runId, {
      status: "failed",
      failedCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPipeline();
}
