import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAnthropicUsage } from "./anthropic-usage";

test("summarizes uncached, cache-write, and cache-read input tokens", () => {
  assert.deepEqual(
    summarizeAnthropicUsage("classification", "test-model", {
      input_tokens: 1_200,
      cache_creation_input_tokens: 4_500,
      cache_read_input_tokens: 3_000,
      output_tokens: 450
    }),
    {
      operation: "classification",
      model: "test-model",
      inputTokens: 1_200,
      cacheCreationInputTokens: 4_500,
      cacheReadInputTokens: 3_000,
      totalInputTokens: 8_700,
      outputTokens: 450
    }
  );
});

test("treats absent cache counters as zero", () => {
  const usage = summarizeAnthropicUsage("extraction", "test-model", {
    input_tokens: 800,
    output_tokens: 200
  });

  assert.equal(usage.cacheCreationInputTokens, 0);
  assert.equal(usage.cacheReadInputTokens, 0);
  assert.equal(usage.totalInputTokens, 800);
});
