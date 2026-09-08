import { createDatabaseClient } from "./persistence";
import {
  calculateNarrativeTrendSeries,
  narrativeMetricVersion,
  type NarrativeMetricPoint,
  type NarrativeQuality,
  type NarrativeMetricObservation
} from "./narrative-metrics";
import type {
  AnalysisDocument,
  NarrativeBoardStatus,
  NarrativeDefinition,
  NarrativeObservationInput,
  NarrativeReviewQueue,
  NarrativeReviewStatus,
  NarrativeTrendSummary,
  TrendWindow
} from "./types";

export async function getActiveNarrativeDefinitions(
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeDefinition[]> {
  if (!databaseUrl) return [];
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      id: string;
      slug: string;
      version: number;
      name: string;
      proposition: string;
      category: string;
      inclusion_guidance: string;
      exclusion_guidance: string;
      positive_examples: string[];
      negative_examples: string[];
      status: string;
    }>(
      `select id, slug, version, name, proposition, category,
              inclusion_guidance, exclusion_guidance,
              positive_examples, negative_examples, status
       from narrative_definitions
       where status = 'active'
       order by category, name`
    );
    return result.rows.map(mapDefinition);
  } finally {
    await client.end();
  }
}

export async function selectDocumentsForNarrativeClassification(
  options: {
    model: string;
    promptVersion: string;
    limit: number;
    oldestFirst?: boolean;
  },
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      id: string;
      source_id: string;
      source_class: AnalysisDocument["sourceClass"];
      title: string;
      publisher: string;
      url: string;
      published_at: string;
      tickers: string[];
      summary: string;
      metadata: Record<string, unknown>;
      content: string;
      text_hash: string;
    }>(
      `select d.id, d.source_id, d.source_class, d.title, d.publisher, d.url,
              d.published_at::text, d.tickers, d.summary, d.metadata,
              dt.content, dt.content_hash as text_hash
       from documents d
       join document_texts dt on dt.document_id = d.id
       left join narrative_classification_jobs cj on cj.document_id = d.id and cj.model = $1 and cj.prompt_version = $2
       where (cj.document_id is null or (
         (cj.status <> 'running' or cj.lease_until < now()) and
         (cj.status = 'completed' or cj.text_hash <> dt.content_hash or (cj.attempts < 5 and coalesce(cj.retry_at, now()) <= now()))))
         and coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
         and exists (
           select 1
           from narrative_definitions nd
           where nd.status = 'active'
             and not exists (
               select 1
               from narrative_observations no
               where no.narrative_definition_id = nd.id
                 and no.document_id = d.id
                 and no.model = $1
                 and no.prompt_version = $2
                 and no.metadata->>'textHash' = dt.content_hash
                 and no.metadata->>'definitionVersion' = nd.version::text
             )
         )
       order by coalesce(cj.attempts, 0),
         case when $4::boolean then d.published_at end asc, d.published_at desc
       limit $3`,
      [
        options.model,
        options.promptVersion,
        options.limit,
        options.oldestFirst ?? false
      ]
    );

    return result.rows.map((row) => ({
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
      text: row.content,
      textHash: row.text_hash
    }));
  } finally {
    await client.end();
  }
}

export async function persistNarrativeObservations(
  observations: NarrativeObservationInput[],
  databaseUrl = process.env.DATABASE_URL,
  leaseId?: string
) {
  if (observations.length === 0) return { inserted: 0 };
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    if (leaseId) {
      const lease = await client.query(
        "select 1 from narrative_classification_jobs where lease_id = $1 and status = 'running' and lease_until > now() for update",
        [leaseId]
      );
      if (!lease.rowCount)
        throw new Error(
          "Classification lease expired; results were not saved."
        );
    }
    let inserted = 0;
    for (const observation of observations) {
      const result = await client.query(
        `with prior_review as (
           select review_status, reviewed_at, review_note
           from narrative_observations
           where $4::boolean
             and narrative_definition_id = $2
             and document_id = $3
             and evidence_snippet = $9
             and metadata->>'definitionVersion' is not distinct from $14::jsonb->>'definitionVersion'
             and metadata->>'textHash' is not distinct from $14::jsonb->>'textHash'
             and review_status in ('approved', 'rejected')
           order by reviewed_at desc
           limit 1
         )
         insert into narrative_observations (
           id, narrative_definition_id, document_id, matched, match_score,
           stance, risk_tone, bullish_tone, evidence_snippet, interpretation,
           affected_entities, model, prompt_version, metadata,
           review_status, reviewed_at, review_note
         )
         select
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb,
           coalesce((select review_status from prior_review), 'pending'),
           (select reviewed_at from prior_review),
           (select review_note from prior_review)
         on conflict (narrative_definition_id, document_id, model, prompt_version)
         do update set
           matched = excluded.matched,
           match_score = excluded.match_score,
           stance = excluded.stance,
           risk_tone = excluded.risk_tone,
           bullish_tone = excluded.bullish_tone,
           evidence_snippet = excluded.evidence_snippet,
           interpretation = excluded.interpretation,
           affected_entities = excluded.affected_entities,
           metadata = excluded.metadata,
           observed_at = now(),
           review_status = case
             when narrative_observations.review_status <> 'pending' and narrative_observations.evidence_snippet = excluded.evidence_snippet
               and narrative_observations.matched = excluded.matched
               and narrative_observations.metadata->>'definitionVersion' is not distinct from excluded.metadata->>'definitionVersion'
               and narrative_observations.metadata->>'textHash' is not distinct from excluded.metadata->>'textHash'
               then narrative_observations.review_status
             else excluded.review_status
           end,
           reviewed_at = case
             when narrative_observations.review_status <> 'pending' and narrative_observations.evidence_snippet = excluded.evidence_snippet
               and narrative_observations.matched = excluded.matched
               and narrative_observations.metadata->>'definitionVersion' is not distinct from excluded.metadata->>'definitionVersion'
               and narrative_observations.metadata->>'textHash' is not distinct from excluded.metadata->>'textHash'
               then narrative_observations.reviewed_at
             else excluded.reviewed_at
           end,
           review_note = case
             when narrative_observations.review_status <> 'pending' and narrative_observations.evidence_snippet = excluded.evidence_snippet
               and narrative_observations.matched = excluded.matched
               and narrative_observations.metadata->>'definitionVersion' is not distinct from excluded.metadata->>'definitionVersion'
               and narrative_observations.metadata->>'textHash' is not distinct from excluded.metadata->>'textHash'
               then narrative_observations.review_note
             else excluded.review_note
           end`,
        [
          observation.id,
          observation.narrativeDefinitionId,
          observation.documentId,
          observation.matched,
          observation.matchScore,
          observation.stance,
          observation.riskTone,
          observation.bullishTone,
          observation.evidenceSnippet,
          observation.interpretation,
          observation.affectedEntities,
          observation.model,
          observation.promptVersion,
          JSON.stringify(observation.metadata ?? {})
        ]
      );
      inserted += result.rowCount ?? 0;
    }
    if (leaseId)
      await client.query(
        "update narrative_classification_jobs set status = 'completed', updated_at = now() where lease_id = $1",
        [leaseId]
      );
    await client.query("commit");
    return { inserted };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function reviewNarrativeObservation(
  input: {
    id: string;
    status: Exclude<NarrativeReviewStatus, "pending">;
    note?: string;
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const result = await client.query<{
      id: string;
      review_status: NarrativeReviewStatus;
      reviewed_at: string;
    }>(
      `update narrative_observations
       set review_status = $2,
           review_note = nullif($3, ''),
           reviewed_at = now()
       where id = $1 and matched
       returning id, review_status, reviewed_at::text`,
      [input.id, input.status, input.note?.trim() ?? ""]
    );
    if (!result.rows[0]) {
      throw new Error("Matched narrative observation not found.");
    }
    await client.query(
      `insert into narrative_review_events (observation_id, status, note, evidence_snippet)
      select id, review_status, review_note, evidence_snippet from narrative_observations where id = $1`,
      [input.id]
    );
    await client.query("commit");
    return {
      id: result.rows[0].id,
      reviewStatus: result.rows[0].review_status,
      reviewedAt: result.rows[0].reviewed_at
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getNarrativeReviewQueue(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION,
  options: { status?: string; query?: string; page?: number } = {}
): Promise<NarrativeReviewQueue> {
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v6";
  if (!databaseUrl) {
    return {
      databaseConfigured: false,
      promptVersion,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      items: []
    };
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const counts = await client.query<{
      review_status: NarrativeReviewStatus;
      count: string;
    }>(
      `select no.review_status, count(*)::text as count
         from narrative_observations no
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         join narrative_definitions nd on nd.id = no.narrative_definition_id
         where no.matched and no.prompt_version = $1
           and no.metadata->>'textHash' = dt.content_hash
           and no.metadata->>'definitionVersion' = nd.version::text
           and nd.status = 'active' and d.retention_policy <> 'metadata_only'
         group by no.review_status`,
      [promptVersion]
    );
    const items = await client.query<{
      id: string;
      narrative_definition_id: string;
      narrative_name: string;
      proposition: string;
      inclusion_guidance: string;
      exclusion_guidance: string;
      title: string;
      publisher: string;
      published_at: string;
      url: string;
      source_class: NarrativeReviewQueue["items"][number]["sourceClass"];
      stance: NarrativeReviewQueue["items"][number]["stance"];
      evidence_snippet: string;
      interpretation: string;
      affected_entities: string[];
      match_score: number;
      prompt_version: string;
      review_status: NarrativeReviewStatus;
      review_note: string | null;
      reviewed_at: string | null;
    }>(
      `select no.id, no.narrative_definition_id, nd.name as narrative_name,
                nd.proposition, nd.inclusion_guidance, nd.exclusion_guidance,
                d.title, d.publisher, d.published_at::text, d.url, d.source_class,
                no.stance, no.evidence_snippet, no.interpretation,
                no.affected_entities, no.match_score::float, no.prompt_version,
                no.review_status, no.review_note, no.reviewed_at::text
         from narrative_observations no
         join narrative_definitions nd on nd.id = no.narrative_definition_id
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         where no.metadata->>'textHash' = dt.content_hash
           and no.matched and no.prompt_version = $1
           and no.metadata->>'definitionVersion' = nd.version::text
           and nd.status = 'active' and d.retention_policy <> 'metadata_only'
           and ($2::text is null or no.review_status = $2)
           and ($3::text is null or concat_ws(' ', d.title, d.publisher, nd.name) ilike '%' || $3 || '%')
         order by
           case no.review_status when 'pending' then 0 when 'approved' then 1 else 2 end,
           d.published_at desc,
           no.match_score desc, no.id
         limit 51 offset $4`,
      [
        promptVersion,
        options.status === "all" ? null : (options.status ?? "pending"),
        options.query?.trim() || null,
        Math.max(0, Math.floor(options.page ?? 0)) * 50
      ]
    );
    const countFor = (status: NarrativeReviewStatus) =>
      Number(
        counts.rows.find((row) => row.review_status === status)?.count ?? 0
      );

    return {
      databaseConfigured: true,
      promptVersion,
      pendingCount: countFor("pending"),
      approvedCount: countFor("approved"),
      rejectedCount: countFor("rejected"),
      hasMore: items.rows.length > 50,
      items: items.rows.slice(0, 50).map((row) => ({
        id: row.id,
        narrativeDefinitionId: row.narrative_definition_id,
        narrativeName: row.narrative_name,
        proposition: row.proposition,
        inclusionGuidance: row.inclusion_guidance,
        exclusionGuidance: row.exclusion_guidance,
        title: row.title,
        publisher: row.publisher,
        publishedAt: row.published_at,
        url: row.url,
        sourceClass: row.source_class,
        stance: row.stance,
        evidenceSnippet: row.evidence_snippet,
        interpretation: row.interpretation,
        affectedEntities: row.affected_entities,
        matchScore: row.match_score,
        promptVersion: row.prompt_version,
        reviewStatus: row.review_status,
        reviewNote: row.review_note,
        reviewedAt: row.reviewed_at
      }))
    };
  } finally {
    await client.end();
  }
}

export async function recomputeNarrativeTrends(
  options: {
    asOfDate?: string;
    lookbackDays?: number;
    lowHistoryDays?: number;
    windows?: TrendWindow[];
    promptVersion?: string;
  } = {},
  databaseUrl = process.env.DATABASE_URL
) {
  if (
    ![options.lookbackDays ?? 365, options.lowHistoryDays ?? 30].every(
      (value) => Number.isInteger(value) && value > 0
    )
  )
    throw new Error("Narrative history settings must be positive integers.");
  if (
    options.asOfDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(options.asOfDate) ||
      !Number.isFinite(Date.parse(options.asOfDate)))
  )
    throw new Error("Invalid narrative measurement date.");
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    // Current UTC day is still receiving documents; publish completed days only.
    const asOfDate =
      options.asOfDate ?? addDays(new Date().toISOString().slice(0, 10), -1);
    const computationStartedAt = new Date().toISOString();
    await client.query("begin isolation level repeatable read");
    const lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext('narrative_recompute')) as locked"
    );
    if (!lock.rows[0].locked) {
      await client.query("rollback");
      return { definitionsProcessed: 0, rowsWritten: 0 };
    }
    const lookbackDays = options.lookbackDays ?? 365;
    const lowHistoryDays = options.lowHistoryDays ?? 30;
    const promptVersion =
      options.promptVersion ??
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
      "narrative_classification_v6";
    const windows = options.windows ?? ["7d", "30d"];
    const startDate = addDays(asOfDate, -(lookbackDays - 1));
    const dates = enumerateDates(startDate, asOfDate);
    const corpus = await client.query<{
      date: string;
      expectedDocuments: number;
    }>(
      `select d.published_at::date::text as date, count(*)::integer as "expectedDocuments"
       from documents d join document_texts dt on dt.document_id = d.id
       where d.published_at::date between $1::date and $2::date
         and d.retention_policy <> 'metadata_only'
       group by d.published_at::date`,
      [startDate, asOfDate]
    );
    const definitions = await client.query<{ id: string }>(
      "select id from narrative_definitions where status = 'active'"
    );
    const rows = await client.query<{
      narrative_definition_id: string;
      date: string;
      document_id: string;
      matched: boolean;
      match_score: number;
      risk_tone: number;
      bullish_tone: number;
      publisher_id: string | null;
      publisher_owner: string | null;
      source_class: string;
      affected_entities: string[];
      review_status: NarrativeReviewStatus;
    }>(
      `with latest_observations as (
         select distinct on (narrative_definition_id, document_id) *
         from narrative_observations
         where prompt_version = $3
         order by narrative_definition_id, document_id, observed_at desc, prompt_version desc
       )
       select no.narrative_definition_id, d.published_at::date::text as date,
              no.document_id, no.matched, no.match_score::float,
              no.risk_tone::float, no.bullish_tone::float,
              coalesce(d.publisher_id, d.publisher) as publisher_id,
              coalesce(d.publisher_owner, d.publisher) as publisher_owner,
              d.source_class, no.affected_entities, no.review_status
       from latest_observations no
       join documents d on d.id = no.document_id
       join document_texts dt on dt.document_id = d.id
       join narrative_definitions nd on nd.id = no.narrative_definition_id
       where no.metadata->>'textHash' = dt.content_hash
         and no.metadata->>'definitionVersion' = nd.version::text
         and d.retention_policy <> 'metadata_only'
         and d.published_at::date between $1::date and $2::date`,
      [startDate, asOfDate, promptVersion]
    );

    let rowsWritten = 0;

    try {
      for (const definition of definitions.rows) {
        const observations: NarrativeMetricObservation[] = rows.rows
          .filter((row) => row.narrative_definition_id === definition.id)
          .map((row) => ({
            narrativeDefinitionId: row.narrative_definition_id,
            date: row.date,
            documentId: row.document_id,
            matched: row.matched && row.review_status === "approved",
            reviewPending: row.matched && row.review_status === "pending",
            matchScore: row.match_score,
            riskTone: row.risk_tone,
            bullishTone: row.bullish_tone,
            publisherId: row.publisher_id ?? "",
            publisherOwner: row.publisher_owner ?? "",
            sourceClass: row.source_class,
            affectedEntities: row.affected_entities
          }));

        for (const window of windows) {
          const points = calculateNarrativeTrendSeries(
            observations,
            dates,
            window === "7d" ? 7 : 30,
            lowHistoryDays,
            corpus.rows
          );
          for (let offset = 0; offset < points.length; offset += 250) {
            await persistTrendBatch(
              client,
              definition.id,
              window,
              promptVersion,
              computationStartedAt,
              points.slice(offset, offset + 250)
            );
          }
          rowsWritten += points.length;
        }
      }
      await client.query(
        "delete from narrative_recompute_queue where requested_at <= $1::timestamptz",
        [computationStartedAt]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    return { definitionsProcessed: definitions.rowCount ?? 0, rowsWritten };
  } finally {
    await client.end();
  }
}

export async function getNarrativeBoardStatus(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION,
  options: { id?: string; window?: TrendWindow } = {}
): Promise<NarrativeBoardStatus> {
  if (!databaseUrl)
    return { databaseConfigured: false, latestDate: null, narratives: [] };
  const definitions = (await getActiveNarrativeDefinitions(databaseUrl)).filter(
    (definition) =>
      !options.id ||
      definition.id === options.id ||
      definition.slug === options.id
  );
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v6";
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const latest = await client.query<{ date: string | null }>(
      "select max(date)::text as date from narrative_trends where prompt_version = $1 and metadata->>'metricVersion' = $2",
      [promptVersion, narrativeMetricVersion]
    );
    const latestDate = latest.rows[0]?.date ?? null;
    const dirty = await client.query<{ narrative_definition_id: string }>(
      "select narrative_definition_id from narrative_recompute_queue"
    );
    const pending = new Set(
      dirty.rows.map((row) => row.narrative_definition_id)
    );
    const narratives: NarrativeTrendSummary[] = [];

    for (const definition of definitions) {
      const trends = await client.query<{
        date: string;
        trend_window: TrendWindow;
        density: number;
        baseline_mean: number;
        z_score: number;
        percentile_rank: number;
        change_value: number;
        acceleration: number;
        risk_tone: number;
        bullish_tone: number;
        eligible_documents: number;
        matched_documents: number;
        publisher_breadth: number;
        publisher_owner_breadth: number;
        source_class_breadth: number;
        entity_breadth: number;
        low_history: boolean;
        metadata: NarrativeQuality & { computedAt?: string };
      }>(
        `select date::text, trend_window, density::float, baseline_mean::float,
                z_score::float, percentile_rank::float, change_value::float,
                acceleration::float, risk_tone::float, bullish_tone::float,
                eligible_documents, matched_documents, publisher_breadth,
                publisher_owner_breadth, source_class_breadth, entity_breadth,
                low_history, metadata
         from narrative_trends
         where narrative_definition_id = $1
           and trend_window = $3
           and prompt_version = $2
           and metadata->>'metricVersion' = $4
         order by date desc
         limit 90`,
        [
          definition.id,
          promptVersion,
          options.window ?? "7d",
          narrativeMetricVersion
        ]
      );
      const current = trends.rows[0];
      const evidence = await client.query<{
        id: string;
        title: string;
        publisher: string;
        published_at: string;
        url: string;
        source_class: NarrativeTrendSummary["evidence"][number]["sourceClass"];
        stance: NarrativeTrendSummary["evidence"][number]["stance"];
        evidence_snippet: string;
        interpretation: string;
        affected_entities: string[];
        match_score: number;
        review_status: NarrativeReviewStatus;
      }>(
        `with latest_observations as (
           select distinct on (narrative_definition_id, document_id) *
           from narrative_observations
           where narrative_definition_id = $1
             and prompt_version = $2
           order by narrative_definition_id, document_id, observed_at desc, prompt_version desc
         )
         select no.id, d.title, d.publisher, d.published_at::text, d.url,
                d.source_class, no.stance, no.evidence_snippet, no.interpretation,
                no.affected_entities, no.match_score::float, no.review_status
         from latest_observations no
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         where no.metadata->>'textHash' = dt.content_hash
           and no.matched and no.review_status = 'approved'
           and d.retention_policy <> 'metadata_only'
           and no.metadata->>'definitionVersion' = $5::text
           and d.published_at::date between $3::date and $4::date
         order by d.published_at desc, no.match_score desc
         limit 12`,
        [
          definition.id,
          promptVersion,
          addDays(
            current?.date ??
              latestDate ??
              new Date().toISOString().slice(0, 10),
            options.window === "30d" ? -29 : -6
          ),
          current?.date ?? latestDate,
          definition.version
        ]
      );

      narratives.push({
        ...definition,
        ...current?.metadata,
        measurementPending: pending.has(definition.id),
        coverageComplete:
          Boolean(current?.metadata?.coverageComplete) &&
          !pending.has(definition.id),
        measuredAt: current?.metadata?.computedAt ?? null,
        trendWindow: options.window ?? "7d",
        latestDate: current?.date ?? null,
        density: current?.density ?? 0,
        baselineMean: current?.baseline_mean ?? 0,
        zScore: current?.z_score ?? 0,
        percentileRank: current?.percentile_rank ?? 0,
        change: current?.change_value ?? 0,
        acceleration: current?.acceleration ?? 0,
        riskTone: current?.risk_tone ?? 0,
        bullishTone: current?.bullish_tone ?? 0,
        eligibleDocuments: current?.eligible_documents ?? 0,
        matchedDocuments: current?.matched_documents ?? 0,
        publisherBreadth: current?.publisher_breadth ?? 0,
        publisherOwnerBreadth: current?.publisher_owner_breadth ?? 0,
        sourceClassBreadth: current?.source_class_breadth ?? 0,
        entityBreadth: current?.entity_breadth ?? 0,
        lowHistory:
          (current?.low_history ?? true) || pending.has(definition.id),
        history: trends.rows.reverse().map((row) => ({
          ...row.metadata,
          coverageComplete:
            row.metadata.coverageComplete && !pending.has(definition.id),
          lowHistory: row.low_history || pending.has(definition.id),
          date: row.date,
          density: row.density,
          baselineMean: row.baseline_mean,
          zScore: row.z_score,
          percentileRank: row.percentile_rank,
          change: row.change_value,
          acceleration: row.acceleration,
          riskTone: row.risk_tone,
          bullishTone: row.bullish_tone
        })),
        evidence: evidence.rows.map((row) => ({
          id: row.id,
          title: row.title,
          publisher: row.publisher,
          publishedAt: row.published_at,
          url: row.url,
          sourceClass: row.source_class,
          stance: row.stance,
          evidenceSnippet: row.evidence_snippet,
          interpretation: row.interpretation,
          affectedEntities: row.affected_entities,
          matchScore: row.match_score,
          reviewStatus: row.review_status
        }))
      });
    }

    return {
      databaseConfigured: true,
      latestDate,
      narratives: narratives.sort((left, right) => {
        const ready = (item: NarrativeTrendSummary) =>
          Boolean(
            item.coverageComplete &&
            item.comparisonReady &&
            !item.measurementPending
          );
        return (
          Number(ready(right)) - Number(ready(left)) ||
          (ready(left) && ready(right)
            ? Math.abs(right.change) - Math.abs(left.change)
            : 0) ||
          right.publisherOwnerBreadth - left.publisherOwnerBreadth ||
          left.name.localeCompare(right.name)
        );
      })
    };
  } finally {
    await client.end();
  }
}

export async function getNarrativeDetailStatus(
  idOrSlug: string,
  databaseUrl = process.env.DATABASE_URL,
  window: TrendWindow = "7d"
) {
  const board = await getNarrativeBoardStatus(databaseUrl, undefined, {
    id: idOrSlug,
    window
  });
  return (
    board.narratives.find(
      (narrative) => narrative.id === idOrSlug || narrative.slug === idOrSlug
    ) ?? null
  );
}

function mapDefinition(row: {
  id: string;
  slug: string;
  version: number;
  name: string;
  proposition: string;
  category: string;
  inclusion_guidance: string;
  exclusion_guidance: string;
  positive_examples: string[];
  negative_examples: string[];
  status: string;
}): NarrativeDefinition {
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    name: row.name,
    proposition: row.proposition,
    category: row.category,
    inclusionGuidance: row.inclusion_guidance,
    exclusionGuidance: row.exclusion_guidance,
    positiveExamples: row.positive_examples,
    negativeExamples: row.negative_examples,
    status: row.status
  };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function enumerateDates(start: string, end: string) {
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

async function persistTrendBatch(
  client: ReturnType<typeof createDatabaseClient>,
  definitionId: string,
  window: TrendWindow,
  promptVersion: string,
  computedAt: string,
  points: NarrativeMetricPoint[]
) {
  const fields = {
    id: "text",
    narrative_definition_id: "text",
    date: "date",
    trend_window: "text",
    density: "numeric",
    baseline_mean: "numeric",
    baseline_stddev: "numeric",
    z_score: "numeric",
    percentile_rank: "numeric",
    change_value: "numeric",
    acceleration: "numeric",
    risk_tone: "numeric",
    bullish_tone: "numeric",
    eligible_documents: "integer",
    matched_documents: "integer",
    publisher_breadth: "integer",
    publisher_owner_breadth: "integer",
    source_class_breadth: "integer",
    entity_breadth: "integer",
    low_history: "boolean",
    prompt_version: "text",
    metadata: "jsonb"
  };
  const rows = points.map((point) => ({
    id: `narrative:trend:${definitionId}:${window}:${point.date}:${promptVersion}`,
    narrative_definition_id: definitionId,
    date: point.date,
    trend_window: window,
    density: point.density,
    baseline_mean: point.baselineMean,
    baseline_stddev: point.baselineStddev,
    z_score: point.zScore,
    percentile_rank: point.percentileRank,
    change_value: point.change,
    acceleration: point.acceleration,
    risk_tone: point.riskTone,
    bullish_tone: point.bullishTone,
    eligible_documents: point.eligibleDocuments,
    matched_documents: point.matchedDocuments,
    publisher_breadth: point.publisherBreadth,
    publisher_owner_breadth: point.publisherOwnerBreadth,
    source_class_breadth: point.sourceClassBreadth,
    entity_breadth: point.entityBreadth,
    low_history: point.lowHistory,
    prompt_version: promptVersion,
    metadata: {
      metricVersion: narrativeMetricVersion,
      computedAt,
      coveredDays: point.coveredDays,
      expectedDocuments: point.expectedDocuments,
      pendingReview: point.pendingReview,
      coverageComplete: point.coverageComplete,
      comparisonReady: point.comparisonReady,
      accelerationReady: point.accelerationReady,
      zScoreAvailable: point.zScoreAvailable
    }
  }));
  const names = Object.keys(fields);
  await client.query(
    `insert into narrative_trends (${names.join(",")})
    select ${names.join(",")} from jsonb_to_recordset($1::jsonb) as x(${Object.entries(
      fields
    )
      .map(([name, type]) => `${name} ${type}`)
      .join(",")})
    on conflict (narrative_definition_id, date, trend_window, prompt_version) do update set
    ${names
      .filter(
        (name) =>
          ![
            "id",
            "narrative_definition_id",
            "date",
            "trend_window",
            "prompt_version"
          ].includes(name)
      )
      .map((name) => `${name} = excluded.${name}`)
      .join(",")}`,
    [JSON.stringify(rows)]
  );
}

export async function recomputeQueuedNarratives() {
  const client = createDatabaseClient();
  await client.connect();
  try {
    const result = await client.query(
      "select 1 from narrative_recompute_queue limit 1"
    );
    if (!result.rowCount) return;
  } finally {
    await client.end();
  }
  return recomputeNarrativeTrends();
}
