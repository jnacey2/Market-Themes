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
    /startCommand: npm run narratives:classify:batch --workspace @market-themes\/workers/
  );
  assert.match(classification, /key: ANTHROPIC_API_KEY/);
  assert.match(
    classification,
    /key: ANTHROPIC_MODEL\s+value: claude-haiku-4-5-20251001/
  );
  assert.match(
    classification,
    /key: ANTHROPIC_PROMPT_CACHING\s+value: "true"/
  );
  assert.match(
    classification,
    /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION\s+value: narrative_classification_v7/
  );
  assert.match(
    classification,
    /key: NARRATIVE_CLASSIFICATION_MAX_DOCUMENTS\s+value: "40"/
  );

  const discovery = serviceBlock("discover-narratives");
  assert.match(discovery, /schedule: "10 \* \* \* \*"/);
  assert.match(
    discovery,
    /startCommand: npm run narratives:discover:batch --workspace @market-themes\/workers/
  );
  assert.match(discovery, /key: ANTHROPIC_API_KEY/);
  assert.match(discovery, /key: NARRATIVE_DISCOVERY_PROMPT_VERSION/);
});

test("extracts a bounded recent-document batch every hour", () => {
  const extraction = serviceBlock("extract-recent-signals");
  assert.match(extraction, /schedule: "35 \* \* \* \*"/);
  assert.match(
    extraction,
    /startCommand: npm run claude:extract:batch --workspace @market-themes\/workers/
  );
  assert.match(extraction, /key: ANTHROPIC_API_KEY/);
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_LOOKBACK_DAYS\s+value: "30"/
  );
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_BATCH_SIZE\s+value: "10"/
  );
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_MAX_BATCHES\s+value: "10"/
  );
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_MAX_DOCUMENTS\s+value: "100"/
  );
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_CONCURRENCY\s+value: "2"/
  );
  assert.match(
    extraction,
    /key: CLAUDE_EXTRACTION_MAX_RUNTIME_MS\s+value: "3000000"/
  );
});

test("publishes narrative trends twice hourly without waiting on model work", () => {
  const trends = serviceBlock("recompute-narrative-trends");
  assert.match(trends, /schedule: "25,55 \* \* \* \*"/);
  assert.match(
    trends,
    /startCommand: npm run narrative-trends:recompute --workspace @market-themes\/workers/
  );
  assert.doesNotMatch(trends, /ANTHROPIC_API_KEY/);
  assert.match(
    trends,
    /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION\s+value: narrative_classification_v7/
  );
  assert.match(
    trends,
    /key: NARRATIVE_ACTIVATION_MIN_STORIES\s+value: "3"/
  );
});

test("reconciles durable Anthropic batches every ten minutes", () => {
  const poller = serviceBlock("poll-anthropic-batches");
  assert.match(poller, /schedule: "2,12,22,32,42,52 \* \* \* \*"/);
  assert.match(
    poller,
    /startCommand: npm run anthropic:batches:poll --workspace @market-themes\/workers/
  );
  assert.match(poller, /key: DATABASE_URL/);
  assert.match(poller, /key: ANTHROPIC_API_KEY/);
  assert.doesNotMatch(poller, /ANTHROPIC_MODEL/);
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
  assert.match(
    review,
    /key: NARRATIVE_AUTO_PROMOTE_CANDIDATES\s+value: "true"/
  );
  assert.match(review, /key: NARRATIVE_DISCOVERY_PROMPT_VERSION/);
  assert.match(
    review,
    /key: NARRATIVE_AUTO_PROMOTE_MIN_DOCUMENTS\s+value: "3"/
  );
  assert.match(
    review,
    /key: NARRATIVE_AUTO_PROMOTE_MIN_PUBLISHER_OWNERS\s+value: "3"/
  );
  assert.match(
    review,
    /key: NARRATIVE_ACTIVATION_MIN_STORIES\s+value: "3"/
  );
  assert.match(
    review,
    /key: NARRATIVE_ACTIVATION_MIN_PUBLISHER_OWNERS\s+value: "3"/
  );
  assert.match(review, /key: ANTHROPIC_API_KEY/);
  assert.match(
    review,
    /key: ANTHROPIC_MODEL\s+value: claude-haiku-4-5-20251001/
  );
  assert.match(
    review,
    /key: NARRATIVE_PROMOTION_VALIDATION_MODEL\s+value: claude-haiku-4-5-20251001/
  );
  assert.match(
    review,
    /key: NARRATIVE_PROMOTION_VALIDATION_PROMPT_VERSION\s+value: candidate_promotion_validation_v2/
  );
});

test("uses Haiku for every configured Anthropic workload", () => {
  const configuredModels = [
    ...renderYaml.matchAll(/key: ANTHROPIC_MODEL\s+value: (\S+)/g)
  ].map((match) => match[1]);

  assert.ok(configuredModels.length > 0);
  assert.deepEqual(
    new Set(configuredModels),
    new Set(["claude-haiku-4-5-20251001"])
  );
});

test("uses Haiku for web-triggered promotion validation", () => {
  const web = serviceBlock("themes-web", "web");
  assert.match(
    web,
    /key: NARRATIVE_PROMOTION_VALIDATION_MODEL\s+value: claude-haiku-4-5-20251001/
  );
  assert.match(web, /key: NARRATIVE_EVENT_TTL_DAYS\s+value: "14"/);
});

test("the theme cron runs normalization and trends without stage selectors", () => {
  const themes = serviceBlock("recompute-theme-trends");
  assert.match(
    themes,
    /startCommand: npm run themes:normalize:backfill --workspace @market-themes\/workers && npm run trends:recompute --workspace @market-themes\/workers/
  );
  assert.doesNotMatch(themes, /startCommand: npm run pipeline/);
  assert.doesNotMatch(themes, /PIPELINE_START_AT/);
  assert.doesNotMatch(themes, /PIPELINE_SKIP_/);
  assert.doesNotMatch(themes, /key: NARRATIVE_DISCOVERY_PROMPT_VERSION/);
  assert.doesNotMatch(themes, /key: NARRATIVE_CLASSIFICATION_PROMPT_VERSION/);
});

function serviceBlock(name: string, type = "cron") {
  const marker = `  - type: ${type}\n    name: ${name}\n`;
  const start = renderYaml.indexOf(marker);
  assert.notEqual(start, -1, `Missing Render cron service ${name}`);
  const next = renderYaml.indexOf("\n  - type:", start + marker.length);
  return renderYaml.slice(start, next === -1 ? undefined : next);
}
