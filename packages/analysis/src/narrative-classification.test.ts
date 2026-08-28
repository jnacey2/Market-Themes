import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisDocument, NarrativeDefinition } from "@market-themes/db";
import {
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
      "supply-chain-normalization",
      "Lead times shortened as component availability improved."
    ),
    true
  );
});
