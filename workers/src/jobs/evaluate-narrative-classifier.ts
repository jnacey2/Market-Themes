import { pathToFileURL } from "node:url";
import {
  buildNarrativeClassificationEvalRequests,
  createAnthropicBatchApi,
  evalCaseForCustomId,
  logAnthropicUsage,
  narrativeClassificationEvalDefinitions,
  narrativeClassificationEvalPromptVersion,
  normalizeNarrativeClassificationMessage,
  scoreNarrativeClassificationEval
} from "@market-themes/analysis";

export async function evaluateNarrativeClassifier(
  argv = process.argv.slice(2)
) {
  const options = parseEvaluationArgs(argv);
  const requests = buildNarrativeClassificationEvalRequests(options.model);
  if (!options.batchId && !options.submit) {
    return {
      action: "dry_run",
      model: options.model,
      requestCount: requests.length,
      submitCommand:
        `npm run eval:narratives -- --submit --model ${options.model}`
    };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for the live classifier evaluation."
    );
  }
  const api = createAnthropicBatchApi();
  if (!options.batchId) {
    const batch = await api.create(requests);
    return {
      action: "submitted",
      model: options.model,
      batchId: batch.id,
      status: batch.processing_status,
      requestCount: batch.request_counts.processing,
      nextCommand:
        `npm run eval:narratives -- --batch-id ${batch.id} ` +
        `--model ${options.model}`
    };
  }

  const batch = await api.retrieve(options.batchId);
  if (batch.processing_status !== "ended") {
    return {
      action: "pending",
      model: options.model,
      batchId: batch.id,
      status: batch.processing_status,
      requestCounts: batch.request_counts
    };
  }

  const predictions: Array<{ caseId: string; matchedSlugs: string[] }> = [];
  const failures: Array<{
    customId: string;
    type: string;
    message: string;
  }> = [];
  const definitionSlugById = new Map(
    narrativeClassificationEvalDefinitions.map((definition) => [
      definition.id,
      definition.slug
    ])
  );
  for await (const result of await api.results(batch.id)) {
    const item = evalCaseForCustomId(result.custom_id);
    if (!item) {
      failures.push({
        customId: result.custom_id,
        type: "unknown_custom_id",
        message: "Result does not map to a human-labeled case."
      });
      continue;
    }
    if (result.result.type !== "succeeded") {
      const error =
        result.result.type === "errored"
          ? result.result.error.error
          : {
              type: result.result.type,
              message: `Request ${result.result.type}.`
            };
      failures.push({
        customId: result.custom_id,
        type: error.type,
        message: error.message
      });
      continue;
    }
    const observations = normalizeNarrativeClassificationMessage(
      result.result.message,
      item.document,
      narrativeClassificationEvalDefinitions,
      options.model,
      narrativeClassificationEvalPromptVersion
    );
    logAnthropicUsage(
      "narrative-classification-eval",
      options.model,
      result.result.message.usage
    );
    predictions.push({
      caseId: item.id,
      matchedSlugs: observations
        .filter((observation) => observation.matched)
        .map((observation) =>
          definitionSlugById.get(observation.narrativeDefinitionId)
        )
        .filter((slug): slug is string => Boolean(slug))
    });
  }
  return {
    action: "scored",
    model: options.model,
    batchId: batch.id,
    score: scoreNarrativeClassificationEval(predictions),
    completedCases: predictions.length,
    failedCases: failures
  };
}

export function parseEvaluationArgs(argv: string[]) {
  let model = "claude-haiku-4-5-20251001";
  let batchId: string | null = null;
  let submit = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--model" && argv[index + 1]) {
      model = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--batch-id" && argv[index + 1]) {
      batchId = argv[index + 1];
      index += 1;
    } else if (argv[index] === "--submit") {
      submit = true;
    } else {
      throw new Error(`Unknown or incomplete evaluation argument: ${argv[index]}`);
    }
  }
  return { model, batchId, submit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  evaluateNarrativeClassifier()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
