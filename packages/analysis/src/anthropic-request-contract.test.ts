import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const requestModules = [
  "candidate-promotion-validation.ts",
  "extraction.ts",
  "theme-normalization.ts",
  "narrative-classification.ts",
  "narrative-discovery.ts"
];

test("Anthropic request bodies omit deprecated temperature sampling", () => {
  for (const moduleName of requestModules) {
    const source = readFileSync(
      fileURLToPath(new URL(moduleName, import.meta.url)),
      "utf8"
    );
    assert.doesNotMatch(
      source,
      /\btemperature\s*:/,
      `${moduleName} must not send the deprecated temperature field`
    );
  }
});

test("every Anthropic analysis request sends a structured output schema", () => {
  for (const moduleName of requestModules) {
    const source = readFileSync(
      fileURLToPath(new URL(moduleName, import.meta.url)),
      "utf8"
    );
    assert.match(source, /messages\.create\(/, moduleName);
    assert.match(source, /output_config:\s*\{\s*format:/, moduleName);
  }
});
