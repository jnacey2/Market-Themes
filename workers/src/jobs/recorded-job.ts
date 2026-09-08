import {
  finishPipelineRun,
  updatePipelineRunProgress,
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
  const heartbeat = setInterval(() => {
    void updatePipelineRunProgress(runId, {}).catch((error) =>
      console.error("Pipeline heartbeat failed", error)
    );
  }, 30_000);
  try {
    const result = await runner();
    await finishPipelineRun(runId, {
      status:
        failedCount(result) > 0
          ? processedCount(result) > 0
            ? "partial"
            : "failed"
          : "completed",
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
  } finally {
    clearInterval(heartbeat);
  }
}

function serializableRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
