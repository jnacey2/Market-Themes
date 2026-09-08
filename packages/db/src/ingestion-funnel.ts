import {
  closeDatabaseClient,
  createDatabaseClient,
  resolveOpsQueryTimeoutMs
} from "./persistence";
import type { SourceClass } from "./types";

/**
 * Ingestion-to-narrative funnel.
 *
 * Counts, for documents first stored inside a trailing window, how many made
 * it through each processing stage. Drop-offs between stages are where corpus
 * coverage is silently lost (metadata-only retention, extraction failures,
 * classification backlog, review bottlenecks), so the operator view shows each
 * stage as a share of what was ingested.
 */

export type IngestionFunnelStage = {
  key:
    | "ingested"
    | "with_text"
    | "extracted"
    | "with_signals"
    | "classified"
    | "matched"
    | "approved"
    | "in_candidates";
  label: string;
  count: number;
  /** Share of ingested documents, 0-1. */
  share: number;
  description: string;
};

export type IngestionFunnelSourceClassRow = {
  sourceClass: SourceClass;
  ingested: number;
  withText: number;
  extracted: number;
  classified: number;
  matched: number;
  approved: number;
};

export type IngestionFunnel = {
  databaseConfigured: boolean;
  windowDays: number;
  /** Connector-level totals from recorded poll runs inside the window. */
  polling: {
    runs: number;
    fetched: number;
    inserted: number;
    skipped: number;
    failedConnectors: number;
    /** Share of fetched documents that were deduplicated away, 0-1. */
    dedupeRate: number;
  };
  stages: IngestionFunnelStage[];
  bySourceClass: IngestionFunnelSourceClassRow[];
  candidates: Array<{ status: string; count: number }>;
};

export const DEFAULT_FUNNEL_WINDOW_DAYS = 7;

export async function getIngestionFunnel(
  options: { windowDays?: number } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<IngestionFunnel> {
  const windowDays = normalizeWindow(options.windowDays);
  if (!databaseUrl) {
    return emptyFunnel(false, windowDays);
  }

  const client = createDatabaseClient(databaseUrl, {
    queryTimeoutMs: resolveOpsQueryTimeoutMs(),
    statementTimeoutMs: resolveOpsQueryTimeoutMs()
  });
  try {
    await client.connect();

    // One pass over the window: per-document stage flags are computed once and
    // grouped by source class with a rollup row for the totals, instead of
    // running the same seven correlated probes twice (totals and per class).
    const staged = await client.query<{
      source_class: SourceClass | null;
      ingested: string;
      with_text: string;
      extracted: string;
      with_signals: string;
      classified: string;
      matched: string;
      approved: string;
      in_candidates: string;
    }>(
      `with recent as (
         select d.id, d.source_class,
                exists (
                  select 1 from document_texts dt
                  where dt.document_id = d.id
                    and coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
                ) as with_text,
                exists (
                  select 1 from document_analysis_runs r
                  where r.document_id = d.id
                    and r.analysis_type = 'market_signal_extraction'
                    and r.status = 'completed'
                ) as extracted,
                exists (select 1 from signals s where s.document_id = d.id) as with_signals,
                exists (
                  select 1 from narrative_observations no where no.document_id = d.id
                ) as classified,
                exists (
                  select 1 from narrative_observations no
                  where no.document_id = d.id and no.matched
                    and no.review_status <> 'rejected'
                ) as matched,
                exists (
                  select 1 from narrative_observations no
                  where no.document_id = d.id and no.matched
                    and no.review_status = 'approved'
                ) as approved,
                exists (
                  select 1 from narrative_candidate_evidence ce
                  where ce.document_id = d.id
                ) as in_candidates
         from documents d
         where d.created_at >= now() - ($1::int * interval '1 day')
       )
       select source_class,
              count(*)::text as ingested,
              count(*) filter (where with_text)::text as with_text,
              count(*) filter (where extracted)::text as extracted,
              count(*) filter (where with_signals)::text as with_signals,
              count(*) filter (where classified)::text as classified,
              count(*) filter (where matched)::text as matched,
              count(*) filter (where approved)::text as approved,
              count(*) filter (where in_candidates)::text as in_candidates
       from recent
       group by rollup (source_class)
       order by grouping(source_class) desc, count(*) desc, source_class`,
      [windowDays]
    );
    const totals = staged.rows.find((entry) => entry.source_class === null);
    const perClass = staged.rows.filter(
      (entry): entry is typeof entry & { source_class: SourceClass } =>
        entry.source_class !== null
    );

    const polling = await client.query<{
      runs: string;
      fetched: string;
      inserted: string;
      skipped: string;
      failed_connectors: string;
    }>(
      `select count(*)::text as runs,
              coalesce(sum((metadata->>'fetched')::numeric), 0)::text as fetched,
              coalesce(sum((metadata->>'inserted')::numeric), 0)::text as inserted,
              coalesce(sum((metadata->>'skipped')::numeric), 0)::text as skipped,
              coalesce(sum((metadata->>'failed')::numeric), 0)::text as failed_connectors
       from pipeline_runs
       where stage = 'poll_sources'
         and started_at >= now() - ($1::int * interval '1 day')
         and status = 'completed'`,
      [windowDays]
    );

    const candidates = await client.query<{ status: string; count: string }>(
      `select status, count(*)::text as count
       from narrative_candidates
       where created_at >= now() - ($1::int * interval '1 day')
       group by status
       order by count(*) desc, status`,
      [windowDays]
    );

    const row = totals;
    const poll = polling.rows[0];
    const fetched = Number(poll?.fetched ?? 0);
    const skipped = Number(poll?.skipped ?? 0);

    return {
      databaseConfigured: true,
      windowDays,
      polling: {
        runs: Number(poll?.runs ?? 0),
        fetched,
        inserted: Number(poll?.inserted ?? 0),
        skipped,
        failedConnectors: Number(poll?.failed_connectors ?? 0),
        dedupeRate: fetched > 0 ? round(skipped / fetched) : 0
      },
      stages: buildStages({
        ingested: Number(row?.ingested ?? 0),
        with_text: Number(row?.with_text ?? 0),
        extracted: Number(row?.extracted ?? 0),
        with_signals: Number(row?.with_signals ?? 0),
        classified: Number(row?.classified ?? 0),
        matched: Number(row?.matched ?? 0),
        approved: Number(row?.approved ?? 0),
        in_candidates: Number(row?.in_candidates ?? 0)
      }),
      bySourceClass: perClass.map((classRow) => ({
        sourceClass: classRow.source_class,
        ingested: Number(classRow.ingested),
        withText: Number(classRow.with_text),
        extracted: Number(classRow.extracted),
        classified: Number(classRow.classified),
        matched: Number(classRow.matched),
        approved: Number(classRow.approved)
      })),
      candidates: candidates.rows.map((candidate) => ({
        status: candidate.status,
        count: Number(candidate.count)
      }))
    };
  } catch (error) {
    console.warn(
      `[db] ingestion funnel query failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return emptyFunnel(true, windowDays);
  } finally {
    await closeDatabaseClient(client);
  }
}

export function buildStages(counts: Record<IngestionFunnelStage["key"], number>): IngestionFunnelStage[] {
  const ingested = counts.ingested;
  const share = (count: number) => (ingested > 0 ? round(count / ingested) : 0);
  return [
    {
      key: "ingested",
      label: "Ingested",
      count: counts.ingested,
      share: ingested > 0 ? 1 : 0,
      description: "New documents stored after deduplication."
    },
    {
      key: "with_text",
      label: "Analyzable text",
      count: counts.with_text,
      share: share(counts.with_text),
      description: "Full text or snippet retained; metadata-only documents cannot be analyzed."
    },
    {
      key: "extracted",
      label: "Signals extracted",
      count: counts.extracted,
      share: share(counts.extracted),
      description: "Completed a Claude signal-extraction run."
    },
    {
      key: "with_signals",
      label: "Produced signals",
      count: counts.with_signals,
      share: share(counts.with_signals),
      description: "At least one extracted theme signal."
    },
    {
      key: "classified",
      label: "Classified",
      count: counts.classified,
      share: share(counts.classified),
      description: "Checked against every tracked narrative definition."
    },
    {
      key: "matched",
      label: "Matched a narrative",
      count: counts.matched,
      share: share(counts.matched),
      description: "Non-rejected match to at least one tracked narrative (raw attention)."
    },
    {
      key: "approved",
      label: "Approved evidence",
      count: counts.approved,
      share: share(counts.approved),
      description: "Reviewed and approved; counts toward reviewed density."
    },
    {
      key: "in_candidates",
      label: "Cited by candidates",
      count: counts.in_candidates,
      share: share(counts.in_candidates),
      description: "Used as evidence for a discovered candidate narrative."
    }
  ];
}

function normalizeWindow(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_FUNNEL_WINDOW_DAYS;
  }
  return Math.min(90, Math.floor(value));
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

function emptyFunnel(databaseConfigured: boolean, windowDays: number): IngestionFunnel {
  return {
    databaseConfigured,
    windowDays,
    polling: {
      runs: 0,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      failedConnectors: 0,
      dedupeRate: 0
    },
    stages: buildStages({
      ingested: 0,
      with_text: 0,
      extracted: 0,
      with_signals: 0,
      classified: 0,
      matched: 0,
      approved: 0,
      in_candidates: 0
    }),
    bySourceClass: [],
    candidates: []
  };
}
