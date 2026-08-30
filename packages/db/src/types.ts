export type ToneDirection = "risk" | "bullish" | "mixed" | "neutral";

export type SourceClass =
  | "filing"
  | "press_release"
  | "transcript"
  | "newspaper"
  | "government"
  | "central_bank"
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
  canonicalUrl?: string;
  publisherId?: string;
  publisherOwner?: string;
  retentionPolicy?: "full_text" | "snippet" | "metadata_only";
  nearDuplicateKey?: string;
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
  degraded: boolean;
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

export type ConnectorCheckpointSummary = {
  connectorId: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastDocumentAt: string | null;
  lastError: string | null;
  documentsFetched: number;
  documentsInserted: number;
};

export type PublicationFeedPlatform = "substack" | "rss";

export type PublicationFeed = {
  id: string;
  name: string;
  homepageUrl: string;
  feedUrl: string;
  platform: PublicationFeedPlatform;
  sourceClass: SourceClass;
  publisherId: string;
  publisherOwner: string;
  retentionPolicy: "full_text" | "snippet";
  enabled: boolean;
  backfillDays: number;
  maxPostsPerPoll: number;
  rateLimitMs: number;
  tags: string[];
  termsNotes: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastPublishedAt: string | null;
  lastError: string | null;
};

export type PublicationFeedInput = {
  name: string;
  homepageUrl: string;
  feedUrl: string;
  platform: PublicationFeedPlatform;
  publisherOwner?: string;
  retentionPolicy?: "full_text" | "snippet";
  backfillDays?: number;
  maxPostsPerPoll?: number;
  rateLimitMs?: number;
  tags?: string[];
  termsNotes?: string;
};

export type PipelineRunSummary = {
  id: string;
  stage: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  processedCount: number;
  failedCount: number;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
};

export type SourcePipelineTelemetry = {
  sourceId: string;
  sourceClass: SourceClass | null;
  label: string;
  enabled: boolean | null;
  documentCount: number;
  latestDocumentAt: string | null;
  analyzedDocuments: number;
  extractionBacklog: number;
  narrativeClassificationBacklog: number;
  narrativeDiscoveryBacklog: number;
  matchedPending: number;
  matchedApproved: number;
  matchedRejected: number;
  lastIngestAttemptAt: string | null;
  lastIngestSuccessAt: string | null;
  lastIngestError: string | null;
};

export type NarrativeBacklogSummary = {
  total: number;
  bySourceClass: Array<{
    sourceClass: SourceClass;
    count: number;
  }>;
};

export type OperationsStatus = {
  databaseConfigured: boolean;
  latestDocumentAt: string | null;
  totalDocuments: number;
  analyzedDocuments: number;
  extractionBacklog: number;
  normalizationBacklog: number;
  narrativeClassificationBacklog: number;
  narrativeDiscoveryBacklog: number;
  narrativeReviewPendingCount: number;
  narrativeCandidatePendingCount: number;
  narrativeCandidateQualifiedCount: number;
  latestTrendDate: string | null;
  latestNarrativeTrendDate: string | null;
  connectors: ConnectorCheckpointSummary[];
  sourceTelemetry: SourcePipelineTelemetry[];
  recentRuns: PipelineRunSummary[];
};

export type NarrativeDefinition = {
  id: string;
  slug: string;
  version: number;
  name: string;
  proposition: string;
  category: string;
  inclusionGuidance: string;
  exclusionGuidance: string;
  positiveExamples: string[];
  negativeExamples: string[];
  status: string;
};

export type NarrativeCandidateStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "merged";

export type NarrativeCandidateEvidenceInput = {
  id: string;
  documentId: string;
  evidenceSnippet: string;
  interpretation: string;
  stance: ToneDirection;
  riskTone: number;
  bullishTone: number;
  affectedEntities: string[];
  matchScore: number;
  model: string;
  promptVersion: string;
  metadata?: Record<string, unknown>;
};

export type NarrativeCandidateInput = {
  id: string;
  clusterKey: string;
  name: string;
  proposition: string;
  category: string;
  inclusionGuidance: string;
  exclusionGuidance: string;
  model: string;
  promptVersion: string;
  evidence: NarrativeCandidateEvidenceInput[];
  metadata?: Record<string, unknown>;
};

export type NarrativeCandidateContext = {
  clusterKey: string;
  name: string;
  proposition: string;
};

export type NarrativeCandidateEvidence = {
  id: string;
  documentId: string;
  title: string;
  publisher: string;
  publisherId: string;
  publisherOwner: string;
  sourceClass: SourceClass;
  publishedAt: string;
  url: string;
  evidenceSnippet: string;
  interpretation: string;
  stance: ToneDirection;
  riskTone: number;
  bullishTone: number;
  affectedEntities: string[];
  matchScore: number;
};

export type NarrativeCandidateSummary = {
  id: string;
  clusterKey: string;
  name: string;
  proposition: string;
  category: string;
  inclusionGuidance: string;
  exclusionGuidance: string;
  status: NarrativeCandidateStatus;
  mergedIntoCandidateId: string | null;
  promotedDefinitionId: string | null;
  model: string;
  promptVersion: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documentBreadth: number;
  publisherBreadth: number;
  publisherOwnerBreadth: number;
  sourceClassBreadth: number;
  entityBreadth: number;
  qualified: boolean;
  evidence: NarrativeCandidateEvidence[];
};

export type NarrativeCandidateQueue = {
  databaseConfigured: boolean;
  promptVersion: string;
  pendingCount: number;
  qualifiedCount: number;
  approvedCount: number;
  rejectedCount: number;
  mergedCount: number;
  candidates: NarrativeCandidateSummary[];
};

export type NarrativeObservationInput = {
  id: string;
  narrativeDefinitionId: string;
  documentId: string;
  matched: boolean;
  matchScore: number;
  stance: ToneDirection;
  riskTone: number;
  bullishTone: number;
  evidenceSnippet: string;
  interpretation: string;
  affectedEntities: string[];
  model: string;
  promptVersion: string;
  metadata?: Record<string, unknown>;
};

export type NarrativeTrendPoint = {
  date: string;
  density: number;
  baselineMean: number;
  zScore: number;
  percentileRank: number;
  change: number;
  acceleration: number;
  riskTone: number;
  bullishTone: number;
};

export type NarrativeEvidence = {
  id: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url: string;
  sourceClass: SourceClass;
  stance: ToneDirection;
  evidenceSnippet: string;
  interpretation: string;
  affectedEntities: string[];
  matchScore: number;
  reviewStatus: NarrativeReviewStatus;
};

export type NarrativeReviewStatus = "pending" | "approved" | "rejected";

export type NarrativeReviewItem = NarrativeEvidence & {
  narrativeDefinitionId: string;
  narrativeName: string;
  proposition: string;
  inclusionGuidance: string;
  exclusionGuidance: string;
  promptVersion: string;
  reviewNote: string | null;
  reviewedAt: string | null;
};

export type NarrativeReviewQueue = {
  databaseConfigured: boolean;
  promptVersion: string;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  items: NarrativeReviewItem[];
};

export type NarrativeTrendSummary = NarrativeDefinition & {
  trendWindow: TrendWindow;
  latestDate: string | null;
  density: number;
  baselineMean: number;
  zScore: number;
  percentileRank: number;
  change: number;
  acceleration: number;
  riskTone: number;
  bullishTone: number;
  eligibleDocuments: number;
  matchedDocuments: number;
  publisherBreadth: number;
  publisherOwnerBreadth: number;
  sourceClassBreadth: number;
  entityBreadth: number;
  lowHistory: boolean;
  history: NarrativeTrendPoint[];
  evidence: NarrativeEvidence[];
};

export type NarrativeBoardStatus = {
  databaseConfigured: boolean;
  latestDate: string | null;
  narratives: NarrativeTrendSummary[];
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
