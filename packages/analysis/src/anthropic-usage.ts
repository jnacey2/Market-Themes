export type AnthropicTokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function summarizeAnthropicUsage(
  operation: string,
  model: string,
  usage: AnthropicTokenUsage
) {
  const inputTokens = usage.input_tokens;
  const cacheCreationInputTokens =
    usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;

  return {
    operation,
    model,
    inputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalInputTokens:
      inputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    outputTokens: usage.output_tokens
  };
}

export function logAnthropicUsage(
  operation: string,
  model: string,
  usage: AnthropicTokenUsage
) {
  const summary = summarizeAnthropicUsage(operation, model, usage);
  console.info(`[anthropic-usage] ${JSON.stringify(summary)}`);
  return summary;
}

export function aggregateAnthropicUsage(
  summaries: Array<ReturnType<typeof summarizeAnthropicUsage>>
) {
  return summaries.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cacheCreationInputTokens:
        total.cacheCreationInputTokens +
        usage.cacheCreationInputTokens,
      cacheReadInputTokens:
        total.cacheReadInputTokens + usage.cacheReadInputTokens,
      totalInputTokens: total.totalInputTokens + usage.totalInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens
    }),
    {
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalInputTokens: 0,
      outputTokens: 0
    }
  );
}
