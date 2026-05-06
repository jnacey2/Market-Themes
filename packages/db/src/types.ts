export type ToneDirection = "risk" | "bullish" | "mixed" | "neutral";

export type SourceClass =
  | "filing"
  | "press_release"
  | "transcript"
  | "newspaper"
  | "manual";

export type Document = {
  id: string;
  sourceId: string;
  sourceClass: SourceClass;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  tickers: string[];
  summary: string;
};

export type EvidenceCard = {
  id: string;
  documentId: string;
  sourceClass: SourceClass;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string;
  snippet: string;
  scoreContribution: number;
};

export type ThemeTrendPoint = {
  date: string;
  intensity: number;
  baselineMean: number;
  zScore: number;
};

export type Storyboard = {
  id: string;
  theme: string;
  status: "rising" | "fading" | "broadening" | "watching";
  narrative: string;
  whyUnusual: string;
  riskTone: number;
  bullishTone: number;
  zScore: number;
  percentileRank: number;
  confidence: number;
  affectedEntities: string[];
  sourceMix: Record<SourceClass, number>;
  trend: ThemeTrendPoint[];
  evidence: EvidenceCard[];
  followUpQuestions: string[];
};

export type DailyBrief = {
  id: string;
  date: string;
  headline: string;
  summary: string;
  storyboardIds: string[];
};
