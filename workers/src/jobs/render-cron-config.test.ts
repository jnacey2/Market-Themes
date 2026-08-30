import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const renderYaml = readFileSync(
  fileURLToPath(new URL("../../../render.yaml", import.meta.url)),
  "utf8"
);

test("runs narrative classification and discovery as dedicated hourly crons", () => {
  const classification = serviceBlock("classify-narratives");
  assert.match(classification, /schedule: "5 \* \* \* \*"/);
  assert.match(
    classification,
    /startCommand: npm run narratives:classify --workspace @market-themes\/workers/
  );
  assert.match(classification, /key: ANTHROPIC_API_KEY/);
  assert.match(classification, /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION/);

  const discovery = serviceBlock("discover-narratives");
  assert.match(discovery, /schedule: "10 \* \* \* \*"/);
  assert.match(
    discovery,
    /startCommand: npm run narratives:discover --workspace @market-themes\/workers/
  );
  assert.match(discovery, /key: ANTHROPIC_API_KEY/);
  assert.match(discovery, /key: NARRATIVE_DISCOVERY_PROMPT_VERSION/);
});

test("publishes narrative trends twice hourly without waiting on model work", () => {
  const trends = serviceBlock("recompute-narrative-trends");
  assert.match(trends, /schedule: "25,55 \* \* \* \*"/);
  assert.match(
    trends,
    /startCommand: npm run narrative-trends:recompute --workspace @market-themes\/workers/
  );
  assert.doesNotMatch(trends, /ANTHROPIC_API_KEY/);
  assert.match(trends, /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION/);
});

test("auto-reviews only explicitly enabled corroborated matches", () => {
  const review = serviceBlock("auto-review-narratives");
  assert.match(review, /schedule: "15,45 \* \* \* \*"/);
  assert.match(
    review,
    /startCommand: npm run narratives:auto-review --workspace @market-themes\/workers/
  );
  assert.match(
    review,
    /key: NARRATIVE_AUTO_REVIEW_ENABLED\s+value: "true"/
  );
  assert.match(review, /key: NARRATIVE_AUTO_REVIEW_MIN_SCORE\s+value: "90"/);
  assert.match(
    review,
    /key: NARRATIVE_AUTO_REVIEW_MIN_PUBLISHER_OWNERS\s+value: "2"/
  );
  assert.match(
    review,
    /key: NARRATIVE_AUTO_REVIEW_EXCLUDED_PUBLISHER_OWNERS\s+value: youtube,youtube-com,youtube\.com,youtu\.be/
  );
  assert.doesNotMatch(review, /ANTHROPIC_API_KEY/);
});

test("the theme pipeline skips work owned by narrative crons", () => {
  const themes = serviceBlock("recompute-theme-trends");
  assert.match(themes, /key: PIPELINE_SKIP_CLASSIFICATION\s+value: "true"/);
  assert.match(themes, /key: PIPELINE_SKIP_DISCOVERY\s+value: "true"/);
  assert.match(themes, /key: PIPELINE_SKIP_NARRATIVE_TRENDS\s+value: "true"/);
  assert.doesNotMatch(themes, /key: NARRATIVE_DISCOVERY_PROMPT_VERSION/);
  assert.doesNotMatch(themes, /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION/);
});

function serviceBlock(name: string) {
  const marker = `  - type: cron\n    name: ${name}\n`;
  const start = renderYaml.indexOf(marker);
  assert.notEqual(start, -1, `Missing Render cron service ${name}`);
  const next = renderYaml.indexOf("\n  - type:", start + marker.length);
  return renderYaml.slice(start, next === -1 ? undefined : next);
}
