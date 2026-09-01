import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnalysisDocument,
  NarrativeCandidateContext,
  NarrativeDefinition
} from "@market-themes/db";
import {
  buildNarrativeClassificationRequest,
  buildNarrativeDiscoveryRequest,
  buildSignalExtractionRequest,
  prepareSignalExtractionSections
} from "./index";

const document: AnalysisDocument = {
  id: "document:batch-request",
  sourceId: "test",
  sourceClass: "newspaper",
  title: "Batch request",
  publisher: "Publisher",
  url: "https://example.com/batch",
  publishedAt: "2026-09-01T00:00:00.000Z",
  tickers: [],
  summary: "",
  metadata: {},
  text: "Evidence text",
  textHash: "hash"
};

const definition: NarrativeDefinition = {
  id: "narrative:def:test:v1",
  slug: "test",
  version: 1,
  name: "Test",
  proposition: "Evidence is changing.",
  category: "Other",
  inclusionGuidance: "Include direct evidence.",
  exclusionGuidance: "Exclude generic mentions.",
  positiveExamples: [],
  negativeExamples: [],
  status: "active"
};

test("builds a batch-compatible classification request with a one-hour cache", () => {
  const request = buildNarrativeClassificationRequest(
    document,
    [definition],
    {
      model: "test-model",
      cacheTtl: "1h"
    }
  );
  const content = request.messages[0].content;

  assert.equal(request.model, "test-model");
  assert.ok(request.output_config?.format);
  assert.ok(Array.isArray(content));
  assert.deepEqual(
    Array.isArray(content) && "cache_control" in content[0]
      ? content[0].cache_control
      : undefined,
    { type: "ephemeral", ttl: "1h" }
  );
});

test("builds extraction requests for every deterministic section", () => {
  const longDocument = { ...document, text: "abcdefghij" };
  const sections = prepareSignalExtractionSections(longDocument, {
    maxDocumentChars: 5,
    sectionChars: 6,
    sectionOverlap: 2
  });
  const requests = sections.map((section) =>
    buildSignalExtractionRequest(longDocument, section, {
      model: "test-model"
    })
  );

  assert.deepEqual(
    sections.map((section) => section.text),
    ["abcdef", "efghij"]
  );
  assert.ok(requests.every((request) => request.output_config?.format));
});

test("builds a batch-compatible discovery request with its context", () => {
  const existing: NarrativeCandidateContext[] = [
    {
      clusterKey: "existing",
      name: "Existing",
      proposition: "An existing proposition."
    }
  ];
  const request = buildNarrativeDiscoveryRequest(
    document,
    [definition],
    existing,
    { model: "test-model" }
  );
  const content = request.messages[0].content;

  assert.equal(typeof content, "string");
  assert.match(String(content), /"trackedNarratives"/);
  assert.match(String(content), /"existingCandidates"/);
  assert.ok(request.output_config?.format);
});
