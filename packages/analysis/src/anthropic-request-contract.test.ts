import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const requestModules = [
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
