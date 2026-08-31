import assert from "node:assert/strict";
import test from "node:test";
import {
  narrativeClassificationOutputFormat,
  narrativeDiscoveryOutputFormat,
  requireStructuredOutput,
  signalExtractionOutputFormat,
  themeNormalizationOutputFormat
} from "./structured-output";

const formats = [
  ["signal extraction", signalExtractionOutputFormat, "signals"],
  ["narrative classification", narrativeClassificationOutputFormat, "observations"],
  ["narrative discovery", narrativeDiscoveryOutputFormat, "candidates"],
  ["theme normalization", themeNormalizationOutputFormat, "mappings"]
] as const;

test("all analysis outputs use strict top-level JSON schemas", () => {
  for (const [name, format, requiredProperty] of formats) {
    const schema = format.schema as {
      type?: unknown;
      additionalProperties?: unknown;
      required?: unknown;
      properties?: Record<string, unknown>;
    };
    assert.equal(format.type, "json_schema", name);
    assert.equal(schema.type, "object", name);
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual(schema.required, [requiredProperty], name);
    assert.equal(
      typeof schema.properties?.[requiredProperty],
      "object",
      name
    );
  }
});

test("structured output rejects refusals, truncation, and absent payloads", () => {
  assert.deepEqual(
    requireStructuredOutput(
      { parsed_output: { signals: [] }, stop_reason: "end_turn" },
      "test extraction"
    ),
    { signals: [] }
  );
  assert.throws(
    () =>
      requireStructuredOutput(
        { parsed_output: { signals: [] }, stop_reason: "max_tokens" },
        "test extraction"
      ),
    /max_tokens/
  );
  assert.throws(
    () =>
      requireStructuredOutput(
        { parsed_output: null, stop_reason: "end_turn" },
        "test extraction"
      ),
    /no structured output/
  );
});
