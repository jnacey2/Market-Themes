import { createHash } from "node:crypto";
import pg from "pg";
import type {
  AnalysisDocument,
  AnalysisRunStatus,
  AnalysisRunSummary,
  AnalysisSignalSummary,
  AnalysisStatus,
  ExtractedSignalInput,
  IngestionStatus,
  PersistableDocument,
  PersistDocumentsResult,
  RecomputeThemeTrendsResult,
  SourceClass,
  TrendEvidenceSummary,
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
  windows?: TrendWindow[];
  onProgress?: (message: string) => void;
};

type SignalTrendInput = {
  signalId: string;
  themeId: string;
  themeLabel: string;
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

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined
  });
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
      `select
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
        coalesce(
          dt.content,
          string_agg(dc.content, E'\n\n' order by dc.chunk_index)
        ) as content
       from documents d
       left join document_texts dt on dt.document_id = d.id
       left join document_chunks dc on dc.document_id = d.id
       left join document_analysis_runs ar
        on ar.document_id = d.id
        and ar.analysis_type = $1
        and ar.model = $2
        and ar.prompt_version = $3
       where d.source_id in ('sec-filings', 'fmp-transcripts')
        and ($4::integer is null or d.published_at >= now() - ($4::text || ' days')::interval)
        and not (
          d.source_id = 'sec-filings'
          and coalesce(d.metadata->>'filingCategory', 'uncategorized') = any($6::text[])
        )
        and coalesce(ar.status, '') not in ('completed', 'running')
        and coalesce(ar.attempt_count, 0) < 2
       group by d.id, dt.content, ar.status, ar.attempt_count
       having coalesce(
          dt.content,
          string_agg(dc.content, E'\n\n' order by dc.chunk_index)
        ) is not null
       order by
        case
          when d.source_id = 'fmp-transcripts' then 0
          when coalesce(d.metadata->>'filingCategory', '') in ('core', 'exhibit') then 1
          else 2
        end,
        d.published_at desc,
        d.created_at desc
       limit $5`,
      [
        options.analysisType,
        options.model,
        options.promptVersion,
        lookbackDays,
        limit,
        excludedSecFilingCategories
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
    const totals = await client.query<{
      signal_count: string;
      theme_count: string;
      completed_runs: string;
      failed_runs: string;
    }>(
      `select
        (select count(*)::text from signals) as signal_count,
        (select count(*)::text from themes) as theme_count,
        (select count(*)::text from document_analysis_runs where status = 'completed') as completed_runs,
        (select count(*)::text from document_analysis_runs where status = 'failed') as failed_runs`
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
          const score = scoreTrendWindow(theme.buckets, date, windowDays, lowHistoryDays);

          if (score.lowHistory) {
            lowHistoryRows += 1;
          }

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

          if (date === asOfDate) {
            latestTrends.push({
              id: trendId(theme.themeId, trendWindow, date),
              themeId: theme.themeId,
              themeLabel: theme.themeLabel,
              trendWindow,
              date,
              intensity: score.intensity,
              baselineMean: score.baselineMean,
              baselineStddev: score.baselineStddev,
              zScore: score.zScore,
              percentileRank: score.percentileRank,
              evidenceCount: score.sourceMix.evidenceCount,
              sourceMix: score.sourceMix.sources,
              sourceDiversity: score.sourceMix.sourceDiversity,
              entityBreadth: score.sourceMix.entityBreadth,
              lowHistory: score.lowHistory,
              candidate: score.sourceMix.candidate,
              recentEvidence: []
            });
          }
        }
      }
    }

    options.onProgress?.(`upserting ${trendRows.length} trend rows`);
    await client.query("begin");
    await upsertTrendRows(client, trendRows);
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
       limit 40`,
      [latestTrendDate]
    );

    const trends: TrendSummary[] = [];

    for (const row of rows.rows) {
      const metadata = parseTrendMetadata(row.source_mix);
      trends.push({
        id: row.id,
        themeId: row.theme_id,
        themeLabel: row.theme_label,
        trendWindow: row.trend_window,
        date: row.date,
        intensity: row.intensity,
        baselineMean: row.baseline_mean,
        baselineStddev: row.baseline_stddev,
        zScore: row.z_score,
        percentileRank: row.percentile_rank,
        evidenceCount: metadata.evidenceCount,
        sourceMix: metadata.sources,
        sourceDiversity: metadata.sourceDiversity,
        entityBreadth: metadata.entityBreadth,
        lowHistory: metadata.lowHistory,
        candidate: metadata.candidate,
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
    `select
      s.id as "signalId",
      s.theme_id as "themeId",
      t.label as "themeLabel",
      d.published_at::date::text as "signalDate",
      d.source_class as "sourceClass",
      s.affected_entities as "affectedEntities",
      s.score_contribution::float as "scoreContribution"
     from signals s
     join documents d on d.id = s.document_id
     join themes t on t.id = s.theme_id
     where d.published_at::date between $1::date and $2::date`,
    [startDate, endDate]
  );

  return result.rows;
}

async function upsertTrendRows(client: DbClient, rows: TrendRowInput[]) {
  const batchSize = 1_000;

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
      )
      on conflict (theme_id, trend_window, date) do update set
        intensity = excluded.intensity,
        baseline_mean = excluded.baseline_mean,
        baseline_stddev = excluded.baseline_stddev,
        z_score = excluded.z_score,
        percentile_rank = excluded.percentile_rank,
        source_mix = excluded.source_mix,
        created_at = now()`,
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
  }
}

function groupSignalsByTheme(signals: SignalTrendInput[], startDate: string, endDate: string) {
  const dates = enumerateDates(startDate, endDate);
  const themes = new Map<
    string,
    {
      themeId: string;
      themeLabel: string;
      buckets: Map<string, DailyTrendBucket>;
    }
  >();

  for (const signal of signals) {
    let theme = themes.get(signal.themeId);

    if (!theme) {
      theme = {
        themeId: signal.themeId,
        themeLabel: signal.themeLabel,
        buckets: new Map(
          dates.map((date) => [
            date,
            {
              date,
              baseIntensity: 0,
              intensity: 0,
              evidenceCount: 0,
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
  lowHistoryDays: number
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
      evidenceCount: currentSummary.evidenceCount,
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
  let baseIntensity = 0;
  let intensity = 0;
  let evidenceCount = 0;

  for (const bucket of buckets) {
    baseIntensity += bucket.baseIntensity;
    intensity += bucket.intensity;
    evidenceCount += bucket.evidenceCount;

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
  date: string,
  windowDays: number
): Promise<TrendEvidenceSummary[]> {
  const result = await client.query<TrendEvidenceSummary>(
    `select
      s.id,
      d.id as "documentId",
      d.title,
      d.publisher,
      d.source_class as "sourceClass",
      d.published_at::text as "publishedAt",
      s.evidence_snippet as snippet,
      s.score_contribution::float as "scoreContribution"
     from signals s
     join documents d on d.id = s.document_id
     where s.theme_id = $1
      and d.published_at::date between ($2::date - ($3::integer - 1)) and $2::date
     order by s.score_contribution desc, d.published_at desc
     limit 3`,
    [themeId, date, windowDays]
  );

  return result.rows;
}

function parseTrendMetadata(metadata: Record<string, unknown>) {
  const sources =
    isRecord(metadata.sources) ? (metadata.sources as Partial<Record<SourceClass, number>>) : {};

  return {
    sources,
    evidenceCount: numberFromMetadata(metadata.evidenceCount),
    sourceDiversity: numberFromMetadata(metadata.sourceDiversity),
    entityBreadth: numberFromMetadata(metadata.entityBreadth),
    lowHistory: metadata.lowHistory === true,
    candidate: metadata.candidate === true
  };
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
