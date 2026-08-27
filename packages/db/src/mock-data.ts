import type { DailyBrief, Storyboard } from "./types";

export const storyboards: Storyboard[] = [
  {
    id: "ai-capex-discipline",
    theme: "AI capex discipline",
    status: "broadening",
    narrative:
      "Management teams are still committing to AI infrastructure, but the narrative is shifting from capacity land-grab to return discipline, power availability, and depreciation risk.",
    whyUnusual:
      "The 7-day intensity is 2.4 standard deviations above its 90-day baseline, with corroboration from transcripts, filings, and major newspapers.",
    riskTone: 74,
    bullishTone: 48,
    zScore: 2.4,
    percentileRank: 96,
    confidence: 82,
    affectedEntities: ["MSFT", "GOOGL", "AMZN", "NVDA", "Utilities"],
    sourceMix: {
      filing: 18,
      press_release: 11,
      transcript: 42,
      newspaper: 24,
      government: 0,
      central_bank: 0,
      manual: 5
    },
    trend: [
      { date: "2026-04-29", intensity: 42, baselineMean: 38, zScore: 0.4 },
      { date: "2026-04-30", intensity: 45, baselineMean: 38, zScore: 0.7 },
      { date: "2026-05-01", intensity: 49, baselineMean: 39, zScore: 1.1 },
      { date: "2026-05-02", intensity: 52, baselineMean: 39, zScore: 1.3 },
      { date: "2026-05-03", intensity: 61, baselineMean: 39, zScore: 2.0 },
      { date: "2026-05-04", intensity: 66, baselineMean: 40, zScore: 2.3 },
      { date: "2026-05-05", intensity: 68, baselineMean: 40, zScore: 2.4 }
    ],
    evidence: [
      {
        id: "ev-ai-1",
        documentId: "doc-msft-call",
        sourceClass: "transcript",
        publisher: "Microsoft earnings call",
        title: "Management discussion of AI infrastructure returns",
        url: "https://example.com/msft-call",
        publishedAt: "2026-05-02",
        snippet:
          "Management emphasized phased data center deployment and said capital allocation will remain tied to customer demand signals.",
        scoreContribution: 0.34
      },
      {
        id: "ev-ai-2",
        documentId: "doc-utility-pr",
        sourceClass: "press_release",
        publisher: "Utility IR",
        title: "Power contracts expand for data center customers",
        url: "https://example.com/utility-pr",
        publishedAt: "2026-05-04",
        snippet:
          "The company cited accelerating load requests from data center customers, alongside longer interconnection timelines.",
        scoreContribution: 0.21
      }
    ],
    followUpQuestions: [
      "Which companies are shifting from AI capacity growth to return discipline?",
      "Are utilities confirming the same demand signal?",
      "Is the risk about demand, power, depreciation, or financing?"
    ]
  },
  {
    id: "consumer-trade-down",
    theme: "Consumer trade-down pressure",
    status: "rising",
    narrative:
      "Retailers and consumer companies are describing more selective spending, with trade-down behavior expanding from lower-income cohorts into middle-income categories.",
    whyUnusual:
      "The theme has moved from single-company commentary to broader sector confirmation, with a 2.1 z-score and rising source diversity.",
    riskTone: 81,
    bullishTone: 22,
    zScore: 2.1,
    percentileRank: 93,
    confidence: 78,
    affectedEntities: ["WMT", "TGT", "HD", "LOW", "Restaurants"],
    sourceMix: {
      filing: 10,
      press_release: 15,
      transcript: 51,
      newspaper: 19,
      government: 0,
      central_bank: 0,
      manual: 5
    },
    trend: [
      { date: "2026-04-29", intensity: 33, baselineMean: 35, zScore: -0.2 },
      { date: "2026-04-30", intensity: 35, baselineMean: 35, zScore: 0.0 },
      { date: "2026-05-01", intensity: 41, baselineMean: 35, zScore: 0.7 },
      { date: "2026-05-02", intensity: 44, baselineMean: 35, zScore: 1.0 },
      { date: "2026-05-03", intensity: 51, baselineMean: 36, zScore: 1.6 },
      { date: "2026-05-04", intensity: 55, baselineMean: 36, zScore: 1.9 },
      { date: "2026-05-05", intensity: 58, baselineMean: 36, zScore: 2.1 }
    ],
    evidence: [
      {
        id: "ev-consumer-1",
        documentId: "doc-retailer-call",
        sourceClass: "transcript",
        publisher: "Retailer earnings call",
        title: "Management notes selective discretionary spending",
        url: "https://example.com/retailer-call",
        publishedAt: "2026-05-01",
        snippet:
          "Executives said customers remain value-oriented and are delaying larger-ticket purchases where financing costs matter.",
        scoreContribution: 0.29
      },
      {
        id: "ev-consumer-2",
        documentId: "doc-food-pr",
        sourceClass: "press_release",
        publisher: "Restaurant IR",
        title: "Comparable traffic softens across middle-income cohorts",
        url: "https://example.com/restaurant-pr",
        publishedAt: "2026-05-05",
        snippet:
          "Traffic weakness was most visible among middle-income consumers, while promotional response improved late in the quarter.",
        scoreContribution: 0.25
      }
    ],
    followUpQuestions: [
      "Is trade-down broadening beyond discretionary retail?",
      "Which companies are protecting margins despite traffic pressure?",
      "Are management teams blaming rates, wages, or confidence?"
    ]
  },
  {
    id: "credit-quality-normalization",
    theme: "Credit quality normalization",
    status: "watching",
    narrative:
      "Banks are still framing credit deterioration as normalization, but mentions of delinquencies, reserves, and consumer stress are becoming more clustered.",
    whyUnusual:
      "The z-score is moderate, but evidence quality is high because the signal is concentrated in primary bank commentary and filings.",
    riskTone: 67,
    bullishTone: 31,
    zScore: 1.5,
    percentileRank: 84,
    confidence: 74,
    affectedEntities: ["JPM", "BAC", "C", "DFS", "Consumer credit"],
    sourceMix: {
      filing: 34,
      press_release: 8,
      transcript: 46,
      newspaper: 9,
      government: 0,
      central_bank: 0,
      manual: 3
    },
    trend: [
      { date: "2026-04-29", intensity: 50, baselineMean: 48, zScore: 0.2 },
      { date: "2026-04-30", intensity: 51, baselineMean: 48, zScore: 0.3 },
      { date: "2026-05-01", intensity: 52, baselineMean: 48, zScore: 0.4 },
      { date: "2026-05-02", intensity: 55, baselineMean: 48, zScore: 0.8 },
      { date: "2026-05-03", intensity: 57, baselineMean: 49, zScore: 1.0 },
      { date: "2026-05-04", intensity: 60, baselineMean: 49, zScore: 1.3 },
      { date: "2026-05-05", intensity: 62, baselineMean: 49, zScore: 1.5 }
    ],
    evidence: [
      {
        id: "ev-credit-1",
        documentId: "doc-bank-10q",
        sourceClass: "filing",
        publisher: "Bank 10-Q",
        title: "Consumer reserve build and card delinquency disclosure",
        url: "https://example.com/bank-10q",
        publishedAt: "2026-05-03",
        snippet:
          "The allowance increase reflected higher expected losses in card and auto portfolios, partially offset by commercial stability.",
        scoreContribution: 0.31
      }
    ],
    followUpQuestions: [
      "Is consumer credit deterioration accelerating or just normalizing?",
      "Are banks increasing reserves ahead of realized losses?",
      "Which lenders show the largest tone change?"
    ]
  }
];

export const dailyBrief: DailyBrief = {
  id: "brief-2026-05-06",
  date: "2026-05-06",
  headline: "AI capex discipline and consumer trade-down are the highest-priority narrative shifts.",
  summary:
    "The strongest storyboard move is AI capex discipline, where management commentary is broadening from growth to return discipline and power constraints. Consumer trade-down pressure is also rising, with more middle-income exposure. Credit quality remains a watch item rather than a full alert because the statistical move is smaller but primary-source evidence is improving.",
  storyboardIds: ["ai-capex-discipline", "consumer-trade-down", "credit-quality-normalization"]
};
