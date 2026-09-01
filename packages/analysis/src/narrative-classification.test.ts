import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisDocument, NarrativeDefinition } from "@market-themes/db";
import {
  buildNarrativeClassificationContent,
  normalizeObservation,
  passesDefinitionGuard
} from "./narrative-classification";

const definition: NarrativeDefinition = {
  id: "narrative:def:test:v1",
  slug: "test",
  version: 1,
  name: "Test narrative",
  proposition: "A test proposition.",
  category: "Test",
  inclusionGuidance: "",
  exclusionGuidance: "",
  positiveExamples: [],
  negativeExamples: [],
  status: "active"
};

const document: AnalysisDocument = {
  id: "document:test",
  sourceId: "test",
  sourceClass: "newspaper",
  title: "Test",
  publisher: "Publisher",
  url: "https://example.com",
  publishedAt: "2026-01-01T00:00:00.000Z",
  tickers: [],
  summary: "",
  text: "Demand is rising quickly because capacity remains constrained.",
  textHash: "hash"
};

test("requires matched evidence to be an exact source quote", () => {
  const valid = normalizeObservation(
    {
      matched: true,
      matchScore: 92,
      stance: "bullish",
      riskTone: 10,
      bullishTone: 80,
      evidenceSnippet: "Demand is rising quickly",
      interpretation: "Demand is accelerating.",
      affectedEntities: ["Example"]
    },
    definition,
    document,
    "model",
    "prompt"
  );
  const invented = normalizeObservation(
    {
      matched: true,
      matchScore: 95,
      evidenceSnippet: "Invented quotation"
    },
    definition,
    document,
    "model",
    "prompt"
  );

  assert.equal(valid.matched, true);
  assert.equal(invented.matched, false);
  assert.equal(invented.matchScore, 69);
  assert.equal(invented.evidenceSnippet, "");
});

test("rejects low-confidence semantic adjacency despite an exact quote", () => {
  const adjacent = normalizeObservation(
    {
      matched: true,
      matchScore: 62,
      stance: "bullish",
      evidenceSnippet: "Demand is rising quickly"
    },
    definition,
    document,
    "model",
    "prompt"
  );

  assert.equal(adjacent.matched, false);
  assert.equal(adjacent.matchScore, 62);
  assert.equal(adjacent.evidenceSnippet, "");
});

test("records omitted sparse-output definitions as non-matches", () => {
  const omitted = normalizeObservation(
    undefined,
    definition,
    document,
    "model",
    "prompt"
  );

  assert.equal(omitted.matched, false);
  assert.equal(omitted.matchScore, 0);
  assert.equal(omitted.evidenceSnippet, "");
});

test("caches only the stable definition prefix", () => {
  const changedDocument = {
    ...document,
    id: "document:changed",
    text: "A completely different source document."
  };
  const first = buildNarrativeClassificationContent(
    document,
    [definition],
    document.text,
    true
  );
  const second = buildNarrativeClassificationContent(
    changedDocument,
    [definition],
    changedDocument.text,
    true
  );
  const uncached = buildNarrativeClassificationContent(
    document,
    [definition],
    document.text,
    false
  );
  const hourlyCache = buildNarrativeClassificationContent(
    document,
    [definition],
    document.text,
    true,
    "1h"
  );

  assert.deepEqual(first[0], second[0]);
  assert.notDeepEqual(first[1], second[1]);
  assert.deepEqual(
    "cache_control" in first[0] ? first[0].cache_control : undefined,
    { type: "ephemeral" }
  );
  assert.equal("cache_control" in uncached[0], false);
  assert.deepEqual(
    "cache_control" in hourlyCache[0]
      ? hourlyCache[0].cache_control
      : undefined,
    { type: "ephemeral", ttl: "1h" }
  );
});

test("applies strict proposition-specific evidence guards", () => {
  assert.equal(
    passesDefinitionGuard(
      "pricing-power",
      "Average ticket increased 2.3%, offset by a decrease in customer transactions."
    ),
    false
  );
  assert.equal(
    passesDefinitionGuard(
      "deal-activity-recovery",
      "The company completed its acquisition of Example Corp."
    ),
    false
  );
  assert.equal(
    passesDefinitionGuard(
      "ai-infrastructure-demand",
      "AI data center demand increased and accelerator capacity remains constrained."
    ),
    true
  );
  assert.equal(
    passesDefinitionGuard(
      "ai-infrastructure-demand",
      "Data center revenue increased 90% after a hyperscaler contract."
    ),
    false
  );
  assert.equal(
    passesDefinitionGuard(
      "ai-infrastructure-demand",
      "Circular financing is a sign that the AI and compute industry is maturing."
    ),
    false
  );
  assert.equal(
    passesDefinitionGuard(
      "ai-infrastructure-demand",
      "AI accelerator revenue increased 90% as customer orders reached a record."
    ),
    true
  );
  assert.equal(
    passesDefinitionGuard(
      "energy-demand-growth",
      "Hot summer temperatures drove very high natural gas demand this week."
    ),
    false
  );
  assert.equal(
    passesDefinitionGuard(
      "energy-demand-growth",
      "Industrial electrification increased regional electricity load to a new record."
    ),
    true
  );
  assert.equal(
    passesDefinitionGuard(
      "supply-chain-normalization",
      "Lead times shortened as component availability improved."
    ),
    true
  );
});
