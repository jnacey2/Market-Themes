import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  closeDatabaseClient,
  createDatabaseClient,
  finishPipelineRun,
  startPipelineRun,
  updatePipelineRunProgress
} from "@market-themes/db";

export type PipelineStage = {
  name: string;
  script: string;
  enabled: () => boolean;
};

const stages: PipelineStage[] = [
  {
    name: "ingest",
    script: "poll:sources",
    enabled: () => process.env.PIPELINE_SKIP_INGEST !== "true"
  },
  {
    name: "extract",
    script: "claude:extract:backfill",
    enabled: () =>
      process.env.PIPELINE_SKIP_EXTRACTION !== "true" &&
      Number(process.env.CLAUDE_EXTRACTION_MAX_BATCHES ?? 1) > 0
  },
  {
    name: "normalize",
    script: "themes:normalize:backfill",
    enabled: () => process.env.PIPELINE_SKIP_NORMALIZATION !== "true"
  },
  {
    name: "classify",
    script: "narratives:classify",
    enabled: () =>
      process.env.PIPELINE_SKIP_CLASSIFICATION !== "true" &&
      process.env.NARRATIVE_CLASSIFICATION_ENABLED !== "false"
  },
  {
    name: "discover",
    script: "narratives:discover",
    enabled: () =>
      process.env.PIPELINE_SKIP_DISCOVERY !== "true" &&
      process.env.NARRATIVE_DISCOVERY_ENABLED !== "false"
  },
  {
    name: "theme_trends",
    script: "trends:recompute",
    enabled: () => process.env.PIPELINE_SKIP_THEME_TRENDS !== "true"
  },
  {
    name: "narrative_trends",
    script: "narrative-trends:recompute",
    enabled: () => process.env.PIPELINE_SKIP_NARRATIVE_TRENDS !== "true"
  }
];

export async function runPipeline() {
  const lockClient = createDatabaseClient();
  await lockClient.connect();
  const lock = await lockClient.query<{ acquired: boolean }>(
    `select pg_try_advisory_lock(hashtext('market_themes_full_pipeline')) as acquired`
  );
  if (!lock.rows[0]?.acquired) {
    console.log("[pipeline] another full pipeline run owns the advisory lock; skipping");
    await closeDatabaseClient(lockClient);
    return { completedStages: [], skipped: "already_running" as const };
  }

  let runId: string | null = null;
  let selectedStages: PipelineStage[] = [];
  const completedStages: string[] = [];

  try {
    runId = await startPipelineRun("full_pipeline", {
      trigger: process.env.PIPELINE_TRIGGER ?? "scheduled",
      executionMode: "isolated_processes"
    });
    selectedStages = selectStages(stages);
    for (const stage of selectedStages) {
      if (!stage.enabled()) {
        console.log(`[pipeline] stage=${stage.name} skipped`);
        continue;
      }

      console.log(`[pipeline] stage=${stage.name} starting script=${stage.script}`);
      await updatePipelineRunProgress(runId, {
        currentStage: stage.name,
        completedStages
      });
      await runStage(stage);
      completedStages.push(stage.name);
      console.log(`[pipeline] stage=${stage.name} completed`);
    }

    await finishPipelineRun(runId, {
      status: "completed",
      processedCount: completedStages.length,
      metadata: { currentStage: null, completedStages }
    });
    console.log(`[pipeline] completed stages=${completedStages.join(",")}`);
    return { completedStages };
  } catch (error) {
    if (runId) {
      await finishPipelineRun(runId, {
        status: "failed",
        failedCount: 1,
        errorMessage: error instanceof Error ? error.message : String(error),
        metadata: {
          failedStage: selectedStages[completedStages.length]?.name ?? "unknown",
          completedStages
        }
      });
    }
    throw error;
  } finally {
    await lockClient
      .query(
        `select pg_advisory_unlock(hashtext('market_themes_full_pipeline'))`
      )
      .catch(() => undefined);
    await closeDatabaseClient(lockClient);
  }
}

export function selectStages(availableStages: PipelineStage[]) {
  const enabled = availableStages.filter((stage) => stage.enabled());
  const startAt = process.env.PIPELINE_START_AT;
  if (!startAt) return enabled;

  const startIndex = enabled.findIndex((stage) => stage.name === startAt);
  if (startIndex < 0) {
    throw new Error(
      `PIPELINE_START_AT=${startAt} is invalid. Expected one of: ${enabled
        .map((stage) => stage.name)
        .join(", ")}`
    );
  }
  return enabled.slice(startIndex);
}

function runStage(stage: PipelineStage) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", stage.script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Pipeline stage ${stage.name} failed with ${
            signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`
          }.`
        )
      );
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runPipeline();
}
