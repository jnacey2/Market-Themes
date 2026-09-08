import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisDocument, NarrativeDefinition } from "@market-themes/db";
import {
  normalizeNarrativeDiscoveryResponse,
  slugifyCandidateKey
} from "./narrative-discovery";

const document: AnalysisDocument = {
  id: "document:discovery-test",
  sourceId: "test-news",
  sourceClass: "newspaper",
  title: "Enterprise software budgets shift",
  publisher: "Test Publisher",
  url: "https://example.com/discovery",
  publishedAt: "2026-08-29T00:00:00.000Z",
  tickers: ["TEST"],
  summary: "",
  text: "Customers are consolidating software vendors to reduce overlapping subscription costs.",
  textHash: "text-hash"
};

const tracked: NarrativeDefinition[] = [
  {
    id: "narrative:def:pricing-power:v1",
    slug: "pricing-power",
    version: 1,
    name: "Pricing Power",
    proposition: "Companies can raise prices without losing demand.",
    category: "Cross-sector",
    inclusionGuidance: "",
    exclusionGuidance: "",
    positiveExamples: [],
    negativeExamples: [],
    status: "active"
  }
];

const rawCandidate = {
  clusterKey: "software-vendor-consolidation",
  name: "Software Vendor Consolidation",
  proposition:
    "Enterprises are reducing software costs by consolidating overlapping vendors.",
  category: "Technology",
  inclusionGuidance: "Include vendor reductions explicitly tied to cost savings.",
  exclusionGuidance: "Exclude ordinary renewals and unrelated layoffs.",
  stance: "risk",
  riskTone: 70,
  bullishTone: 10,
  matchScore: 91,
  affectedEntities: ["Enterprise software"],
  evidenceSnippet:
    "Customers are consolidating software vendors to reduce overlapping subscription costs.",
  interpretation: "Vendor consolidation threatens redundant software spend."
};

test("normalizes an evidence-backed candidate with deterministic ids", () => {
  const first = normalizeNarrativeDiscoveryResponse(
    { candidates: [rawCandidate] },
    document,
    tracked,
    [],
    { model: "test-model", promptVersion: "discovery-v1" }
  );
  const second = normalizeNarrativeDiscoveryResponse(
    { candidates: [rawCandidate] },
    document,
    tracked,
    [],
    { model: "test-model", promptVersion: "discovery-v1" }
  );

  assert.equal(first.length, 1);
  assert.equal(first[0].clusterKey, "software-vendor-consolidation");
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].evidence[0].documentId, document.id);
});

test("reuses an existing cluster and rejects tracked or invented evidence", () => {
  const reused = normalizeNarrativeDiscoveryResponse(
    { candidates: [rawCandidate] },
    document,
    tracked,
    [
      {
        clusterKey: "software-vendor-consolidation",
        name: "Software Stack Consolidation",
        proposition: "Enterprises are consolidating software vendors."
      }
    ],
    { model: "test-model", promptVersion: "discovery-v1" }
  );
  const rejected = normalizeNarrativeDiscoveryResponse(
    {
      candidates: [
        { ...rawCandidate, clusterKey: "pricing-power", name: "Pricing Power" },
        { ...rawCandidate, evidenceSnippet: "This quotation was invented." },
        { ...rawCandidate, matchScore: 74 }
      ]
    },
    document,
    tracked,
    [],
    { model: "test-model", promptVersion: "discovery-v1" }
  );

  assert.equal(reused[0].clusterKey, "software-vendor-consolidation");
  assert.deepEqual(rejected, []);
});

test("candidate keys are stable, short kebab-case identifiers", () => {
  assert.equal(
    slugifyCandidateKey("  Software & Vendor Consolidation! "),
    "software-and-vendor-consolidation"
  );
});

test("unknown discovery categories fail closed to Other", () => {
  const [candidate] = normalizeNarrativeDiscoveryResponse(
    { candidates: [{ ...rawCandidate, category: "Invented Sector" }] },
    document,
    tracked,
    [],
    { model: "test-model", promptVersion: "discovery-v1" }
  );
  assert.equal(candidate.category, "Other");
});
