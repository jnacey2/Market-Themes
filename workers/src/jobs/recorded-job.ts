import {
  finishPipelineRun,
  startPipelineRun
} from "@market-themes/db";

export async function runRecordedJob<T extends Record<string, unknown>>(
  stage: string,
  runner: () => Promise<T>,
  processedCount: (result: T) => number,
  failedCount: (result: T) => number = () => 0
) {
  const runId = await startPipelineRun(stage, {
    trigger: process.env.PIPELINE_TRIGGER ?? "scheduled",
    executionMode: "standalone_cron"
  });
  try {
    const result = await runner();
    await finishPipelineRun(runId, {
      status: "completed",
      processedCount: processedCount(result),
      failedCount: failedCount(result),
      metadata: serializableRecord(result)
    });
    return result;
  } catch (error) {
    await finishPipelineRun(runId, {
      status: "failed",
      failedCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function serializableRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
