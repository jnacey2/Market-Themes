import assert from "node:assert/strict";
import test from "node:test";
import {
  candidatePromotionValidationOutputFormat,
  narrativeClassificationOutputFormat,
  narrativeDiscoveryOutputFormat,
  parseStructuredOutput,
  signalExtractionOutputFormat,
  themeNormalizationOutputFormat
} from "./structured-output";

const formats = [
  ["signal extraction", signalExtractionOutputFormat, "signals"],
  ["narrative classification", narrativeClassificationOutputFormat, "observations"],
  ["narrative discovery", narrativeDiscoveryOutputFormat, "candidates"],
  [
    "candidate promotion validation",
    candidatePromotionValidationOutputFormat,
    "evidence"
  ],
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
    assert.equal(
      Array.isArray(schema.required) &&
        schema.required.includes(requiredProperty),
      true,
      name
    );
    assert.equal(
      typeof schema.properties?.[requiredProperty],
      "object",
      name
    );
    const collection = schema.properties?.[requiredProperty] as
      | { items?: { additionalProperties?: unknown; required?: unknown } }
      | undefined;
    assert.equal(collection?.items?.additionalProperties, false, name);
    assert.ok(
      Array.isArray(collection?.items?.required) &&
        collection.items.required.length > 0,
      name
    );
  }
});

test("structured output rejects refusals, truncation, and absent payloads", () => {
  assert.deepEqual(
    parseStructuredOutput(
      {
        content: [{ type: "text", text: '{"signals":[]}' }],
        stop_reason: "end_turn"
      },
      "test extraction"
    ),
    { signals: [] }
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          content: [{ type: "text", text: '{"signals":[' }],
          stop_reason: "max_tokens"
        },
        "test extraction"
      ),
    /max_tokens/
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        { content: [], stop_reason: "end_turn" },
        "test extraction"
      ),
    /no structured output/
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          content: [{ type: "text", text: "I cannot comply." }],
          stop_reason: "refusal"
        },
        "test extraction"
      ),
    /refusal/
  );
  assert.throws(
    () =>
      parseStructuredOutput(
        {
          content: [{ type: "text", text: '{"signals":[}' }],
          stop_reason: "end_turn"
        },
        "test extraction"
      ),
    /invalid structured output/
  );
});
