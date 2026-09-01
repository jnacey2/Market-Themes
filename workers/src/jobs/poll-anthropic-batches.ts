import { pathToFileURL } from "node:url";
import { createAnthropicBatchApi } from "@market-themes/analysis";
import { pollNarrativeClassificationBatch } from "./classify-narratives-batch";
import { pollSignalExtractionBatch } from "./claude-extract-batch";
import { pollNarrativeDiscoveryBatch } from "./discover-narratives-batch";
import { runRecordedJob } from "./recorded-job";

type BatchPoller = {
  name: string;
  poll: () => Promise<{ status: string }>;
};

export async function pollAnthropicBatches(options: {
  pollers?: BatchPoller[];
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY && !options.pollers) {
    throw new Error(
      "ANTHROPIC_API_KEY is required to reconcile Anthropic batches."
    );
  }
  const workloads =
    options.pollers ??
    defaultPollers();
  const results: Record<string, unknown> = {};
  let batchesCompleted = 0;
  let failedWorkloads = 0;

  for (const workload of workloads) {
    try {
      const result = await workload.poll();
      results[workload.name] = result;
      if (result.status === "completed") batchesCompleted += 1;
      if (result.status === "failed") failedWorkloads += 1;
    } catch (error) {
      failedWorkloads += 1;
      results[workload.name] = {
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      };
      console.error(
        `[anthropic-batch-poll] workload=${workload.name} error=${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { batchesCompleted, failedWorkloads, workloads: results };
}

function defaultPollers(): BatchPoller[] {
  const api = createAnthropicBatchApi();
  return [
    {
      name: "narrative_classification",
      poll: () => pollNarrativeClassificationBatch(api)
    },
    {
      name: "narrative_discovery",
      poll: () => pollNarrativeDiscoveryBatch(api)
    },
    {
      name: "signal_extraction",
      poll: () => pollSignalExtractionBatch(api)
    }
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRecordedJob(
    "anthropic_batch_poll",
    () => pollAnthropicBatches(),
    (value) => value.batchesCompleted,
    (value) => value.failedWorkloads
  );
  console.log(`[anthropic-batch-poll] ${JSON.stringify(result)}`);
}
