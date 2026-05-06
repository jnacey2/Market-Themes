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
  metadata?: Record<string, unknown>;
};

export type PersistableDocument = Document & {
  body: string;
  retrievalMethod: "api" | "rss" | "credentialed" | "scrape" | "manual";
  contentHash?: string;
};

export type PersistDocumentsResult = {
  insertedDocuments: number;
  skippedDocuments: number;
  insertedChunks: number;
};

export type IngestionStatus = {
  databaseConfigured: boolean;
  totalDocuments: number;
  secDocuments: number;
  fmpTranscriptDocuments: number;
  latestSecDocumentAt: string | null;
  latestFmpTranscriptAt: string | null;
  latestCreatedAt: string | null;
  sourceCounts: Array<{
    sourceClass: SourceClass;
    count: number;
  }>;
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
