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
  ingestedDocumentCount: number;
  readableDocumentCount: number;
  missingTextDocumentCount: number;
  eligibleDocumentCount: number;
  completedDocumentCount: number;
  unreadDocumentCount: number;
  runningDocumentCount: number;
  failedDocumentCount: number;
  backfillControl: BackfillControlStatus;
  recentSignals: AnalysisSignalSummary[];
  recentRuns: AnalysisRunSummary[];
};

export type RepairDocumentTextsResult = {
  repairedDocuments: number;
  remainingMissingTextDocuments: number;
};

export type BackfillJobStatus =
  | "queued"
  | "running"
  | "stop_requested"
  | "completed"
  | "failed"
  | "cancelled";

export type BackfillJobSummary = {
  id: string;
  jobType: string;
  status: BackfillJobStatus;
  batchSize: number;
  maxBatches: number;
  concurrency: number;
  documentTimeoutMs: number;
  staleAfterMinutes: number;
  selectedDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  insertedSignals: number;
  themesTouched: number;
  currentDocumentIds: string[];
  lastMessage: string | null;
  lastError: string | null;
  stopRequestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackfillJobRunConfig = BackfillJobSummary & {
  lookbackDays: number | null;
  excludedSecFilingCategories: string[];
  model: string;
  promptVersion: string;
};

export type BackfillControlStatus = {
  activeJob: BackfillJobSummary | null;
  recentJobs: BackfillJobSummary[];
};

export type TrendWindow = "7d" | "30d";

export type TrendEvidenceSummary = {
  id: string;
  documentId: string;
  title: string;
  publisher: string;
  sourceClass: SourceClass;
  publishedAt: string;
  url: string;
  snippet: string;
  scoreContribution: number;
};

export type TrendSummary = {
  id: string;
  themeId: string;
  themeLabel: string;
  themeDescription: string;
  parentThemeId: string | null;
  sector: string | null;
  themeLevel: "market" | "sector" | "unmapped";
  trendWindow: TrendWindow;
  date: string;
  intensity: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  percentileRank: number;
  evidenceCount: number;
  documentBreadth: number;
  sourceMix: Partial<Record<SourceClass, number>>;
  sourceDiversity: number;
  entityBreadth: number;
  lowHistory: boolean;
  candidate: boolean;
  affectedEntities: string[];
  recentEvidence: TrendEvidenceSummary[];
};

export type TrendStatus = {
  databaseConfigured: boolean;
  totalTrendRows: number;
  latestTrendDate: string | null;
  windows: TrendWindow[];
  trends: TrendSummary[];
};

export type LiveDashboardStatus = {
  databaseConfigured: boolean;
  totalTrendRows: number;
  latestTrendDate: string | null;
  confirmedSevenDayThemes: TrendSummary[];
  emergingSevenDayThemes: TrendSummary[];
  confirmedThirtyDayThemes: TrendSummary[];
};

export type RelatedThemeSummary = {
  id: string;
  label: string;
  description: string;
  sector: string | null;
};

export type ThemeDetailStatus = {
  databaseConfigured: boolean;
  theme: {
    id: string;
    label: string;
    description: string;
    themeLevel: string;
    sector: string | null;
  } | null;
  latestTrendDate: string | null;
  sevenDayTrend: TrendSummary | null;
  thirtyDayTrend: TrendSummary | null;
  trendHistory: ThemeTrendPoint[];
  affectedEntities: string[];
  citations: TrendEvidenceSummary[];
  relatedSubthemes: RelatedThemeSummary[];
  followUpQuestions: string[];
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

export type ThemeGroupForNormalization = {
  themeId: string;
  label: string;
  description: string;
  signalCount: number;
  sourceClasses: SourceClass[];
  affectedEntities: string[];
  representativeSnippets: string[];
};

export type ThemeNormalizationMapping = {
  id: string;
  marketThemeId: string;
  marketThemeLabel: string;
  marketThemeDescription: string;
  sectorSubthemeId: string | null;
  sectorSubthemeLabel: string | null;
  sectorSubthemeDescription: string | null;
  sector: string;
  mappedThemeIds: string[];
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  rationale: string;
  status: "auto_applied" | "needs_review";
  model: string;
  promptVersion: string;
};

export type ThemeMappingSummary = {
  id: string;
  marketThemeId: string;
  marketThemeLabel: string;
  marketThemeDescription: string;
  sectorSubthemeId: string | null;
  sectorSubthemeLabel: string | null;
  sectorSubthemeDescription: string | null;
  sector: string;
  extractedThemeId: string;
  extractedThemeLabel: string;
  confidence: number;
  confidenceLabel: string;
  rationale: string;
  status: string;
  signalCount: number;
  affectedEntities: string[];
  representativeSnippets: string[];
};

export type ThemeMappingStatus = {
  databaseConfigured: boolean;
  mappingCount: number;
  mappedSignalCount: number;
  unmappedSignalCount: number;
  mappings: ThemeMappingSummary[];
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
