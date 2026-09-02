import type {
  AnalysisDocument,
  NarrativeDefinition
} from "@market-themes/db";
import {
  buildNarrativeClassificationRequest,
  narrativeClassificationPromptVersion,
  SEEDED_EVIDENCE_GUARDS
} from "./narrative-classification";
import type { AnthropicBatchRequest } from "./anthropic-batches";

export type NarrativeClassificationEvalCase = {
  id: string;
  document: AnalysisDocument;
  expectedMatchedSlugs: string[];
};

export type NarrativeClassificationEvalPrediction = {
  caseId: string;
  matchedSlugs: string[];
};

export const narrativeClassificationEvalDefinitions: NarrativeDefinition[] = [
  {
    id: "narrative:def:pricing-power:eval",
    slug: "pricing-power",
    version: 1,
    name: "Pricing Power",
    proposition:
      "Companies can raise or maintain prices without a proportionate loss of demand.",
    category: "Cross-sector",
    inclusionGuidance:
      "Require realized pricing and direct evidence that demand, volume, or traffic remained resilient.",
    exclusionGuidance:
      "Exclude price increases accompanied by materially weaker volume or without demand evidence.",
    positiveExamples: ["Prices rose while unit demand remained stable."],
    negativeExamples: ["Prices rose and customer traffic declined."],
    status: "active",
    metadata: { evidenceContract: SEEDED_EVIDENCE_GUARDS["pricing-power"] }
  },
  {
    id: "narrative:def:ai-infrastructure-demand:eval",
    slug: "ai-infrastructure-demand",
    version: 1,
    name: "AI Infrastructure Demand",
    proposition:
      "AI workloads are increasing demand, orders, capacity, or revenue for compute infrastructure.",
    category: "Technology",
    inclusionGuidance:
      "Require explicit AI language and a concrete demand, order, backlog, capacity, or revenue fact.",
    exclusionGuidance:
      "Exclude generic data-center growth, industry maturity, or AI enthusiasm without concrete demand.",
    positiveExamples: ["AI accelerator orders doubled and backlog reached a record."],
    negativeExamples: ["The compute industry is maturing."],
    status: "active",
    metadata: { evidenceContract: SEEDED_EVIDENCE_GUARDS["ai-infrastructure-demand"] }
  },
  {
    id: "narrative:def:consumer-trade-down:eval",
    slug: "consumer-trade-down",
    version: 1,
    name: "Consumer Trade-Down",
    proposition:
      "Budget pressure is causing consumers to choose lower-priced products, channels, or quantities.",
    category: "Consumer",
    inclusionGuidance:
      "Require consumer budget pressure plus an explicit move toward value, smaller quantities, or lower prices.",
    exclusionGuidance:
      "Exclude ordinary promotions and premium weakness without evidence of budget-driven substitution.",
    positiveExamples: ["Budget-conscious shoppers moved to private-label products."],
    negativeExamples: ["A seasonal promotion increased store traffic."],
    status: "active",
    metadata: { evidenceContract: SEEDED_EVIDENCE_GUARDS["consumer-trade-down"] }
  },
  {
    id: "narrative:def:credit-quality-deterioration:eval",
    slug: "credit-quality-deterioration",
    version: 1,
    name: "Credit Quality Deterioration",
    proposition:
      "Borrower stress, delinquencies, defaults, charge-offs, or loss provisions are worsening.",
    category: "Financials",
    inclusionGuidance:
      "Require an explicit increase or deterioration in a realized credit-quality measure.",
    exclusionGuidance:
      "Exclude hypothetical risks and reserve growth caused only by balance-sheet growth.",
    positiveExamples: ["Delinquencies and net charge-offs increased from last quarter."],
    negativeExamples: ["Loan balances increased while loss rates were stable."],
    status: "active",
    metadata: { evidenceContract: SEEDED_EVIDENCE_GUARDS["credit-quality-deterioration"] }
  },
  {
    id: "narrative:def:energy-shock-inflation-rates:eval",
    slug: "energy-shock-inflation-rates",
    version: 1,
    name: "Energy Shock Reprices Inflation And Rates",
    proposition:
      "Rising energy prices are lifting inflation expectations and repricing the path of interest rates.",
    category: "Macro",
    inclusionGuidance:
      "Require higher oil or energy prices, inflation expectations, and explicit rate-hike or monetary-policy repricing in the quotation.",
    exclusionGuidance:
      "Exclude oil moves without both the inflation and rates transmission channels.",
    positiveExamples: [
      "Oil rose, reviving inflation fears and lifting the implied probability of a rate hike."
    ],
    negativeExamples: ["Oil rose after renewed fighting."],
    status: "active",
    metadata: {
      evidenceContract: {
        requiredTermGroups: [
          ["oil", "crude", "energy"],
          ["inflation"],
          ["rate hike", "hike bets", "interest rate", "monetary policy"]
        ]
      }
    }
  }
];

export const narrativeClassificationEvalCases: NarrativeClassificationEvalCase[] =
  [
    evalCase(
      "pricing-positive",
      "The company realized a 4% price increase while unit volumes and customer traffic remained stable.",
      ["pricing-power"]
    ),
    evalCase(
      "pricing-negative-volume",
      "Average prices increased 4%, but unit volumes fell 12% as customers reduced purchases.",
      []
    ),
    evalCase(
      "ai-demand-positive",
      "Customer orders for AI accelerators doubled, pushing backlog and required production capacity to records.",
      ["ai-infrastructure-demand"]
    ),
    evalCase(
      "ai-adjacency-negative",
      "The data-center and compute industries are maturing as companies experiment with artificial intelligence.",
      []
    ),
    evalCase(
      "trade-down-positive",
      "Household budget pressure led shoppers to switch to private-label products and smaller package sizes.",
      ["consumer-trade-down"]
    ),
    evalCase(
      "promotion-negative",
      "A seasonal promotion increased traffic for the premium product range.",
      []
    ),
    evalCase(
      "credit-positive",
      "Consumer delinquencies and net charge-offs increased from the prior quarter as borrower stress worsened.",
      ["credit-quality-deterioration"]
    ),
    evalCase(
      "credit-hypothetical-negative",
      "Management said a future recession could increase defaults, although current credit quality remains stable.",
      []
    ),
    evalCase(
      "energy-rates-positive",
      "Higher crude oil prices revived inflation fears and lifted market-implied rate hike expectations.",
      ["energy-shock-inflation-rates"]
    ),
    evalCase(
      "energy-missing-rate-leg",
      "Oil prices surged after renewed fighting, raising concern about supply disruption and inflation.",
      []
    )
  ];

export function buildNarrativeClassificationEvalRequests(
  model: string
): AnthropicBatchRequest[] {
  return narrativeClassificationEvalCases.map((item, index) => ({
    custom_id: `eval-${index + 1}`,
    params: buildNarrativeClassificationRequest(
      item.document,
      narrativeClassificationEvalDefinitions,
      {
        model,
        promptCaching: true,
        cacheTtl: "1h"
      }
    )
  }));
}

export function scoreNarrativeClassificationEval(
  predictions: NarrativeClassificationEvalPrediction[]
) {
  const predictedByCase = new Map(
    predictions.map((prediction) => [
      prediction.caseId,
      new Set(prediction.matchedSlugs)
    ])
  );
  const totals = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 };
  const perDefinition = narrativeClassificationEvalDefinitions.map(
    (definition) => {
      const counts = {
        slug: definition.slug,
        truePositive: 0,
        falsePositive: 0,
        falseNegative: 0,
        trueNegative: 0
      };
      for (const item of narrativeClassificationEvalCases) {
        const expected = item.expectedMatchedSlugs.includes(definition.slug);
        const predicted =
          predictedByCase.get(item.id)?.has(definition.slug) ?? false;
        const key = expected
          ? predicted
            ? "truePositive"
            : "falseNegative"
          : predicted
            ? "falsePositive"
            : "trueNegative";
        counts[key] += 1;
        totals[key] += 1;
      }
      return { ...counts, ...classificationMetrics(counts) };
    }
  );
  return { ...totals, ...classificationMetrics(totals), perDefinition };
}

export function evalCaseForCustomId(customId: string) {
  const match = /^eval-(\d+)$/.exec(customId);
  if (!match) return null;
  return narrativeClassificationEvalCases[Number(match[1]) - 1] ?? null;
}

function classificationMetrics(counts: {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
}) {
  const precision = ratio(
    counts.truePositive,
    counts.truePositive + counts.falsePositive
  );
  const recall = ratio(
    counts.truePositive,
    counts.truePositive + counts.falseNegative
  );
  const accuracy = ratio(
    counts.truePositive + counts.trueNegative,
    counts.truePositive +
      counts.trueNegative +
      counts.falsePositive +
      counts.falseNegative
  );
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  return {
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    accuracy: round(accuracy)
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function evalCase(
  id: string,
  text: string,
  expectedMatchedSlugs: string[]
): NarrativeClassificationEvalCase {
  return {
    id,
    document: {
      id: `eval:${id}`,
      sourceId: "human-labeled-eval",
      sourceClass: "manual",
      title: id.replaceAll("-", " "),
      publisher: "Human-labeled evaluation",
      url: `https://example.invalid/eval/${id}`,
      publishedAt: "2026-09-02T00:00:00.000Z",
      tickers: [],
      summary: "",
      text,
      textHash: id
    },
    expectedMatchedSlugs
  };
}

export const narrativeClassificationEvalPromptVersion =
  `${narrativeClassificationPromptVersion}:human_eval_v1`;
