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

test("fails closed on malformed, missing, duplicate, or contradictory classifications", async () => {
  const { validateNarrativeResponse } =
    await import("./narrative-classification");
  const valid = {
    narrativeDefinitionId: definition.id,
    matched: false,
    matchScore: 20,
    stance: "neutral",
    riskTone: 0,
    bullishTone: 0,
    evidenceSnippet: "",
    interpretation: "No support",
    affectedEntities: []
  };
  for (const response of [
    {},
    { observations: [] },
    { observations: [valid, valid] },
    { observations: [{ ...valid, matched: "false" }] },
    { observations: [{ ...valid, matched: true }] },
    { observations: [{ ...valid, narrativeDefinitionId: "unknown" }] }
  ]) {
    assert.throws(() => validateNarrativeResponse(response, [definition]));
  }
  assert.equal(
    validateNarrativeResponse({ observations: [valid] }, [definition]).length,
    1
  );
});
test("classifies evidence beyond the first section and rejects truncated responses", async () => {
  const { classifyDocumentNarratives } =
    await import("./narrative-classification");
  const quote = "Demand is rising quickly";
  const longDocument = { ...document, text: "Background. ".repeat(40) + quote };
  let requests = 0;
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    requests++;
    const request = JSON.parse(String(init.body));
    const sourceText = JSON.parse(request.messages[0].content).document
      .text as string;
    const matched = sourceText.includes(quote);
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "test",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
      content: [
        {
          type: "text",
          text: JSON.stringify({
            observations: [
              {
                narrativeDefinitionId: definition.id,
                matched,
                matchScore: matched ? 95 : 10,
                stance: matched ? "bullish" : "neutral",
                riskTone: 0,
                bullishTone: matched ? 80 : 0,
                evidenceSnippet: matched ? quote : "",
                interpretation: "Source classification",
                affectedEntities: []
              }
            ]
          })
        }
      ]
    });
  }) as typeof fetch;
  const result = await classifyDocumentNarratives(longDocument, [definition], {
    apiKey: "fixture",
    fetchImpl,
    maxDocumentChars: 150
  });
  assert(requests > 1);
  assert.equal(result[0].matched, true);
  assert.equal(
    result[0].metadata?.examinedCharacters,
    longDocument.text.length
  );
  await assert.rejects(
    classifyDocumentNarratives(document, [definition], {
      apiKey: "fixture",
      fetchImpl: (async () =>
        Response.json({
          content: [],
          stop_reason: "max_tokens",
          usage: { input_tokens: 1, output_tokens: 1 }
        })) as typeof fetch
    }),
    /Incomplete classification/
  );
});
