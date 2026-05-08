import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AnalysisDocument,
  AnalysisRunStatus,
  AnalysisRunSummary,
  AnalysisSignalSummary,
  AnalysisStatus,
  BackfillControlStatus,
  BackfillJobRunConfig,
  BackfillJobStatus,
  BackfillJobSummary,
  ExtractedSignalInput,
  IngestionStatus,
  LiveDashboardStatus,
  PersistableDocument,
  PersistDocumentsResult,
  RecomputeThemeTrendsResult,
  SourceClass,
  ThemeGroupForNormalization,
  ThemeDetailStatus,
  ThemeMappingStatus,
  ThemeMappingSummary,
  ThemeNormalizationMapping,
  TrendEvidenceSummary,
  ThemeTrendPoint,
  TrendStatus,
  TrendSummary,
  TrendWindow
} from "./types";

const { Client } = pg;

type DbClient = pg.Client;

const DEFAULT_CHUNK_SIZE = 8_000;
const DEFAULT_CHUNK_OVERLAP = 500;

type SelectAnalysisDocumentsOptions = {
  analysisType: string;
  model: string;
  promptVersion: string;
  limit?: number;
  lookbackDays?: number;
  excludedSecFilingCategories?: string[];
  maxAttempts?: number;
};

type CreateBackfillJobOptions = {
  jobType?: string;
  batchSize?: number;
  maxBatches?: number;
  concurrency?: number;
  documentTimeoutMs?: number;
  staleAfterMinutes?: number;
  lookbackDays?: number;
  excludedSecFilingCategories?: string[];
  model?: string;
  promptVersion?: string;
  metadata?: Record<string, unknown>;
};

type BackfillJobRow = {
  id: string;
  job_type: string;
  status: BackfillJobStatus;
  batch_size: number;
  max_batches: number;
  concurrency: number;
  document_timeout_ms: number;
  stale_after_minutes: number;
  selected_documents: number;
  completed_documents: number;
  failed_documents: number;
  inserted_signals: number;
  themes_touched: number;
  current_document_ids: string[];
  last_message: string | null;
  last_error: string | null;
  stop_requested_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ClaimableBackfillJobRow = BackfillJobRow & {
  lookback_days: number | null;
  excluded_sec_filing_categories: string[];
  model: string;
  prompt_version: string;
};

type AnalysisRunOptions = {
  analysisType: string;
  model: string;
  promptVersion: string;
  metadata?: Record<string, unknown>;
};

type RecomputeThemeTrendsOptions = {
  asOfDate?: string;
  lookbackDays?: number;
  lowHistoryDays?: number;
  storageDays?: number;
  windows?: TrendWindow[];
  onProgress?: (message: string) => void;
};

type SelectThemeGroupsOptions = {
  promptVersion: string;
  limit?: number;
};

type SignalTrendInput = {
  signalId: string;
  documentId: string;
  themeId: string;
  themeLabel: string;
  trendLevel: "market" | "sector" | "unmapped";
  signalDate: string;
  sourceClass: SourceClass;
  affectedEntities: string[];
  scoreContribution: number;
};

type DailyTrendBucket = {
  date: string;
  baseIntensity: number;
  intensity: number;
  evidenceCount: number;
  documentIds: Set<string>;
  sourceMix: Partial<Record<SourceClass, number>>;
  sourceClasses: Set<SourceClass>;
  entities: Set<string>;
};

type TrendRowInput = {
  id: string;
  themeId: string;
  trendWindow: TrendWindow;
  date: string;
  intensity: number;
  baselineMean: number;
  baselineStddev: number;
  zScore: number;
  percentileRank: number;
  sourceMix: Record<string, unknown>;
};

type ThemeTrendDbRow = {
  id: string;
  theme_id: string;
  theme_label: string;
  theme_description: string | null;
  parent_theme_id: string | null;
  sector: string | null;
  trend_window: TrendWindow;
  date: string;
  intensity: number;
  baseline_mean: number;
  baseline_stddev: number;
  z_score: number;
  percentile_rank: number;
  source_mix: Record<string, unknown>;
};

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
    query_timeout: 20_000,
    statement_timeout: 20_000,
    ssl: databaseUrl.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined
  });

  client.on("error", (error) => {
    console.warn(
      `[db] postgres client error: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  return client;
}

export async function persistDocuments(
  documents: PersistableDocument[],
  databaseUrl = process.env.DATABASE_URL
): Promise<PersistDocumentsResult> {
  if (documents.length === 0) {
    return {
      insertedDocuments: 0,
      skippedDocuments: 0,
      insertedChunks: 0
    };
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    let insertedDocuments = 0;
    let skippedDocuments = 0;
    let insertedChunks = 0;

    for (const document of documents) {
      await upsertSource(client, document);
      const contentHash = document.contentHash ?? hashContent(document.body);
      const documentId = await resolveDocumentId(client, document.id, contentHash);

      if (!documentId) {
        skippedDocuments += 1;
        continue;
      }

      const insertResult = await client.query<{ id: string }>(
        `insert into documents (
          id,
          source_id,
          source_class,
          title,
          publisher,
          url,
          published_at,
          tickers,
          summary,
          retrieval_method,
          metadata,
          content_hash
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (content_hash) do nothing
        returning id`,
        [
          documentId,
          document.sourceId,
          document.sourceClass,
          document.title,
          document.publisher,
          document.url,
          document.publishedAt,
          document.tickers,
          document.summary,
          document.retrievalMethod,
          JSON.stringify(document.metadata ?? {}),
          contentHash
        ]
      );

      if (insertResult.rowCount === 0) {
        skippedDocuments += 1;
        continue;
      }

      insertedDocuments += 1;
      await upsertDocumentText(client, documentId, document.body, "ingestion");
      const chunks = chunkText(document.body);

      for (const [index, content] of chunks.entries()) {
        await client.query(
          `insert into document_chunks (
            id,
            document_id,
            chunk_index,
            content
          ) values ($1, $2, $3, $4)
          on conflict (document_id, chunk_index) do nothing`,
          [`${documentId}:chunk:${index}`, documentId, index, content]
        );
        insertedChunks += 1;
      }
    }

    return {
      insertedDocuments,
      skippedDocuments,
      insertedChunks
    };
  } finally {
    await client.end();
  }
}

export async function selectDocumentsForAnalysis(
  options: SelectAnalysisDocumentsOptions,
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const limit = options.limit ?? 20;
    const lookbackDays = options.lookbackDays ?? null;
    const excludedSecFilingCategories = options.excludedSecFilingCategories ?? [];
    const maxAttempts = options.maxAttempts ?? 5;
    const result = await client.query<{
      id: string;
      source_id: string;
      source_class: SourceClass;
      title: string;
      publisher: string;
      url: string;
      published_at: string;
      tickers: string[];
      summary: string;
      metadata: Record<string, unknown>;
      content: string | null;
    }>(
      `with candidate_documents as (
        select
          d.id,
          d.source_id,
          d.source_class,
          d.title,
          d.publisher,
          d.url,
          d.published_at,
          d.tickers,
          d.summary,
          d.metadata,
          d.created_at
        from documents d
        left join document_analysis_runs ar
          on ar.document_id = d.id
          and ar.analysis_type = $1
          and ar.model = $2
          and ar.prompt_version = $3
        where d.source_id in ('sec-filings', 'fmp-transcripts')
          and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
          and exists (
            select 1
            from document_texts dt
            where dt.document_id = d.id
          )
          and not (
            d.source_id = 'sec-filings'
            and coalesce(d.metadata->>'filingCategory', 'uncategorized') = any($6::text[])
          )
          and coalesce(ar.status, '') not in ('completed', 'running')
          and coalesce(ar.attempt_count, 0) < $7
        order by
          case
            when d.source_id = 'fmp-transcripts' then 0
            when coalesce(d.metadata->>'filingCategory', '') in ('core', 'exhibit') then 1
            else 2
          end,
          d.published_at desc,
          d.created_at desc
        limit $5
      )
      select
        d.id,
        d.source_id,
        d.source_class,
        d.title,
        d.publisher,
        d.url,
        d.published_at::text,
        d.tickers,
        d.summary,
        d.metadata,
        dt.content
       from candidate_documents d
       join document_texts dt on dt.document_id = d.id
       order by
        case
          when d.source_id = 'fmp-transcripts' then 0
          when coalesce(d.metadata->>'filingCategory', '') in ('core', 'exhibit') then 1
          else 2
        end,
        d.published_at desc,
        d.created_at desc
      `,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        lookbackDays,
        limit,
        excludedSecFilingCategories,
        maxAttempts
      ]
    );

    const documents: AnalysisDocument[] = [];

    for (const row of result.rows) {
      const text = row.content?.trim() ?? "";

      if (!text) {
        continue;
      }

      await upsertDocumentText(client, row.id, text, "reconstructed_chunks");

      documents.push({
        id: row.id,
        sourceId: row.source_id,
        sourceClass: row.source_class,
        title: row.title,
        publisher: row.publisher,
        url: row.url,
        publishedAt: row.published_at,
        tickers: row.tickers,
        summary: row.summary,
        metadata: row.metadata,
        text,
        textHash: hashContent(text)
      });
    }

    return documents;
  } finally {
    await client.end();
  }
}

export async function recoverStaleDocumentAnalysisRuns(
  options: {
    analysisType: string;
    model: string;
    promptVersion: string;
    staleAfterMinutes: number;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const result = await client.query<{ document_id: string }>(
      `update document_analysis_runs
       set
        status = 'failed',
        error_message = $5,
        completed_at = now(),
        updated_at = now()
       where analysis_type = $1
        and model = $2
        and prompt_version = $3
        and status = 'running'
        and updated_at < now() - ($4::text || ' minutes')::interval
       returning document_id`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        options.staleAfterMinutes,
        `Marked stale after ${options.staleAfterMinutes} minutes so extraction can retry.`
      ]
    );

    return {
      recoveredRuns: result.rowCount ?? 0,
      documentIds: result.rows.map((row) => row.document_id)
    };
  } finally {
    await client.end();
  }
}

export async function createBackfillJob(
  options: CreateBackfillJobOptions = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillJobSummary> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  const jobType = options.jobType ?? "claude_extraction";

  try {
    await ensureBackfillJobsSchema(client);

    const active = await client.query<BackfillJobRow>(
      `select ${backfillJobSelectColumns}
       from backfill_jobs
       where job_type = $1
        and status in ('queued', 'running', 'stop_requested')
       order by created_at desc
       limit 1`,
      [jobType]
    );

    if (active.rows[0]) {
      return rowToBackfillJob(active.rows[0]);
    }

    const id = `backfill:${hashContent(`${jobType}:${Date.now()}:${Math.random()}`).slice(0, 24)}`;
    const result = await client.query<BackfillJobRow>(
      `insert into backfill_jobs (
        id,
        job_type,
        status,
        batch_size,
        max_batches,
        concurrency,
        document_timeout_ms,
        stale_after_minutes,
        lookback_days,
        excluded_sec_filing_categories,
        model,
        prompt_version,
        metadata,
        last_message
      ) values ($1, $2, 'queued', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning ${backfillJobSelectColumns}`,
      [
        id,
        jobType,
        options.batchSize ?? 10,
        options.maxBatches ?? 5,
        options.concurrency ?? 2,
        options.documentTimeoutMs ?? 600_000,
        options.staleAfterMinutes ?? 90,
        options.lookbackDays ?? null,
        options.excludedSecFilingCategories ?? ["capital_markets"],
        options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
        options.promptVersion ?? process.env.CLAUDE_PROMPT_VERSION ?? "market_signal_extraction_v1",
        JSON.stringify(options.metadata ?? {}),
        "Queued Claude extraction backfill."
      ]
    );

    return rowToBackfillJob(result.rows[0]);
  } finally {
    await client.end();
  }
}

export async function requestBackfillStop(
  options: { jobId?: string; jobType?: string } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillJobSummary | null> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await ensureBackfillJobsSchema(client);

    const params = [options.jobId ?? null, options.jobType ?? "claude_extraction"];
    const result = await client.query<BackfillJobRow>(
      `update backfill_jobs
       set
        status = case
          when status = 'queued' then 'cancelled'
          when status = 'running' then 'stop_requested'
          when status = 'stop_requested' then 'cancelled'
          else status
        end,
        stop_requested_at = now(),
        completed_at = case
          when status in ('queued', 'stop_requested') then now()
          else completed_at
        end,
        last_message = case
          when status = 'queued' then 'Cancelled before the worker started.'
          when status = 'running' then 'Stop requested. The worker will finish in-flight documents first.'
          when status = 'stop_requested' then 'Cancelled stuck stop request.'
          else last_message
        end,
        updated_at = now()
       where ($1::text is null or id = $1)
        and job_type = $2
        and status in ('queued', 'running', 'stop_requested')
       returning ${backfillJobSelectColumns}`,
      params
    );

    const stoppedJob = result.rows[0];

    if (options.jobId && stoppedJob?.status === "cancelled") {
      await client.query(
        `update document_analysis_runs
         set
          status = 'failed',
          error_message = 'Cancelled with stuck backfill job.',
          completed_at = now(),
          updated_at = now()
         where status = 'running'
          and (
            metadata->>'backfillJobId' = $1
            or metadata ? 'backfillJobId'
          )`,
        [options.jobId]
      );
    }

    return stoppedJob ? rowToBackfillJob(stoppedJob) : null;
  } finally {
    await client.end();
  }
}

export async function getBackfillControlStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillControlStatus> {
  if (!databaseUrl) {
    return emptyBackfillControlStatus();
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await ensureBackfillJobsSchema(client);

    const active = await client.query<BackfillJobRow>(
      `select ${backfillJobSelectColumns}
       from backfill_jobs
       where status in ('queued', 'running', 'stop_requested')
       order by created_at desc
       limit 1`
    );
    const recent = await client.query<BackfillJobRow>(
      `select ${backfillJobSelectColumns}
       from backfill_jobs
       order by created_at desc
       limit 5`
    );

    return {
      activeJob: active.rows[0] ? rowToBackfillJob(active.rows[0]) : null,
      recentJobs: recent.rows.map(rowToBackfillJob)
    };
  } catch {
    return emptyBackfillControlStatus();
  } finally {
    await client.end();
  }
}

export async function claimNextBackfillJob(
  workerId: string,
  jobType = "claude_extraction",
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillJobRunConfig | null> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await ensureBackfillJobsSchema(client);

    const result = await client.query<ClaimableBackfillJobRow>(
      `with next_job as (
        select id
        from backfill_jobs
        where job_type = $1
          and status = 'queued'
        order by created_at
        limit 1
        for update skip locked
      )
      update backfill_jobs bj
      set
        status = 'running',
        worker_id = $2,
        started_at = coalesce(started_at, now()),
        last_message = 'Worker claimed job.',
        updated_at = now()
      from next_job
      where bj.id = next_job.id
      returning ${claimableBackfillJobReturnColumns}`,
      [jobType, workerId]
    );

    return result.rows[0] ? rowToBackfillJobRunConfig(result.rows[0]) : null;
  } finally {
    await client.end();
  }
}

export async function updateBackfillJobProgress(
  jobId: string,
  progress: {
    status?: BackfillJobStatus;
    selectedDocumentsDelta?: number;
    completedDocumentsDelta?: number;
    failedDocumentsDelta?: number;
    insertedSignalsDelta?: number;
    themesTouchedDelta?: number;
    currentDocumentIds?: string[];
    lastMessage?: string | null;
    lastError?: string | null;
    completedAtNow?: boolean;
  },
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillJobSummary | null> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await ensureBackfillJobsSchema(client);

    const updates: string[] = ["updated_at = now()"];
    const values: unknown[] = [];

    function addValue(value: unknown) {
      values.push(value);
      return `$${values.length}`;
    }

    if (progress.status) {
      updates.push(`status = ${addValue(progress.status)}`);
    }

    if (progress.selectedDocumentsDelta) {
      updates.push(`selected_documents = selected_documents + ${addValue(progress.selectedDocumentsDelta)}`);
    }

    if (progress.completedDocumentsDelta) {
      updates.push(`completed_documents = completed_documents + ${addValue(progress.completedDocumentsDelta)}`);
    }

    if (progress.failedDocumentsDelta) {
      updates.push(`failed_documents = failed_documents + ${addValue(progress.failedDocumentsDelta)}`);
    }

    if (progress.insertedSignalsDelta) {
      updates.push(`inserted_signals = inserted_signals + ${addValue(progress.insertedSignalsDelta)}`);
    }

    if (progress.themesTouchedDelta) {
      updates.push(`themes_touched = themes_touched + ${addValue(progress.themesTouchedDelta)}`);
    }

    if (progress.currentDocumentIds) {
      updates.push(`current_document_ids = ${addValue(progress.currentDocumentIds)}`);
    }

    if (progress.lastMessage !== undefined) {
      updates.push(`last_message = ${addValue(progress.lastMessage)}`);
    }

    if (progress.lastError !== undefined) {
      updates.push(`last_error = ${addValue(progress.lastError)}`);
    }

    if (progress.completedAtNow) {
      updates.push("completed_at = now()");
    }

    const idParam = addValue(jobId);
    const result = await client.query<BackfillJobRow>(
      `update backfill_jobs
       set ${updates.join(",\n        ")}
       where id = ${idParam}
       returning ${backfillJobSelectColumns}`,
      values
    );

    return result.rows[0] ? rowToBackfillJob(result.rows[0]) : null;
  } finally {
    await client.end();
  }
}

export async function getBackfillJobForWorker(
  jobId: string,
  databaseUrl = process.env.DATABASE_URL
): Promise<BackfillJobRunConfig | null> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await ensureBackfillJobsSchema(client);

    const result = await client.query<ClaimableBackfillJobRow>(
      `select ${claimableBackfillJobSelectColumns}
       from backfill_jobs
       where id = $1`,
      [jobId]
    );

    return result.rows[0] ? rowToBackfillJobRunConfig(result.rows[0]) : null;
  } finally {
    await client.end();
  }
}

export async function startDocumentAnalysisRun(
  documentId: string,
  options: AnalysisRunOptions,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const runId = analysisRunId(
      documentId,
      options.analysisType,
      options.model,
      options.promptVersion
    );
    await client.query(
      `insert into document_analysis_runs (
        id,
        document_id,
        analysis_type,
        model,
        prompt_version,
        status,
        attempt_count,
        error_message,
        started_at,
        completed_at,
        metadata,
        updated_at
      ) values ($1, $2, $3, $4, $5, 'running', 1, null, now(), null, $6, now())
      on conflict (document_id, analysis_type, model, prompt_version) do update set
        status = 'running',
        attempt_count = document_analysis_runs.attempt_count + 1,
        error_message = null,
        started_at = now(),
        completed_at = null,
        metadata = excluded.metadata,
        updated_at = now()`,
      [
        runId,
        documentId,
        options.analysisType,
        options.model,
        options.promptVersion,
        JSON.stringify(options.metadata ?? {})
      ]
    );

    return runId;
  } finally {
    await client.end();
  }
}

export async function completeDocumentAnalysisRun(
  runId: string,
  signals: ExtractedSignalInput[],
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await client.query("begin");

    let insertedSignals = 0;
    const touchedThemeIds = new Set<string>();

    for (const signal of signals) {
      await client.query(
        `insert into themes (
          id,
          label,
          description,
          status
        ) values ($1, $2, $3, 'emerging')
        on conflict (id) do update set
          label = excluded.label,
          description = case
            when themes.description = '' then excluded.description
            else themes.description
          end`,
        [signal.themeId, signal.canonicalThemeLabel, signal.themeDescription]
      );
      touchedThemeIds.add(signal.themeId);

      const insertSignal = await client.query(
        `insert into signals (
          id,
          document_id,
          theme_id,
          raw_theme_label,
          canonical_theme_label,
          stance,
          risk_tone,
          bullish_tone,
          confidence,
          evidence_snippet,
          interpretation,
          affected_entities,
          section_label,
          speaker,
          prompt_version,
          model,
          metadata,
          score_contribution
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18
        )
        on conflict (document_id, prompt_version, theme_id, evidence_snippet)
        do nothing`,
        [
          signal.id,
          signal.documentId,
          signal.themeId,
          signal.rawThemeLabel,
          signal.canonicalThemeLabel,
          signal.stance,
          signal.riskTone,
          signal.bullishTone,
          signal.confidence,
          signal.evidenceSnippet,
          signal.interpretation,
          signal.affectedEntities,
          signal.sectionLabel ?? null,
          signal.speaker ?? null,
          signal.promptVersion,
          signal.model,
          JSON.stringify(signal.metadata ?? {}),
          signal.scoreContribution
        ]
      );

      if ((insertSignal.rowCount ?? 0) > 0) {
        insertedSignals += 1;
      }
    }

    await client.query(
      `update document_analysis_runs
       set status = 'completed',
        completed_at = now(),
        error_message = null,
        updated_at = now()
       where id = $1`,
      [runId]
    );

    await client.query("commit");

    return {
      insertedSignals,
      themesTouched: touchedThemeIds.size
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function failDocumentAnalysisRun(
  runId: string,
  error: unknown,
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await client.query(
      `update document_analysis_runs
       set status = 'failed',
        error_message = $2,
        completed_at = now(),
        updated_at = now()
       where id = $1`,
      [runId, error instanceof Error ? error.message : String(error)]
    );
  } finally {
    await client.end();
  }
}

export async function getAnalysisStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisStatus> {
  if (!databaseUrl) {
    return emptyAnalysisStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const analysisModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
    const analysisPromptVersion = process.env.CLAUDE_PROMPT_VERSION ?? "market_signal_extraction_v1";
    const maxAnalysisAttempts = Number(process.env.CLAUDE_ANALYSIS_MAX_ATTEMPTS ?? 5);
    const totals = await client.query<{
      signal_count: string;
      theme_count: string;
      completed_runs: string;
      failed_runs: string;
      eligible_document_count: string;
      completed_document_count: string;
      unread_document_count: string;
      running_document_count: string;
      failed_document_count: string;
    }>(
      `select
        (select count(*)::text from signals) as signal_count,
        (select count(*)::text from themes) as theme_count,
        (select count(*)::text from document_analysis_runs where status = 'completed') as completed_runs,
        (select count(*)::text from document_analysis_runs where status = 'failed') as failed_runs,
        count(*)::text as eligible_document_count,
        count(*) filter (where ar.status = 'completed')::text as completed_document_count,
        count(*) filter (
          where coalesce(ar.status, '') not in ('completed', 'running')
            and coalesce(ar.attempt_count, 0) < $3
        )::text as unread_document_count,
        count(*) filter (where ar.status = 'running')::text as running_document_count,
        count(*) filter (where ar.status = 'failed')::text as failed_document_count
       from documents d
       left join document_analysis_runs ar
        on ar.document_id = d.id
        and ar.analysis_type = 'market_signal_extraction'
        and ar.model = $1
        and ar.prompt_version = $2
       where d.source_id in ('sec-filings', 'fmp-transcripts')
        and exists (
          select 1
          from document_texts dt
          where dt.document_id = d.id
        )
        and not (
          d.source_id = 'sec-filings'
          and coalesce(d.metadata->>'filingCategory', 'uncategorized') = 'capital_markets'
        )`,
      [analysisModel, analysisPromptVersion, maxAnalysisAttempts]
    );

    const recentSignals = await client.query<AnalysisSignalSummary>(
      `select
        s.id,
        s.theme_id as "themeId",
        t.label as "themeLabel",
        s.raw_theme_label as "rawThemeLabel",
        s.canonical_theme_label as "canonicalThemeLabel",
        s.stance,
        s.risk_tone::float as "riskTone",
        s.bullish_tone::float as "bullishTone",
        s.confidence::float as confidence,
        s.evidence_snippet as "evidenceSnippet",
        s.interpretation,
        s.affected_entities as "affectedEntities",
        s.section_label as "sectionLabel",
        s.speaker,
        s.prompt_version as "promptVersion",
        s.model,
        s.extracted_at::text as "extractedAt",
        d.id as "documentId",
        d.title as "documentTitle",
        d.publisher,
        d.url,
        d.published_at::text as "publishedAt",
        d.source_class as "sourceClass"
       from signals s
       join documents d on d.id = s.document_id
       join themes t on t.id = s.theme_id
       order by s.extracted_at desc
       limit 25`
    );

    const recentRuns = await client.query<AnalysisRunSummary>(
      `select
        ar.id,
        ar.document_id as "documentId",
        d.title as "documentTitle",
        d.source_class as "sourceClass",
        ar.model,
        ar.prompt_version as "promptVersion",
        ar.status,
        ar.attempt_count as "attemptCount",
        ar.error_message as "errorMessage",
        ar.started_at::text as "startedAt",
        ar.completed_at::text as "completedAt",
        ar.updated_at::text as "updatedAt"
       from document_analysis_runs ar
       join documents d on d.id = ar.document_id
       order by ar.updated_at desc
       limit 25`
    );

    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      signalCount: Number(row?.signal_count ?? 0),
      themeCount: Number(row?.theme_count ?? 0),
      completedRuns: Number(row?.completed_runs ?? 0),
      failedRuns: Number(row?.failed_runs ?? 0),
      eligibleDocumentCount: Number(row?.eligible_document_count ?? 0),
      completedDocumentCount: Number(row?.completed_document_count ?? 0),
      unreadDocumentCount: Number(row?.unread_document_count ?? 0),
      runningDocumentCount: Number(row?.running_document_count ?? 0),
      failedDocumentCount: Number(row?.failed_document_count ?? 0),
      backfillControl: await getBackfillControlStatus(databaseUrl),
      recentSignals: recentSignals.rows,
      recentRuns: recentRuns.rows.map((run) => ({
        ...run,
        status: run.status as AnalysisRunStatus
      }))
    };
  } catch {
    return emptyAnalysisStatus(true);
  } finally {
    await client.end();
  }
}

export async function selectThemeGroupsForNormalization(
  options: SelectThemeGroupsOptions,
  databaseUrl = process.env.DATABASE_URL
): Promise<ThemeGroupForNormalization[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const result = await client.query<{
      theme_id: string;
      label: string;
      description: string;
      source_class: SourceClass;
      affected_entities: string[];
      evidence_snippet: string;
    }>(
      `with selected_themes as (
        select t.id
        from themes t
        join signals s on s.theme_id = t.id
        left join theme_mappings tm
          on tm.extracted_theme_id = t.id
          and tm.prompt_version = $1
        where tm.id is null
        group by t.id
        order by count(s.id) desc, max(s.extracted_at) desc
        limit $2
      )
      select
        t.id as theme_id,
        t.label,
        t.description,
        d.source_class,
        s.affected_entities,
        s.evidence_snippet
      from selected_themes st
      join themes t on t.id = st.id
      join signals s on s.theme_id = t.id
      join documents d on d.id = s.document_id
      order by t.id, s.score_contribution desc, s.extracted_at desc`,
      [options.promptVersion, options.limit ?? 250]
    );
    const groups = new Map<string, ThemeGroupForNormalization>();

    for (const row of result.rows) {
      let group = groups.get(row.theme_id);

      if (!group) {
        group = {
          themeId: row.theme_id,
          label: row.label,
          description: row.description,
          signalCount: 0,
          sourceClasses: [],
          affectedEntities: [],
          representativeSnippets: []
        };
        groups.set(row.theme_id, group);
      }

      group.signalCount += 1;

      if (!group.sourceClasses.includes(row.source_class)) {
        group.sourceClasses.push(row.source_class);
      }

      for (const entity of row.affected_entities ?? []) {
        if (entity && !group.affectedEntities.includes(entity)) {
          group.affectedEntities.push(entity);
        }
      }

      if (group.representativeSnippets.length < 3) {
        group.representativeSnippets.push(row.evidence_snippet);
      }
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      affectedEntities: group.affectedEntities.slice(0, 12)
    }));
  } finally {
    await client.end();
  }
}

export async function persistThemeNormalizationMappings(
  mappings: ThemeNormalizationMapping[],
  databaseUrl = process.env.DATABASE_URL
) {
  if (mappings.length === 0) {
    return {
      mappingsStored: 0,
      mappingsApplied: 0
    };
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    await client.query("begin");

    let mappingsStored = 0;
    let mappingsApplied = 0;

    for (const mapping of mappings) {
      await upsertNormalizedTheme(client, {
        id: mapping.marketThemeId,
        label: mapping.marketThemeLabel,
        description: mapping.marketThemeDescription,
        level: "market",
        sector: null,
        parentThemeId: null,
        metadata: {
          source: "theme_normalization",
          promptVersion: mapping.promptVersion
        }
      });

      if (mapping.sectorSubthemeId && mapping.sectorSubthemeLabel) {
        await upsertNormalizedTheme(client, {
          id: mapping.sectorSubthemeId,
          label: mapping.sectorSubthemeLabel,
          description: mapping.sectorSubthemeDescription ?? "",
          level: "sector",
          sector: mapping.sector,
          parentThemeId: mapping.marketThemeId,
          metadata: {
            source: "theme_normalization",
            promptVersion: mapping.promptVersion
          }
        });
      }

      for (const extractedThemeId of mapping.mappedThemeIds) {
        const insertResult = await client.query(
          `insert into theme_mappings (
            id,
            extracted_theme_id,
            market_theme_id,
            sector_subtheme_id,
            sector,
            confidence,
            confidence_label,
            rationale,
            status,
            model,
            prompt_version,
            metadata,
            updated_at
          ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
          on conflict (extracted_theme_id, prompt_version) do update set
            market_theme_id = excluded.market_theme_id,
            sector_subtheme_id = excluded.sector_subtheme_id,
            sector = excluded.sector,
            confidence = excluded.confidence,
            confidence_label = excluded.confidence_label,
            rationale = excluded.rationale,
            status = excluded.status,
            model = excluded.model,
            metadata = excluded.metadata,
            updated_at = now()`,
          [
            `${mapping.id}:${hashContent(extractedThemeId).slice(0, 8)}`,
            extractedThemeId,
            mapping.marketThemeId,
            mapping.sectorSubthemeId,
            mapping.sector,
            mapping.confidence,
            mapping.confidenceLabel,
            mapping.rationale,
            mapping.status,
            mapping.model,
            mapping.promptVersion,
            JSON.stringify({
              marketThemeLabel: mapping.marketThemeLabel,
              sectorSubthemeLabel: mapping.sectorSubthemeLabel
            })
          ]
        );
        mappingsStored += insertResult.rowCount ?? 0;

        if (mapping.status === "auto_applied") {
          const updateResult = await client.query(
            `update signals
             set canonical_theme_id = $2,
              canonical_subtheme_id = $3
             where theme_id = $1`,
            [extractedThemeId, mapping.marketThemeId, mapping.sectorSubthemeId]
          );
          mappingsApplied += updateResult.rowCount ?? 0;
        }
      }
    }

    await client.query("commit");

    return {
      mappingsStored,
      mappingsApplied
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getThemeMappingStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<ThemeMappingStatus> {
  if (!databaseUrl) {
    return emptyThemeMappingStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      mapping_count: string;
      mapped_signal_count: string;
      unmapped_signal_count: string;
    }>(
      `select
        (select count(*)::text from theme_mappings) as mapping_count,
        (select count(*)::text from signals where canonical_theme_id is not null) as mapped_signal_count,
        (select count(*)::text from signals where canonical_theme_id is null) as unmapped_signal_count`
    );
    const mappings = await client.query<ThemeMappingSummary>(
      `select
        tm.id,
        tm.market_theme_id as "marketThemeId",
        mt.label as "marketThemeLabel",
        mt.description as "marketThemeDescription",
        tm.sector_subtheme_id as "sectorSubthemeId",
        st.label as "sectorSubthemeLabel",
        st.description as "sectorSubthemeDescription",
        tm.sector,
        tm.extracted_theme_id as "extractedThemeId",
        et.label as "extractedThemeLabel",
        tm.confidence::float as confidence,
        tm.confidence_label as "confidenceLabel",
        tm.rationale,
        tm.status,
        count(s.id)::int as "signalCount",
        coalesce(array_agg(distinct entity.entity) filter (where entity.entity is not null), '{}') as "affectedEntities",
        coalesce((array_agg(s.evidence_snippet order by s.score_contribution desc))[1:3], '{}') as "representativeSnippets"
       from theme_mappings tm
       join themes mt on mt.id = tm.market_theme_id
       left join themes st on st.id = tm.sector_subtheme_id
       join themes et on et.id = tm.extracted_theme_id
       left join signals s on s.theme_id = tm.extracted_theme_id
       left join lateral unnest(s.affected_entities) as entity(entity) on true
       group by tm.id, mt.label, mt.description, st.label, st.description, et.label
       order by mt.label, st.label nulls first, tm.confidence desc
       limit 250`
    );
    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      mappingCount: Number(row?.mapping_count ?? 0),
      mappedSignalCount: Number(row?.mapped_signal_count ?? 0),
      unmappedSignalCount: Number(row?.unmapped_signal_count ?? 0),
      mappings: mappings.rows
    };
  } catch {
    return emptyThemeMappingStatus(true);
  } finally {
    await client.end();
  }
}

export async function recomputeThemeTrends(
  options: RecomputeThemeTrendsOptions = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<RecomputeThemeTrendsResult> {
  const client = createDatabaseClient(databaseUrl);
  options.onProgress?.("connecting");
  await client.connect();

  try {
    const windows = options.windows ?? ["7d", "30d"];
    const lookbackDays = options.lookbackDays ?? 120;
    const lowHistoryDays = options.lowHistoryDays ?? 14;
    const asOfDate = normalizeDate(options.asOfDate ?? new Date());
    const startDate = addDays(asOfDate, -(lookbackDays - 1));
    const storageDays = options.storageDays ?? 45;
    const storageStartDate = addDays(asOfDate, -(storageDays - 1));
    options.onProgress?.(`loading signals from ${startDate} to ${asOfDate}`);
    const signals = await loadSignalsForTrendComputation(client, startDate, asOfDate);
    options.onProgress?.(`loaded ${signals.length} signals`);
    const themes = groupSignalsByTheme(signals, startDate, asOfDate);
    options.onProgress?.(`grouped ${themes.size} themes`);
    let lowHistoryRows = 0;
    const latestTrends: TrendSummary[] = [];
    const trendRows: TrendRowInput[] = [];

    for (const theme of themes.values()) {
      for (const date of enumerateDates(startDate, asOfDate)) {
        for (const trendWindow of windows) {
          const windowDays = trendWindowDays(trendWindow);
          const score = scoreTrendWindow(
            theme.buckets,
            date,
            windowDays,
            lowHistoryDays,
            theme.trendLevel
          );

          if (score.lowHistory) {
            lowHistoryRows += 1;
          }

          if (date >= storageStartDate) {
            trendRows.push({
              id: trendId(theme.themeId, trendWindow, date),
              themeId: theme.themeId,
              trendWindow,
              date,
              intensity: score.intensity,
              baselineMean: score.baselineMean,
              baselineStddev: score.baselineStddev,
              zScore: score.zScore,
              percentileRank: score.percentileRank,
              sourceMix: score.sourceMix
            });
          }

          if (date === asOfDate) {
            latestTrends.push({
              id: trendId(theme.themeId, trendWindow, date),
              themeId: theme.themeId,
              themeLabel: theme.themeLabel,
              themeDescription: "",
              parentThemeId: null,
              sector: null,
              themeLevel: theme.trendLevel,
              trendWindow,
              date,
              intensity: score.intensity,
              baselineMean: score.baselineMean,
              baselineStddev: score.baselineStddev,
              zScore: score.zScore,
              percentileRank: score.percentileRank,
              evidenceCount: score.sourceMix.evidenceCount,
              documentBreadth: score.sourceMix.documentBreadth,
              sourceMix: score.sourceMix.sources,
              sourceDiversity: score.sourceMix.sourceDiversity,
              entityBreadth: score.sourceMix.entityBreadth,
              lowHistory: score.lowHistory,
              candidate: score.sourceMix.candidate,
              affectedEntities: [],
              recentEvidence: []
            });
          }
        }
      }
    }

    options.onProgress?.(
      `upserting ${trendRows.length} trend rows for stored range ${storageStartDate} to ${asOfDate}`
    );
    await client.query("begin");
    await client.query(
      `delete from theme_trends
       where date between $1::date and $2::date`,
      [storageStartDate, asOfDate]
    );
    await insertTrendRows(client, trendRows, options.onProgress);
    await client.query("commit");
    options.onProgress?.("trend rows committed");

    return {
      themesProcessed: themes.size,
      trendRowsWritten: trendRows.length,
      lowHistoryRows,
      topTrends: latestTrends
        .sort((left, right) => right.zScore - left.zScore)
        .slice(0, 5)
        .map((trend) => ({
          themeId: trend.themeId,
          themeLabel: trend.themeLabel,
          trendWindow: trend.trendWindow,
          zScore: trend.zScore
        }))
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function getTrendStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<TrendStatus> {
  if (!databaseUrl) {
    return emptyTrendStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      total_trend_rows: string;
      latest_trend_date: string | null;
    }>(
      `select
        count(*)::text as total_trend_rows,
        max(date)::text as latest_trend_date
       from theme_trends`
    );
    const latestTrendDate = totals.rows[0]?.latest_trend_date ?? null;

    if (!latestTrendDate) {
      return {
        databaseConfigured: true,
        totalTrendRows: Number(totals.rows[0]?.total_trend_rows ?? 0),
        latestTrendDate: null,
        windows: ["7d", "30d"],
        trends: []
      };
    }

    const rows = await client.query<{
      id: string;
      theme_id: string;
      theme_label: string;
      theme_description: string | null;
      parent_theme_id: string | null;
      sector: string | null;
      trend_window: TrendWindow;
      date: string;
      intensity: number;
      baseline_mean: number;
      baseline_stddev: number;
      z_score: number;
      percentile_rank: number;
      source_mix: Record<string, unknown>;
    }>(
      `select
        tt.id,
        tt.theme_id,
        t.label as theme_label,
        t.description as theme_description,
        t.parent_theme_id,
        t.sector,
        tt.trend_window,
        tt.date::text,
        tt.intensity::float as intensity,
        tt.baseline_mean::float as baseline_mean,
        tt.baseline_stddev::float as baseline_stddev,
        tt.z_score::float as z_score,
        tt.percentile_rank::float as percentile_rank,
        tt.source_mix
       from theme_trends tt
       join themes t on t.id = tt.theme_id
       where tt.date = $1
       order by tt.z_score desc, tt.intensity desc
       limit 160`,
      [latestTrendDate]
    );

    const trends: TrendSummary[] = [];

    for (const row of rows.rows) {
      const metadata = parseTrendMetadata(row.source_mix);
      trends.push({
        id: row.id,
        themeId: row.theme_id,
        themeLabel: row.theme_label,
        themeDescription: row.theme_description ?? "",
        parentThemeId: row.parent_theme_id,
        sector: row.sector,
        themeLevel: metadata.trendLevel,
        trendWindow: row.trend_window,
        date: row.date,
        intensity: row.intensity,
        baselineMean: row.baseline_mean,
        baselineStddev: row.baseline_stddev,
        zScore: row.z_score,
        percentileRank: row.percentile_rank,
        evidenceCount: metadata.evidenceCount,
        documentBreadth: metadata.documentBreadth,
        sourceMix: metadata.sources,
        sourceDiversity: metadata.sourceDiversity,
        entityBreadth: metadata.entityBreadth,
        lowHistory: metadata.lowHistory,
        candidate: metadata.candidate,
        affectedEntities: await loadTrendAffectedEntities(
          client,
          row.theme_id,
          row.date,
          trendWindowDays(row.trend_window)
        ),
        recentEvidence: await loadTrendEvidence(
          client,
          row.theme_id,
          row.date,
          trendWindowDays(row.trend_window)
        )
      });
    }

    return {
      databaseConfigured: true,
      totalTrendRows: Number(totals.rows[0]?.total_trend_rows ?? 0),
      latestTrendDate,
      windows: ["7d", "30d"],
      trends
    };
  } catch {
    return emptyTrendStatus(true);
  } finally {
    await client.end();
  }
}

export async function getLiveDashboardStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<LiveDashboardStatus> {
  if (!databaseUrl) {
    return emptyLiveDashboardStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      total_trend_rows: string;
      latest_trend_date: string | null;
    }>(
      `select
        count(*)::text as total_trend_rows,
        max(date)::text as latest_trend_date
       from theme_trends`
    );
    const latestTrendDate = totals.rows[0]?.latest_trend_date ?? null;
    const totalTrendRows = Number(totals.rows[0]?.total_trend_rows ?? 0);

    if (!latestTrendDate) {
      return {
        ...emptyLiveDashboardStatus(true),
        totalTrendRows
      };
    }

    const sevenDayRows = await loadLatestMarketTrendRows(client, latestTrendDate, "7d", 80);
    const thirtyDayRows = await loadLatestMarketTrendRows(client, latestTrendDate, "30d", 60);
    const sevenDayMarketThemes = rankDashboardTrends(
      sevenDayRows.map(trendSummaryWithoutDetails)
    );
    const thirtyDayMarketThemes = rankDashboardTrends(
      thirtyDayRows.map(trendSummaryWithoutDetails)
    );
    const confirmedSevenDayThemes = sevenDayMarketThemes
      .filter(isConfirmedDashboardTrend)
      .slice(0, 8);
    const emergingSevenDayThemes = sevenDayMarketThemes
      .filter((trend) => !isConfirmedDashboardTrend(trend))
      .slice(0, 8);
    const confirmedThirtyDayThemes = thirtyDayMarketThemes
      .filter(isConfirmedDashboardTrend)
      .slice(0, 6);

    const themesToHydrate =
      confirmedSevenDayThemes.length > 0 ? confirmedSevenDayThemes : confirmedThirtyDayThemes;

    return {
      databaseConfigured: true,
      totalTrendRows,
      latestTrendDate,
      confirmedSevenDayThemes: await hydrateTrendSummaries(client, confirmedSevenDayThemes),
      emergingSevenDayThemes,
      confirmedThirtyDayThemes: themesToHydrate === confirmedThirtyDayThemes
        ? await hydrateTrendSummaries(client, confirmedThirtyDayThemes)
        : confirmedThirtyDayThemes
    };
  } catch {
    return emptyLiveDashboardStatus(true);
  } finally {
    await client.end();
  }
}

export async function getThemeDetailStatus(
  themeId: string,
  databaseUrl = process.env.DATABASE_URL
): Promise<ThemeDetailStatus> {
  if (!databaseUrl) {
    return emptyThemeDetailStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const themeResult = await client.query<{
      id: string;
      label: string;
      description: string;
      theme_level: string;
      sector: string | null;
    }>(
      `select id, label, description, theme_level, sector
       from themes
       where id = $1`,
      [themeId]
    );
    const theme = themeResult.rows[0];

    if (!theme) {
      return {
        ...emptyThemeDetailStatus(true),
        theme: null
      };
    }

    const latestTrendResult = await client.query<{ latest_trend_date: string | null }>(
      `select max(date)::text as latest_trend_date
       from theme_trends
       where theme_id = $1`,
      [themeId]
    );
    const latestTrendDate = latestTrendResult.rows[0]?.latest_trend_date ?? null;
    const trendRows = latestTrendDate
      ? (
          await client.query<ThemeTrendDbRow>(
          `select
            tt.id,
            tt.theme_id,
            t.label as theme_label,
            t.description as theme_description,
            t.parent_theme_id,
            t.sector,
            tt.trend_window,
            tt.date::text,
            tt.intensity::float as intensity,
            tt.baseline_mean::float as baseline_mean,
            tt.baseline_stddev::float as baseline_stddev,
            tt.z_score::float as z_score,
            tt.percentile_rank::float as percentile_rank,
            tt.source_mix
           from theme_trends tt
           join themes t on t.id = tt.theme_id
           where tt.theme_id = $1
            and tt.date = $2::date
           order by tt.trend_window`,
          [themeId, latestTrendDate]
          )
        ).rows
      : [];
    const trendSummaries = await Promise.all(
      trendRows.map((row) => themeTrendSummaryFromRow(client, row))
    );
    const history = await loadThemeTrendHistory(client, themeId);
    const affectedEntities = await loadTrendAffectedEntities(client, themeId, latestTrendDate, 30, 30);
    const citations = await loadTrendEvidence(client, themeId, latestTrendDate, 30, 12);
    const relatedSubthemes = await loadRelatedSubthemes(client, themeId);

    return {
      databaseConfigured: true,
      theme: {
        id: theme.id,
        label: theme.label,
        description: theme.description,
        themeLevel: theme.theme_level,
        sector: theme.sector
      },
      latestTrendDate,
      sevenDayTrend:
        trendSummaries.find((trend) => trend.trendWindow === "7d") ?? null,
      thirtyDayTrend:
        trendSummaries.find((trend) => trend.trendWindow === "30d") ?? null,
      trendHistory: history,
      affectedEntities,
      citations,
      relatedSubthemes,
      followUpQuestions: buildThemeFollowUpQuestions(theme.label, affectedEntities)
    };
  } catch {
    return emptyThemeDetailStatus(true);
  } finally {
    await client.end();
  }
}

export async function getIngestionStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<IngestionStatus> {
  if (!databaseUrl) {
    return emptyStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      total_documents: string;
      sec_documents: string;
      fmp_transcript_documents: string;
      latest_sec_document_at: string | null;
      latest_fmp_transcript_at: string | null;
      latest_created_at: string | null;
    }>(
      `select
        count(*)::text as total_documents,
        count(*) filter (where source_id = 'sec-filings')::text as sec_documents,
        count(*) filter (where source_id = 'fmp-transcripts')::text as fmp_transcript_documents,
        max(published_at) filter (where source_id = 'sec-filings')::text as latest_sec_document_at,
        max(published_at) filter (where source_id = 'fmp-transcripts')::text as latest_fmp_transcript_at,
        max(created_at)::text as latest_created_at
      from documents`
    );

    const sourceCounts = await client.query<{
      source_class: SourceClass;
      count: string;
    }>(
      `select source_class, count(*)::text as count
       from documents
       group by source_class
       order by source_class`
    );

    const secCategoryCounts = await client.query<{
      category: string;
      count: string;
    }>(
      `select coalesce(metadata->>'filingCategory', 'uncategorized') as category,
        count(*)::text as count
       from documents
       where source_id = 'sec-filings'
       group by category
       order by category`
    );

    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      totalDocuments: Number(row?.total_documents ?? 0),
      secDocuments: Number(row?.sec_documents ?? 0),
      fmpTranscriptDocuments: Number(row?.fmp_transcript_documents ?? 0),
      latestSecDocumentAt: row?.latest_sec_document_at ?? null,
      latestFmpTranscriptAt: row?.latest_fmp_transcript_at ?? null,
      latestCreatedAt: row?.latest_created_at ?? null,
      sourceCounts: sourceCounts.rows.map((countRow) => ({
        sourceClass: countRow.source_class,
        count: Number(countRow.count)
      })),
      secCategoryCounts: secCategoryCounts.rows.map((countRow) => ({
        category: countRow.category,
        count: Number(countRow.count)
      }))
    };
  } catch {
    return emptyStatus(true);
  } finally {
    await client.end();
  }
}

export function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function loadSignalsForTrendComputation(
  client: DbClient,
  startDate: string,
  endDate: string
) {
  const result = await client.query<SignalTrendInput>(
    `with trend_signal_rows as (
      select
        s.id,
        s.document_id,
        coalesce(s.canonical_theme_id, s.theme_id) as trend_theme_id,
        case when s.canonical_theme_id is null then 'unmapped' else 'market' end as trend_level,
        d.published_at,
        d.source_class,
        s.affected_entities,
        s.score_contribution
      from signals s
      join documents d on d.id = s.document_id
      where d.published_at::date between $1::date and $2::date
      union all
      select
        s.id,
        s.document_id,
        s.canonical_subtheme_id as trend_theme_id,
        'sector' as trend_level,
        d.published_at,
        d.source_class,
        s.affected_entities,
        s.score_contribution
      from signals s
      join documents d on d.id = s.document_id
      where s.canonical_subtheme_id is not null
        and d.published_at::date between $1::date and $2::date
    )
    select
      tsr.id as "signalId",
      tsr.document_id as "documentId",
      tsr.trend_theme_id as "themeId",
      t.label as "themeLabel",
      tsr.trend_level as "trendLevel",
      tsr.published_at::date::text as "signalDate",
      tsr.source_class as "sourceClass",
      tsr.affected_entities as "affectedEntities",
      tsr.score_contribution::float as "scoreContribution"
     from trend_signal_rows tsr
     join themes t on t.id = tsr.trend_theme_id`,
    [startDate, endDate]
  );

  return result.rows;
}

async function insertTrendRows(
  client: DbClient,
  rows: TrendRowInput[],
  onProgress?: (message: string) => void
) {
  const batchSize = Number(process.env.TREND_INSERT_BATCH_SIZE ?? 250);

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await client.query(
      `insert into theme_trends (
        id,
        theme_id,
        trend_window,
        date,
        intensity,
        baseline_mean,
        baseline_stddev,
        z_score,
        percentile_rank,
        source_mix
      )
      select * from unnest(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::date[],
        $5::numeric[],
        $6::numeric[],
        $7::numeric[],
        $8::numeric[],
        $9::numeric[],
        $10::jsonb[]
      )`,
      [
        batch.map((row) => row.id),
        batch.map((row) => row.themeId),
        batch.map((row) => row.trendWindow),
        batch.map((row) => row.date),
        batch.map((row) => row.intensity),
        batch.map((row) => row.baselineMean),
        batch.map((row) => row.baselineStddev),
        batch.map((row) => row.zScore),
        batch.map((row) => row.percentileRank),
        batch.map((row) => JSON.stringify(row.sourceMix))
      ]
    );

    onProgress?.(`inserted ${Math.min(index + batch.length, rows.length)}/${rows.length} trend rows`);
  }
}

function groupSignalsByTheme(signals: SignalTrendInput[], startDate: string, endDate: string) {
  const dates = enumerateDates(startDate, endDate);
  const themes = new Map<
    string,
    {
      themeId: string;
      themeLabel: string;
      trendLevel: "market" | "sector" | "unmapped";
      buckets: Map<string, DailyTrendBucket>;
    }
  >();

  for (const signal of signals) {
    let theme = themes.get(signal.themeId);

    if (!theme) {
      theme = {
        themeId: signal.themeId,
        themeLabel: signal.themeLabel,
        trendLevel: signal.trendLevel,
        buckets: new Map(
          dates.map((date) => [
            date,
            {
              date,
              baseIntensity: 0,
              intensity: 0,
              evidenceCount: 0,
              documentIds: new Set<string>(),
              sourceMix: {},
              sourceClasses: new Set<SourceClass>(),
              entities: new Set<string>()
            }
          ])
        )
      };
      themes.set(signal.themeId, theme);
    }

    const bucket = theme.buckets.get(signal.signalDate);

    if (!bucket) {
      continue;
    }

    bucket.baseIntensity += signal.scoreContribution;
    bucket.evidenceCount += 1;
    bucket.documentIds.add(signal.documentId);
    bucket.sourceClasses.add(signal.sourceClass);
    bucket.sourceMix[signal.sourceClass] = (bucket.sourceMix[signal.sourceClass] ?? 0) + 1;

    for (const entity of signal.affectedEntities ?? []) {
      const normalized = entity.trim();

      if (normalized) {
        bucket.entities.add(normalized);
      }
    }
  }

  for (const theme of themes.values()) {
    for (const bucket of theme.buckets.values()) {
      bucket.intensity = boostedIntensity(
        bucket.baseIntensity,
        bucket.sourceClasses.size,
        bucket.entities.size
      );
    }
  }

  return themes;
}

function scoreTrendWindow(
  buckets: Map<string, DailyTrendBucket>,
  date: string,
  windowDays: number,
  lowHistoryDays: number,
  trendLevel: "market" | "sector" | "unmapped"
) {
  const currentDates = enumerateDates(addDays(date, -(windowDays - 1)), date);
  const currentBuckets = currentDates.map((currentDate) => bucketForDate(buckets, currentDate));
  const currentSummary = summarizeBuckets(currentBuckets);
  const baselineEnd = addDays(currentDates[0], -1);
  const baselineBuckets = Array.from(buckets.values()).filter(
    (bucket) => bucket.date <= baselineEnd
  );
  const baselineValues = rollingWindowTotals(baselineBuckets, windowDays);
  const baselineMean = average(baselineValues);
  const rawStddev = standardDeviation(baselineValues, baselineMean);
  const baselineStddev = Math.max(rawStddev, 1);
  const zScore = (currentSummary.intensity - baselineMean) / baselineStddev;
  const lowHistory = baselineValues.length < lowHistoryDays;
  const percentileRank =
    baselineValues.length === 0
      ? 0
      : Math.round(
          (baselineValues.filter((value) => value <= currentSummary.intensity).length /
            baselineValues.length) *
            100
        );
  const candidate =
    !lowHistory &&
    zScore >= 1.8 &&
    percentileRank >= 90 &&
    currentSummary.evidenceCount >= 2 &&
    (currentSummary.documentBreadth >= 2 || currentSummary.entityBreadth >= 2) &&
    currentSummary.sourceDiversity >= 1;

  return {
    intensity: roundMetric(currentSummary.intensity),
    baselineMean: roundMetric(baselineMean),
    baselineStddev: roundMetric(baselineStddev),
    zScore: roundMetric(zScore),
    percentileRank,
    lowHistory,
    sourceMix: {
      sources: currentSummary.sourceMix,
      trendLevel,
      evidenceCount: currentSummary.evidenceCount,
      documentBreadth: currentSummary.documentBreadth,
      sourceDiversity: currentSummary.sourceDiversity,
      entityBreadth: currentSummary.entityBreadth,
      baseIntensity: roundMetric(currentSummary.baseIntensity),
      lowHistory,
      baselineDays: baselineValues.length,
      candidate
    }
  };
}

function summarizeBuckets(buckets: DailyTrendBucket[]) {
  const sourceMix: Partial<Record<SourceClass, number>> = {};
  const sourceClasses = new Set<SourceClass>();
  const entities = new Set<string>();
  const documentIds = new Set<string>();
  let baseIntensity = 0;
  let intensity = 0;
  let evidenceCount = 0;

  for (const bucket of buckets) {
    baseIntensity += bucket.baseIntensity;
    intensity += bucket.intensity;
    evidenceCount += bucket.evidenceCount;

    for (const documentId of bucket.documentIds) {
      documentIds.add(documentId);
    }

    for (const sourceClass of bucket.sourceClasses) {
      sourceClasses.add(sourceClass);
    }

    for (const entity of bucket.entities) {
      entities.add(entity);
    }

    for (const [sourceClass, count] of Object.entries(bucket.sourceMix)) {
      const typedSourceClass = sourceClass as SourceClass;
      sourceMix[typedSourceClass] = (sourceMix[typedSourceClass] ?? 0) + count;
    }
  }

  return {
    baseIntensity,
    intensity,
    evidenceCount,
    documentBreadth: documentIds.size,
    sourceMix,
    sourceDiversity: sourceClasses.size,
    entityBreadth: entities.size
  };
}

function rollingWindowTotals(buckets: DailyTrendBucket[], windowDays: number) {
  if (buckets.length < windowDays) {
    return buckets.length > 0 ? [summarizeBuckets(buckets).intensity] : [];
  }

  const totals: number[] = [];

  for (let index = windowDays - 1; index < buckets.length; index += 1) {
    totals.push(summarizeBuckets(buckets.slice(index - windowDays + 1, index + 1)).intensity);
  }

  return totals;
}

function boostedIntensity(baseIntensity: number, sourceDiversity: number, entityBreadth: number) {
  if (baseIntensity === 0) {
    return 0;
  }

  const sourceBoost = Math.min(Math.max(sourceDiversity - 1, 0) * 0.05, 0.15);
  const entityBoost = Math.min(Math.max(entityBreadth - 1, 0) * 0.02, 0.15);
  return baseIntensity * (1 + sourceBoost + entityBoost);
}

async function loadTrendEvidence(
  client: DbClient,
  themeId: string,
  date: string | null,
  windowDays: number,
  limit = 3
): Promise<TrendEvidenceSummary[]> {
  if (!date) {
    return [];
  }

  const result = await client.query<TrendEvidenceSummary>(
    `select
      s.id,
      d.id as "documentId",
      d.title,
      d.publisher,
      d.source_class as "sourceClass",
      d.published_at::text as "publishedAt",
      d.url,
      s.evidence_snippet as snippet,
      s.score_contribution::float as "scoreContribution"
     from signals s
     join documents d on d.id = s.document_id
     where (
        s.theme_id = $1
        or s.canonical_theme_id = $1
        or s.canonical_subtheme_id = $1
      )
      and d.published_at::date between ($2::date - ($3::integer - 1)) and $2::date
     order by s.score_contribution desc, d.published_at desc
     limit $4`,
    [themeId, date, windowDays, limit]
  );

  return result.rows;
}

async function loadTrendAffectedEntities(
  client: DbClient,
  themeId: string,
  date: string | null,
  windowDays: number,
  limit = 12
): Promise<string[]> {
  if (!date) {
    return [];
  }

  const result = await client.query<{ entity: string }>(
    `select distinct entity.entity
     from signals s
     join documents d on d.id = s.document_id
     join lateral unnest(s.affected_entities) as entity(entity) on true
     where (
        s.theme_id = $1
        or s.canonical_theme_id = $1
        or s.canonical_subtheme_id = $1
      )
      and d.published_at::date between ($2::date - ($3::integer - 1)) and $2::date
      and nullif(trim(entity.entity), '') is not null
     order by entity.entity
     limit $4`,
    [themeId, date, windowDays, limit]
  );

  return result.rows.map((row) => row.entity);
}

async function loadLatestMarketTrendRows(
  client: DbClient,
  latestTrendDate: string,
  trendWindow: TrendWindow,
  limit: number
) {
  const result = await client.query<ThemeTrendDbRow>(
    `select
      tt.id,
      tt.theme_id,
      t.label as theme_label,
      t.description as theme_description,
      t.parent_theme_id,
      t.sector,
      tt.trend_window,
      tt.date::text,
      tt.intensity::float as intensity,
      tt.baseline_mean::float as baseline_mean,
      tt.baseline_stddev::float as baseline_stddev,
      tt.z_score::float as z_score,
      tt.percentile_rank::float as percentile_rank,
      tt.source_mix
     from theme_trends tt
     join themes t on t.id = tt.theme_id
     where tt.date = $1::date
      and tt.trend_window = $2
      and coalesce(tt.source_mix->>'trendLevel', 'market') = 'market'
     order by
      tt.z_score desc,
      coalesce((tt.source_mix->>'evidenceCount')::numeric, 0) desc,
      coalesce((tt.source_mix->>'entityBreadth')::numeric, 0) desc,
      tt.intensity desc
     limit $3`,
    [latestTrendDate, trendWindow, limit]
  );

  return result.rows;
}

function trendSummaryWithoutDetails(row: ThemeTrendDbRow): TrendSummary {
  const metadata = parseTrendMetadata(row.source_mix);

  return {
    id: row.id,
    themeId: row.theme_id,
    themeLabel: row.theme_label,
    themeDescription: row.theme_description ?? "",
    parentThemeId: row.parent_theme_id,
    sector: row.sector,
    themeLevel: metadata.trendLevel,
    trendWindow: row.trend_window,
    date: row.date,
    intensity: row.intensity,
    baselineMean: row.baseline_mean,
    baselineStddev: row.baseline_stddev,
    zScore: row.z_score,
    percentileRank: row.percentile_rank,
    evidenceCount: metadata.evidenceCount,
    documentBreadth: metadata.documentBreadth,
    sourceMix: metadata.sources,
    sourceDiversity: metadata.sourceDiversity,
    entityBreadth: metadata.entityBreadth,
    lowHistory: metadata.lowHistory,
    candidate: metadata.candidate,
    affectedEntities: [],
    recentEvidence: []
  };
}

async function hydrateTrendSummaries(client: DbClient, trends: TrendSummary[]) {
  const hydrated: TrendSummary[] = [];

  for (const trend of trends) {
    const windowDays = trendWindowDays(trend.trendWindow);
    hydrated.push({
      ...trend,
      affectedEntities: await loadTrendAffectedEntities(
        client,
        trend.themeId,
        trend.date,
        windowDays
      ),
      recentEvidence: await loadTrendEvidence(client, trend.themeId, trend.date, windowDays)
    });
  }

  return hydrated;
}

async function themeTrendSummaryFromRow(
  client: DbClient,
  row: ThemeTrendDbRow
): Promise<TrendSummary> {
  const metadata = parseTrendMetadata(row.source_mix);
  const windowDays = trendWindowDays(row.trend_window);

  return {
    id: row.id,
    themeId: row.theme_id,
    themeLabel: row.theme_label,
    themeDescription: row.theme_description ?? "",
    parentThemeId: row.parent_theme_id,
    sector: row.sector,
    themeLevel: metadata.trendLevel,
    trendWindow: row.trend_window,
    date: row.date,
    intensity: row.intensity,
    baselineMean: row.baseline_mean,
    baselineStddev: row.baseline_stddev,
    zScore: row.z_score,
    percentileRank: row.percentile_rank,
    evidenceCount: metadata.evidenceCount,
    documentBreadth: metadata.documentBreadth,
    sourceMix: metadata.sources,
    sourceDiversity: metadata.sourceDiversity,
    entityBreadth: metadata.entityBreadth,
    lowHistory: metadata.lowHistory,
    candidate: metadata.candidate,
    affectedEntities: await loadTrendAffectedEntities(client, row.theme_id, row.date, windowDays),
    recentEvidence: await loadTrendEvidence(client, row.theme_id, row.date, windowDays)
  };
}

async function loadThemeTrendHistory(
  client: DbClient,
  themeId: string
): Promise<ThemeTrendPoint[]> {
  const result = await client.query<ThemeTrendPoint>(
    `select
      date::text,
      intensity::float as intensity,
      baseline_mean::float as "baselineMean",
      z_score::float as "zScore"
     from theme_trends
     where theme_id = $1
      and trend_window = '7d'
     order by date desc
     limit 30`,
    [themeId]
  );

  return result.rows.reverse();
}

async function loadRelatedSubthemes(client: DbClient, themeId: string) {
  const result = await client.query<{
    id: string;
    label: string;
    description: string;
    sector: string | null;
  }>(
    `select id, label, description, sector
     from themes
     where parent_theme_id = $1
     order by sector nulls last, label
     limit 12`,
    [themeId]
  );

  return result.rows;
}

function buildThemeFollowUpQuestions(themeLabel: string, affectedEntities: string[]) {
  const entityPrompt =
    affectedEntities.length > 0
      ? `Which of ${affectedEntities.slice(0, 4).join(", ")} is most exposed to this narrative?`
      : "Which companies have the clearest exposure to this narrative?";

  return [
    `Is ${themeLabel} broadening across more companies or still concentrated?`,
    entityPrompt,
    "What would confirm this theme is accelerating rather than just appearing in one earnings cycle?",
    "Which source types are missing from the evidence set?"
  ];
}

function parseTrendMetadata(metadata: Record<string, unknown>) {
  const sources =
    isRecord(metadata.sources) ? (metadata.sources as Partial<Record<SourceClass, number>>) : {};
  const trendLevel: "market" | "sector" | "unmapped" =
    metadata.trendLevel === "sector" || metadata.trendLevel === "unmapped"
      ? metadata.trendLevel
      : "market";

  return {
    sources,
    trendLevel,
    evidenceCount: numberFromMetadata(metadata.evidenceCount),
    documentBreadth: numberFromMetadata(metadata.documentBreadth),
    sourceDiversity: numberFromMetadata(metadata.sourceDiversity),
    entityBreadth: numberFromMetadata(metadata.entityBreadth),
    lowHistory: metadata.lowHistory === true,
    candidate: metadata.candidate === true
  };
}

function rankDashboardTrends(trends: TrendSummary[]) {
  return [...trends].sort((left, right) => dashboardTrendScore(right) - dashboardTrendScore(left));
}

function dashboardTrendScore(trend: TrendSummary) {
  return (
    trend.zScore * 4 +
    Math.log1p(trend.evidenceCount) +
    Math.log1p(trend.entityBreadth) +
    Math.log1p(trend.sourceDiversity) -
    (trend.lowHistory ? 1 : 0)
  );
}

function isConfirmedDashboardTrend(trend: TrendSummary) {
  return trend.entityBreadth >= 2 || independentDocumentCount(trend) >= 2;
}

function independentDocumentCount(trend: TrendSummary) {
  return trend.documentBreadth > 0 ? trend.documentBreadth : trend.evidenceCount;
}

function trendWindowDays(window: TrendWindow) {
  return window === "30d" ? 30 : 7;
}

function trendId(themeId: string, trendWindow: TrendWindow, date: string) {
  return `trend:${hashContent(`${themeId}:${trendWindow}:${date}`).slice(0, 24)}`;
}

function bucketForDate(buckets: Map<string, DailyTrendBucket>, date: string): DailyTrendBucket {
  return (
    buckets.get(date) ?? {
      date,
      baseIntensity: 0,
      intensity: 0,
      evidenceCount: 0,
      documentIds: new Set<string>(),
      sourceMix: {},
      sourceClasses: new Set<SourceClass>(),
      entities: new Set<string>()
    }
  );
}

function enumerateDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = parseDate(startDate);
  const end = parseDate(endDate);

  while (cursor <= end) {
    dates.push(normalizeDate(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() + 1));
  }

  return dates;
}

function addDays(date: string, days: number) {
  const parsed = parseDate(date);
  return normalizeDate(
    new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate() + days))
  );
}

function normalizeDate(value: string | Date) {
  const date = typeof value === "string" ? parseDate(value) : value;
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[], mean: number) {
  if (values.length < 2) {
    return 0;
  }

  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
}

function roundMetric(value: number) {
  return Number(value.toFixed(3));
}

function numberFromMetadata(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function upsertNormalizedTheme(
  client: DbClient,
  theme: {
    id: string;
    label: string;
    description: string;
    level: "market" | "sector";
    sector: string | null;
    parentThemeId: string | null;
    metadata: Record<string, unknown>;
  }
) {
  await client.query(
    `insert into themes (
      id,
      label,
      description,
      parent_theme_id,
      theme_level,
      sector,
      metadata,
      status
    ) values ($1, $2, $3, $4, $5, $6, $7, 'emerging')
    on conflict (id) do update set
      label = excluded.label,
      description = excluded.description,
      parent_theme_id = excluded.parent_theme_id,
      theme_level = excluded.theme_level,
      sector = excluded.sector,
      metadata = excluded.metadata`,
    [
      theme.id,
      theme.label,
      theme.description,
      theme.parentThemeId,
      theme.level,
      theme.sector,
      JSON.stringify(theme.metadata)
    ]
  );
}

async function upsertDocumentText(
  client: DbClient,
  documentId: string,
  text: string,
  textSource: "ingestion" | "reconstructed_chunks"
) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return;
  }

  await client.query(
    `insert into document_texts (
      document_id,
      content,
      content_hash,
      retention_policy,
      text_source,
      updated_at
    ) values ($1, $2, $3, 'full_text', $4, now())
    on conflict (document_id) do update set
      content = excluded.content,
      content_hash = excluded.content_hash,
      text_source = case
        when document_texts.text_source = 'ingestion' then document_texts.text_source
        else excluded.text_source
      end,
      updated_at = now()`,
    [documentId, normalized, hashContent(normalized), textSource]
  );
}

function analysisRunId(
  documentId: string,
  analysisType: string,
  model: string,
  promptVersion: string
) {
  return `analysis:${hashContent(`${documentId}:${analysisType}:${model}:${promptVersion}`).slice(0, 24)}`;
}

async function resolveDocumentId(
  client: DbClient,
  preferredId: string,
  contentHash: string
) {
  const existing = await client.query<{ id: string; content_hash: string }>(
    `select id, content_hash
     from documents
     where id = $1 or content_hash = $2
     limit 1`,
    [preferredId, contentHash]
  );

  const row = existing.rows[0];

  if (!row) {
    return preferredId;
  }

  if (row.content_hash === contentHash) {
    return null;
  }

  return `${preferredId}:rev:${contentHash.slice(0, 8)}`;
}

const backfillJobSelectColumns = `
  id,
  job_type,
  status,
  batch_size,
  max_batches,
  concurrency,
  document_timeout_ms,
  stale_after_minutes,
  selected_documents,
  completed_documents,
  failed_documents,
  inserted_signals,
  themes_touched,
  current_document_ids,
  last_message,
  last_error,
  stop_requested_at::text,
  started_at::text,
  completed_at::text,
  created_at::text,
  updated_at::text
`;

const claimableBackfillJobSelectColumns = `
  ${backfillJobSelectColumns},
  lookback_days,
  excluded_sec_filing_categories,
  model,
  prompt_version
`;

const claimableBackfillJobReturnColumns = `
  bj.id,
  bj.job_type,
  bj.status,
  bj.batch_size,
  bj.max_batches,
  bj.concurrency,
  bj.document_timeout_ms,
  bj.stale_after_minutes,
  bj.selected_documents,
  bj.completed_documents,
  bj.failed_documents,
  bj.inserted_signals,
  bj.themes_touched,
  bj.current_document_ids,
  bj.last_message,
  bj.last_error,
  bj.stop_requested_at::text as stop_requested_at,
  bj.started_at::text as started_at,
  bj.completed_at::text as completed_at,
  bj.created_at::text as created_at,
  bj.updated_at::text as updated_at,
  bj.lookback_days,
  bj.excluded_sec_filing_categories,
  bj.model,
  bj.prompt_version
`;

async function ensureBackfillJobsSchema(client: DbClient) {
  await client.query(
    `create table if not exists backfill_jobs (
      id text primary key,
      job_type text not null,
      status text not null,
      batch_size integer not null,
      max_batches integer not null,
      concurrency integer not null,
      document_timeout_ms integer not null,
      stale_after_minutes integer not null default 90,
      lookback_days integer,
      excluded_sec_filing_categories text[] not null default '{}',
      model text not null,
      prompt_version text not null,
      selected_documents integer not null default 0,
      completed_documents integer not null default 0,
      failed_documents integer not null default 0,
      inserted_signals integer not null default 0,
      themes_touched integer not null default 0,
      current_document_ids text[] not null default '{}',
      worker_id text,
      last_message text,
      last_error text,
      stop_requested_at timestamptz,
      started_at timestamptz,
      completed_at timestamptz,
      metadata jsonb not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`
  );
  await client.query(
    `create unique index if not exists backfill_jobs_active_job_idx
      on backfill_jobs (job_type)
      where status in ('queued', 'running', 'stop_requested')`
  );
}

function rowToBackfillJob(row: BackfillJobRow): BackfillJobSummary {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    batchSize: row.batch_size,
    maxBatches: row.max_batches,
    concurrency: row.concurrency,
    documentTimeoutMs: row.document_timeout_ms,
    staleAfterMinutes: row.stale_after_minutes,
    selectedDocuments: row.selected_documents,
    completedDocuments: row.completed_documents,
    failedDocuments: row.failed_documents,
    insertedSignals: row.inserted_signals,
    themesTouched: row.themes_touched,
    currentDocumentIds: row.current_document_ids ?? [],
    lastMessage: row.last_message,
    lastError: row.last_error,
    stopRequestedAt: row.stop_requested_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToBackfillJobRunConfig(row: ClaimableBackfillJobRow): BackfillJobRunConfig {
  return {
    ...rowToBackfillJob(row),
    lookbackDays: row.lookback_days,
    excludedSecFilingCategories: row.excluded_sec_filing_categories ?? [],
    model: row.model,
    promptVersion: row.prompt_version
  };
}

function emptyBackfillControlStatus(): BackfillControlStatus {
  return {
    activeJob: null,
    recentJobs: []
  };
}

function emptyStatus(databaseConfigured: boolean): IngestionStatus {
  return {
    databaseConfigured,
    totalDocuments: 0,
    secDocuments: 0,
    fmpTranscriptDocuments: 0,
    latestSecDocumentAt: null,
    latestFmpTranscriptAt: null,
    latestCreatedAt: null,
    sourceCounts: [],
    secCategoryCounts: []
  };
}

async function upsertSource(client: DbClient, document: PersistableDocument) {
  await client.query(
    `insert into sources (
      id,
      name,
      source_class,
      access_method,
      terms_notes,
      enabled
    ) values ($1, $2, $3, $4, $5, true)
    on conflict (id) do update set
      name = excluded.name,
      source_class = excluded.source_class,
      access_method = excluded.access_method,
      terms_notes = excluded.terms_notes,
      enabled = true`,
    [
      document.sourceId,
      sourceName(document.sourceId),
      document.sourceClass,
      document.retrievalMethod,
      document.sourceId === "sec-filings"
        ? "Official SEC endpoints and filing document downloads."
        : document.sourceId === "fmp-transcripts"
          ? "Financial Modeling Prep earnings call transcript API."
        : null
    ]
  );
}

function sourceName(sourceId: string) {
  if (sourceId === "sec-filings") {
    return "SEC Filings";
  }

  if (sourceId === "fmp-transcripts") {
    return "FMP Transcripts";
  }

  return sourceId;
}

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
) {
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + chunkSize, normalized.length);
    chunks.push(normalized.slice(cursor, end));

    if (end === normalized.length) {
      break;
    }

    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}

function normalizeText(text: string) {
  return text.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function emptyAnalysisStatus(databaseConfigured: boolean): AnalysisStatus {
  return {
    databaseConfigured,
    signalCount: 0,
    themeCount: 0,
    completedRuns: 0,
    failedRuns: 0,
    eligibleDocumentCount: 0,
    completedDocumentCount: 0,
    unreadDocumentCount: 0,
    runningDocumentCount: 0,
    failedDocumentCount: 0,
    backfillControl: emptyBackfillControlStatus(),
    recentSignals: [],
    recentRuns: []
  };
}

function emptyTrendStatus(databaseConfigured: boolean): TrendStatus {
  return {
    databaseConfigured,
    totalTrendRows: 0,
    latestTrendDate: null,
    windows: ["7d", "30d"],
    trends: []
  };
}

function emptyLiveDashboardStatus(databaseConfigured: boolean): LiveDashboardStatus {
  return {
    databaseConfigured,
    totalTrendRows: 0,
    latestTrendDate: null,
    confirmedSevenDayThemes: [],
    emergingSevenDayThemes: [],
    confirmedThirtyDayThemes: []
  };
}

function emptyThemeDetailStatus(databaseConfigured: boolean): ThemeDetailStatus {
  return {
    databaseConfigured,
    theme: null,
    latestTrendDate: null,
    sevenDayTrend: null,
    thirtyDayTrend: null,
    trendHistory: [],
    affectedEntities: [],
    citations: [],
    relatedSubthemes: [],
    followUpQuestions: []
  };
}

function emptyThemeMappingStatus(databaseConfigured: boolean): ThemeMappingStatus {
  return {
    databaseConfigured,
    mappingCount: 0,
    mappedSignalCount: 0,
    unmappedSignalCount: 0,
    mappings: []
  };
}
