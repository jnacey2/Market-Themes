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

export type AnalysisDocument = Document & {
  text: string;
  textHash: string;
};

export type ExtractedSignalInput = {
  id: string;
  documentId: string;
  themeId: string;
  rawThemeLabel: string;
  canonicalThemeLabel: string;
  themeDescription: string;
  stance: ToneDirection;
  riskTone: number;
  bullishTone: number;
  confidence: number;
  evidenceSnippet: string;
  interpretation: string;
  affectedEntities: string[];
  sectionLabel?: string | null;
  speaker?: string | null;
  promptVersion: string;
  model: string;
  metadata?: Record<string, unknown>;
  scoreContribution: number;
};

export type AnalysisRunStatus = "pending" | "running" | "completed" | "failed";

export type AnalysisRunSummary = {
  id: string;
  documentId: string;
  documentTitle: string;
  sourceClass: SourceClass;
  model: string;
  promptVersion: string;
  status: AnalysisRunStatus;
  attemptCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type AnalysisSignalSummary = {
  id: string;
  themeId: string;
  themeLabel: string;
  rawThemeLabel: string;
  canonicalThemeLabel: string;
  stance: string;
  riskTone: number;
  bullishTone: number;
  confidence: number;
  evidenceSnippet: string;
  interpretation: string;
  affectedEntities: string[];
  sectionLabel: string | null;
  speaker: string | null;
  promptVersion: string;
  model: string;
  extractedAt: string;
  documentId: string;
  documentTitle: string;
  publisher: string;
  url: string;
  publishedAt: string;
  sourceClass: SourceClass;
};

export type AnalysisStatus = {
  databaseConfigured: boolean;
  signalCount: number;
  themeCount: number;
  completedRuns: number;
  failedRuns: number;
  recentSignals: AnalysisSignalSummary[];
  recentRuns: AnalysisRunSummary[];
};

export type TrendWindow = "7d" | "30d";

export type TrendEvidenceSummary = {
  id: string;
  documentId: string;
  title: string;
  publisher: string;
  sourceClass: SourceClass;
  publishedAt: string;
  snippet: string;
  scoreContribution: number;
};

export type TrendSummary = {
  id: string;
  themeId: string;
  themeLabel: string;
  trendWindow: TrendWindow;
  date: string;
  intensity: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  percentileRank: number;
  evidenceCount: number;
  sourceMix: Partial<Record<SourceClass, number>>;
  sourceDiversity: number;
  entityBreadth: number;
  lowHistory: boolean;
  candidate: boolean;
  recentEvidence: TrendEvidenceSummary[];
};

export type TrendStatus = {
  databaseConfigured: boolean;
  totalTrendRows: number;
  latestTrendDate: string | null;
  windows: TrendWindow[];
  trends: TrendSummary[];
};

export type RecomputeThemeTrendsResult = {
  themesProcessed: number;
  trendRowsWritten: number;
  lowHistoryRows: number;
  topTrends: Array<{
    themeId: string;
    themeLabel: string;
    trendWindow: TrendWindow;
    zScore: number;
  }>;
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
  secCategoryCounts: Array<{
    category: string;
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
