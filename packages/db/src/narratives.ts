import { randomUUID } from "node:crypto";
import { closeDatabaseClient, createDatabaseClient } from "./persistence";
import {
  calculateNarrativeTrendSeries,
  type NarrativeMetricObservation
} from "./narrative-metrics";
import type {
  AnalysisDocument,
  NarrativeBacklogSummary,
  NarrativeBoardStatus,
  NarrativeDefinition,
  NarrativeEvidence,
  NarrativeHomepageItem,
  NarrativeHomepageStatus,
  NarrativeObservationInput,
  NarrativeReviewQueue,
  NarrativeReviewStatus,
  NarrativeTrendSummary,
  SourceClass,
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
      kind: NarrativeDefinition["kind"];
      event_label: string | null;
    }>(
      `select id, slug, version, name, proposition, category,
              inclusion_guidance, exclusion_guidance,
              positive_examples, negative_examples, status, kind, event_label
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
    excludedDocumentIds?: string[];
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
      `with eligible as (
         select d.id, d.source_id, d.source_class, d.title, d.publisher, d.url,
                d.published_at, d.created_at, d.tickers, d.summary, d.metadata,
                dt.content, dt.content_hash as text_hash,
                row_number() over (
                  partition by d.source_class
                  order by d.published_at desc, d.created_at desc, d.id
                ) as source_rank
         from documents d
         join document_texts dt on dt.document_id = d.id
         where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
           and not (d.id = any($4::text[]))
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
               )
           )
       )
       select id, source_id, source_class, title, publisher, url,
              published_at::text, tickers, summary, metadata, content, text_hash
       from eligible
       order by source_rank, published_at desc, source_class, id
       limit $3`,
      [
        options.model,
        options.promptVersion,
        options.limit,
        options.excludedDocumentIds ?? []
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

export async function countNarrativeClassificationBacklog(
  options: { model: string; promptVersion: string },
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeBacklogSummary> {
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ source_class: SourceClass; count: string }>(
      `select d.source_class, count(*)::text as count
       from documents d
       join document_texts dt on dt.document_id = d.id
       where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
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
             )
         )
       group by d.source_class
       order by d.source_class`,
      [options.model, options.promptVersion]
    );
    const bySourceClass = result.rows.map((row) => ({
      sourceClass: row.source_class,
      count: Number(row.count)
    }));
    return {
      total: bySourceClass.reduce((sum, row) => sum + row.count, 0),
      bySourceClass
    };
  } finally {
    await client.end();
  }
}

export async function persistNarrativeObservations(
  observations: NarrativeObservationInput[],
  databaseUrl = process.env.DATABASE_URL
) {
  if (observations.length === 0) return { inserted: 0 };
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    let inserted = 0;
    for (const observation of observations) {
      const result = await client.query<{
        id: string;
        review_status: NarrativeReviewStatus;
        metadata: Record<string, unknown>;
      }>(
        `with prior_review as (
           select id, review_status, reviewed_at, review_note,
                  coalesce(
                    metadata->'reviewProvenance',
                    jsonb_build_object(
                      'actorType', 'human',
                      'reviewedAt', reviewed_at
                    )
                  ) as review_provenance
           from narrative_observations
           where $4::boolean
             and narrative_definition_id = $2
             and document_id = $3
             and evidence_snippet = $9
             and review_status in ('approved', 'rejected')
             and coalesce(
               metadata->'reviewProvenance'->>'actorType',
               case when metadata ? 'autoReview' then 'automatic' else 'human' end
             ) = 'human'
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
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14::jsonb || coalesce(
             (
               select jsonb_build_object(
                 'reviewProvenance',
                 review_provenance || jsonb_build_object(
                   'inheritedFromObservationId', id,
                   'inheritedAt', now()
                 )
               )
               from prior_review
             ),
             '{}'::jsonb
           ),
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
           metadata = excluded.metadata ||
             case
               when coalesce(
                 narrative_observations.metadata->'reviewProvenance'->>'actorType',
                 case
                   when narrative_observations.metadata ? 'autoReview'
                     then 'automatic'
                   else 'human'
                 end
               ) = 'automatic'
                 then jsonb_build_object(
                   '_automaticReviewReset',
                   coalesce(
                     narrative_observations.metadata->'reviewProvenance',
                     narrative_observations.metadata->'autoReview',
                     '{}'::jsonb
                   )
                 )
               else '{}'::jsonb
             end,
           review_status = excluded.review_status,
           reviewed_at = excluded.reviewed_at,
           review_note = excluded.review_note
         where narrative_observations.review_status = 'pending'
            or coalesce(
              narrative_observations.metadata->'reviewProvenance'->>'actorType',
              case
                when narrative_observations.metadata ? 'autoReview'
                  then 'automatic'
                else 'human'
              end
            ) = 'automatic'
         returning id, review_status, metadata`,
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
      const persisted = result.rows[0];
      if (!persisted) continue;
      const automaticReset = persisted.metadata._automaticReviewReset;
      if (persisted.review_status !== "pending") {
        await client.query(
          `insert into narrative_review_events (
             id, observation_id, observation_key, previous_status, new_status,
             actor_type, review_note, metadata
           ) values ($1, $2, $2, $3, $4, 'human_inherited', $5, $6::jsonb)`,
          [
            `narrative:review-event:${randomUUID()}`,
            persisted.id,
            automaticReset ? "approved" : "pending",
            persisted.review_status,
            "Inherited a prior human review for identical evidence.",
            JSON.stringify({
              reviewProvenance: persisted.metadata.reviewProvenance
            })
          ]
        );
      } else if (automaticReset) {
        await client.query(
          `insert into narrative_review_events (
             id, observation_id, observation_key, previous_status, new_status,
             actor_type, review_note, metadata
           ) values ($1, $2, $2, 'approved', 'pending', 'system', $3, $4::jsonb)`,
          [
            `narrative:review-event:${randomUUID()}`,
            persisted.id,
            "Automatic approval reset so the latest classification must satisfy policy again.",
            JSON.stringify({ priorReviewProvenance: automaticReset })
          ]
        );
      }
      if (automaticReset) {
        await client.query(
          `update narrative_observations
           set metadata = metadata - '_automaticReviewReset'
           where id = $1`,
          [persisted.id]
        );
      }
    }
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
    const previous = await client.query<{
      id: string;
      review_status: NarrativeReviewStatus;
      metadata: Record<string, unknown>;
    }>(
      `select id, review_status, metadata
       from narrative_observations
       where id = $1 and matched
       for update`,
      [input.id]
    );
    if (!previous.rows[0]) {
      throw new Error("Matched narrative observation not found.");
    }
    const provenance = {
      reviewProvenance: {
        actorType: "human",
        reviewedAt: new Date().toISOString()
      }
    };
    const result = await client.query<{
      id: string;
      review_status: NarrativeReviewStatus;
      reviewed_at: string;
    }>(
      `update narrative_observations
       set review_status = $2,
           review_note = nullif($3, ''),
           reviewed_at = now(),
           metadata = (metadata - 'autoReview') || $4::jsonb
       where id = $1 and matched
       returning id, review_status, reviewed_at::text`,
      [
        input.id,
        input.status,
        input.note?.trim() ?? "",
        JSON.stringify(provenance)
      ]
    );
    await client.query(
      `insert into narrative_review_events (
         id, observation_id, observation_key, previous_status, new_status,
         actor_type, review_note, metadata
       ) values ($1, $2, $2, $3, $4, 'human', nullif($5, ''), $6::jsonb)`,
      [
        `narrative:review-event:${randomUUID()}`,
        input.id,
        previous.rows[0].review_status,
        input.status,
        input.note?.trim() ?? "",
        JSON.stringify({
          overrodeAutomaticReview:
            previous.rows[0].metadata.autoReview !== undefined ||
            (
              previous.rows[0].metadata.reviewProvenance as
                | { actorType?: unknown }
                | undefined
            )?.actorType === "automatic"
        })
      ]
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

export async function retractNarrativeDefinition(
  input: {
    id: string;
    reason: string;
    actorType?: "human" | "system";
  },
  databaseUrl = process.env.DATABASE_URL
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A retraction reason is required.");
  const actorType = input.actorType ?? "human";
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const definition = await client.query<{ id: string; status: string }>(
      `select id, status
       from narrative_definitions
       where id = $1
       for update`,
      [input.id]
    );
    if (!definition.rows[0]) throw new Error("Narrative definition not found.");
    if (definition.rows[0].status !== "inactive") {
      await client.query(
        `update narrative_definitions
         set status = 'inactive',
             metadata = metadata || jsonb_build_object(
               'retraction', jsonb_build_object(
                 'actorType', $2::text,
                 'reason', $3::text,
                 'at', now()
               )
             ),
             updated_at = now()
         where id = $1`,
        [input.id, actorType, reason]
      );
      await client.query(
        `insert into narrative_definition_events (
           id, narrative_definition_id, action, actor_type, reason, metadata
         ) values ($1, $2, 'retracted', $3, $4, '{}'::jsonb)`,
        [
          `narrative:definition:event:${randomUUID()}`,
          input.id,
          actorType,
          reason
        ]
      );
      await client.query(
        `update narrative_candidates
         set metadata = metadata || jsonb_build_object(
               'retraction', jsonb_build_object(
                 'actorType', $2::text,
                 'reason', $3::text,
                 'at', now()
               )
             ),
             updated_at = now()
         where promoted_definition_id = $1`,
        [input.id, actorType, reason]
      );
    }
    await client.query("commit");
    return { id: input.id, status: "inactive" as const, reason };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export type NarrativeAutoReviewOptions = {
  model?: string;
  promptVersion?: string;
  minimumMatchScore?: number;
  minimumDocuments?: number;
  minimumPublisherOwners?: number;
  lookbackDays?: number;
  excludedPublisherOwners?: string[];
};

export async function autoApproveNarrativeObservations(
  options: NarrativeAutoReviewOptions = {},
  databaseUrl = process.env.DATABASE_URL
) {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-sonnet-4-5-20250929";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    "narrative_classification_v5";
  const minimumMatchScore =
    options.minimumMatchScore ??
    Number(process.env.NARRATIVE_AUTO_REVIEW_MIN_SCORE ?? 90);
  const minimumDocuments =
    options.minimumDocuments ??
    Number(process.env.NARRATIVE_AUTO_REVIEW_MIN_DOCUMENTS ?? 2);
  const minimumPublisherOwners =
    options.minimumPublisherOwners ??
    Number(process.env.NARRATIVE_AUTO_REVIEW_MIN_PUBLISHER_OWNERS ?? 2);
  const lookbackDays =
    options.lookbackDays ??
    Number(process.env.NARRATIVE_AUTO_REVIEW_LOOKBACK_DAYS ?? 7);
  const excludedPublisherOwners = (
    options.excludedPublisherOwners ??
    parseCsv(
      process.env.NARRATIVE_AUTO_REVIEW_EXCLUDED_PUBLISHER_OWNERS ??
        "youtube,youtube-com,youtube.com,youtu.be"
    )
  ).map((value) => value.toLowerCase());
  const reviewNote =
    `Auto-approved: score >= ${minimumMatchScore}; corroborated by >= ` +
    `${minimumDocuments} documents from >= ${minimumPublisherOwners} independent ` +
    `publisher groups within ${lookbackDays} days.`;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      approved_count: string;
      narratives_touched: string;
      observation_ids: string[];
    }>(
      `with corroborating as (
         select no.id, no.narrative_definition_id, no.document_id,
                lower(coalesce(
                  nullif(d.publisher_owner, ''),
                  nullif(d.publisher_id, ''),
                  d.publisher
                )) as publisher_owner
         from narrative_observations no
         join documents d on d.id = no.document_id
         join narrative_definitions nd on nd.id = no.narrative_definition_id
         where no.matched
           and nd.status = 'active'
           and no.review_status in ('pending', 'approved')
           and no.model = $1
           and no.prompt_version = $2
           and no.match_score >= $3
           and no.evidence_snippet <> ''
           and d.published_at >= now() - ($4::text || ' days')::interval
           and d.published_at <= now()
           and lower(coalesce(d.metadata->>'content', '')) <> 'preview'
           and not exists (
             select 1
             from unnest($5::text[]) blocked(value)
             where lower(coalesce(
                     nullif(d.publisher_owner, ''),
                     nullif(d.publisher_id, ''),
                     d.publisher
                   )) = blocked.value
                or lower(d.publisher) = blocked.value
                or lower(coalesce(d.metadata->>'platform', '')) = blocked.value
                or lower(d.url) like '%//' || blocked.value || '/%'
                or lower(d.url) like '%.' || blocked.value || '/%'
                or lower(d.url) like '%//' || blocked.value || ':%/%'
                or lower(d.url) like '%.' || blocked.value || ':%/%'
           )
       ),
       qualified as (
         select narrative_definition_id,
                array_agg(id order by id) as corroborating_observation_ids
         from corroborating
         group by narrative_definition_id
         having count(distinct document_id) >= $6
            and count(distinct publisher_owner) >= $7
       ),
       updated as (
         update narrative_observations no
         set review_status = 'approved',
             reviewed_at = now(),
             review_note = $8,
             metadata = (no.metadata - 'reviewProvenance') ||
               jsonb_build_object(
                 'autoReview', $9::jsonb,
                 'reviewProvenance', jsonb_build_object(
                   'actorType', 'automatic',
                   'reviewedAt', now(),
                   'policy', $9::jsonb,
                   'corroboratingObservationIds', q.corroborating_observation_ids
                 )
               )
         from corroborating c
         join qualified q
           on q.narrative_definition_id = c.narrative_definition_id
         where no.id = c.id
           and no.review_status = 'pending'
         returning no.id, no.narrative_definition_id
       ),
       review_events as (
         insert into narrative_review_events (
           id, observation_id, observation_key, previous_status, new_status,
           actor_type, review_note, metadata
         )
         select
           'narrative:review-event:auto:' ||
             md5(u.id || clock_timestamp()::text || random()::text),
           u.id,
           u.id,
           'pending',
           'approved',
           'automatic',
           $8,
           jsonb_build_object(
             'policy', $9::jsonb,
             'corroboratingObservationIds', q.corroborating_observation_ids
           )
         from updated u
         join qualified q
           on q.narrative_definition_id = u.narrative_definition_id
         returning observation_id
       )
       select count(*)::text as approved_count,
              count(distinct narrative_definition_id)::text as narratives_touched,
              coalesce(array_agg(id), '{}') as observation_ids
       from updated
       where exists (
         select 1 from review_events where review_events.observation_id = updated.id
       )`,
      [
        model,
        promptVersion,
        minimumMatchScore,
        lookbackDays,
        excludedPublisherOwners,
        minimumDocuments,
        minimumPublisherOwners,
        reviewNote,
        JSON.stringify({
          autoReview: {
            model,
            promptVersion,
            minimumMatchScore,
            minimumDocuments,
            minimumPublisherOwners,
            lookbackDays,
            excludedPublisherOwners
          }
        })
      ]
    );
    return {
      approvedObservations: Number(result.rows[0]?.approved_count ?? 0),
      narrativesTouched: Number(result.rows[0]?.narratives_touched ?? 0),
      observationIds: result.rows[0]?.observation_ids ?? [],
      reviewNote
    };
  } finally {
    await client.end();
  }
}

export async function getNarrativeReviewQueue(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeReviewQueue> {
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v5";
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
        `select review_status, count(*)::text as count
         from narrative_observations
         where matched and prompt_version = $1
         group by review_status`,
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
         where no.matched and no.prompt_version = $1
         order by
           case no.review_status when 'pending' then 0 when 'approved' then 1 else 2 end,
           d.published_at desc,
           no.match_score desc
         limit 100`,
        [promptVersion]
      );
    const countFor = (status: NarrativeReviewStatus) =>
      Number(counts.rows.find((row) => row.review_status === status)?.count ?? 0);

    return {
      databaseConfigured: true,
      promptVersion,
      pendingCount: countFor("pending"),
      approvedCount: countFor("approved"),
      rejectedCount: countFor("rejected"),
      items: items.rows.map((row) => ({
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
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const asOfDate = options.asOfDate ?? new Date().toISOString().slice(0, 10);
    const lookbackDays = options.lookbackDays ?? 365;
    const lowHistoryDays = options.lowHistoryDays ?? 30;
    const promptVersion =
      options.promptVersion ??
      process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
      "narrative_classification_v5";
    const windows = options.windows ?? ["7d", "30d"];
    const startDate = addDays(asOfDate, -(lookbackDays - 1));
    const dates = enumerateDates(startDate, asOfDate);
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
       where d.published_at::date between $1::date and $2::date`,
      [startDate, asOfDate, promptVersion]
    );

    let rowsWritten = 0;
    await client.query("begin");
    try {
      for (const definition of definitions.rows) {
        const observations: NarrativeMetricObservation[] = rows.rows
          .filter((row) => row.narrative_definition_id === definition.id)
          .map((row) => ({
            narrativeDefinitionId: row.narrative_definition_id,
            date: row.date,
            documentId: row.document_id,
            matched: row.matched && row.review_status === "approved",
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
            lowHistoryDays
          );
          for (const point of points) {
            await client.query(
              `insert into narrative_trends (
                 id, narrative_definition_id, date, trend_window, density,
                 baseline_mean, baseline_stddev, z_score, percentile_rank,
                 change_value, acceleration, risk_tone, bullish_tone,
                 eligible_documents, matched_documents, publisher_breadth,
                 publisher_owner_breadth, source_class_breadth, entity_breadth,
                 low_history, prompt_version
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
               )
               on conflict (narrative_definition_id, date, trend_window, prompt_version)
               do update set
                 density = excluded.density,
                 baseline_mean = excluded.baseline_mean,
                 baseline_stddev = excluded.baseline_stddev,
                 z_score = excluded.z_score,
                 percentile_rank = excluded.percentile_rank,
                 change_value = excluded.change_value,
                 acceleration = excluded.acceleration,
                 risk_tone = excluded.risk_tone,
                 bullish_tone = excluded.bullish_tone,
                 eligible_documents = excluded.eligible_documents,
                 matched_documents = excluded.matched_documents,
                 publisher_breadth = excluded.publisher_breadth,
                 publisher_owner_breadth = excluded.publisher_owner_breadth,
                 source_class_breadth = excluded.source_class_breadth,
                 entity_breadth = excluded.entity_breadth,
                 low_history = excluded.low_history`,
              [
                `narrative:trend:${definition.id}:${window}:${point.date}:${promptVersion}`,
                definition.id,
                point.date,
                window,
                point.density,
                point.baselineMean,
                point.baselineStddev,
                point.zScore,
                point.percentileRank,
                point.change,
                point.acceleration,
                point.riskTone,
                point.bullishTone,
                point.eligibleDocuments,
                point.matchedDocuments,
                point.publisherBreadth,
                point.publisherOwnerBreadth,
                point.sourceClassBreadth,
                point.entityBreadth,
                point.lowHistory,
                promptVersion
              ]
            );
            rowsWritten += 1;
          }
        }
      }
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

export const NARRATIVE_HOMEPAGE_QUERY_TIMEOUT_MS = 5_000;

type NarrativeHomepageEvidenceRow = {
  id: string;
  narrative_definition_id: string;
  title: string;
  publisher: string;
  published_at: string;
  url: string;
  source_class: NarrativeEvidence["sourceClass"];
  stance: NarrativeEvidence["stance"];
  evidence_snippet: string;
  interpretation: string;
  affected_entities: string[];
  match_score: number;
  review_status: NarrativeReviewStatus;
};

export async function getNarrativeHomepageStatus(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeHomepageStatus> {
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v5";
  if (!databaseUrl) {
    return emptyNarrativeHomepageStatus(false);
  }
  let client: ReturnType<typeof createDatabaseClient> | null = null;
  try {
    client = createDatabaseClient(databaseUrl, {
      queryTimeoutMs: NARRATIVE_HOMEPAGE_QUERY_TIMEOUT_MS,
      statementTimeoutMs: NARRATIVE_HOMEPAGE_QUERY_TIMEOUT_MS
    });
    await client.connect();
    const trends = await client.query<{
      tracked_count: string;
      latest_date: string | null;
      id: string | null;
      slug: string | null;
      version: number | null;
      name: string | null;
      proposition: string | null;
      category: string | null;
      inclusion_guidance: string | null;
      exclusion_guidance: string | null;
      positive_examples: string[] | null;
      negative_examples: string[] | null;
      status: string | null;
      kind: NarrativeDefinition["kind"] | null;
      event_label: string | null;
      density: number | null;
      baseline_mean: number | null;
      z_score: number | null;
      percentile_rank: number | null;
      change_value: number | null;
      acceleration: number | null;
      risk_tone: number | null;
      bullish_tone: number | null;
      eligible_documents: number | null;
      matched_documents: number | null;
      publisher_breadth: number | null;
      publisher_owner_breadth: number | null;
      source_class_breadth: number | null;
      entity_breadth: number | null;
      low_history: boolean | null;
    }>(
      `with overview as (
         select
           (select count(*)::text
              from narrative_definitions
              where status = 'active') as tracked_count,
           (select nt.date::text
              from narrative_trends nt
              join narrative_definitions nd
                on nd.id = nt.narrative_definition_id
              where nt.prompt_version = $1
                and nt.trend_window = '7d'
                and nd.status = 'active'
              order by nt.date desc
              limit 1) as latest_date
       )
       select o.tracked_count, o.latest_date, ranked.*
       from overview o
       left join lateral (
         select nd.id, nd.slug, nd.version, nd.name, nd.proposition, nd.category,
                nd.inclusion_guidance, nd.exclusion_guidance,
                nd.positive_examples, nd.negative_examples, nd.status,
                nd.kind, nd.event_label,
                nt.density::float, nt.baseline_mean::float, nt.z_score::float,
                nt.percentile_rank::float, nt.change_value::float,
                nt.acceleration::float, nt.risk_tone::float,
                nt.bullish_tone::float, nt.eligible_documents,
                nt.matched_documents, nt.publisher_breadth,
                nt.publisher_owner_breadth, nt.source_class_breadth,
                nt.entity_breadth, nt.low_history
         from narrative_trends nt
         join narrative_definitions nd on nd.id = nt.narrative_definition_id
         where o.latest_date is not null
           and nt.date = o.latest_date::date
           and nt.trend_window = '7d'
           and nt.prompt_version = $1
           and nd.status = 'active'
           and nt.matched_documents > 0
         order by nt.publisher_owner_breadth desc,
                  nt.matched_documents desc,
                  nt.source_class_breadth desc,
                  nd.id
         limit 6
       ) ranked on true
       order by ranked.publisher_owner_breadth desc nulls last,
                ranked.matched_documents desc nulls last,
                ranked.source_class_breadth desc nulls last,
                ranked.id`,
      [promptVersion]
    );
    const trackedNarrativeCount = Number(
      trends.rows[0]?.tracked_count ?? 0
    );
    const latestDate = trends.rows[0]?.latest_date ?? null;
    const trendRows = trends.rows.filter(
      (row): row is typeof row & { id: string } => Boolean(row.id)
    );
    const narrativeIds = trendRows.map((row) => row.id);
    let evidenceRows: NarrativeHomepageEvidenceRow[] = [];
    let evidenceDegraded = false;
    if (narrativeIds.length > 0 && latestDate) {
      try {
        const evidence = await client.query<NarrativeHomepageEvidenceRow>(
          `with latest_observations as (
             select distinct on (no.narrative_definition_id, no.document_id)
                    no.id, no.narrative_definition_id, no.document_id,
                    d.published_at, no.matched,
                    no.match_score::float, no.review_status
             from narrative_observations no
             join documents d on d.id = no.document_id
             where no.prompt_version = $1
               and no.narrative_definition_id = any($2::text[])
               and d.published_at >= $3::date - interval '6 days'
               and d.published_at < $3::date + interval '1 day'
             order by no.narrative_definition_id, no.document_id,
                      no.observed_at desc, no.id
           ),
           ranked as (
             select id, narrative_definition_id, document_id,
                    published_at, match_score,
                    row_number() over (
                      partition by narrative_definition_id
                      order by published_at desc, match_score desc, id
                    ) as evidence_rank
             from latest_observations
             where matched and review_status = 'approved'
           ),
           top_evidence as (
             select id, narrative_definition_id, document_id, evidence_rank
             from ranked
             where evidence_rank <= 3
           )
           select no.id, top_evidence.narrative_definition_id,
                  d.title, d.publisher, d.published_at::text, d.url,
                  d.source_class, no.stance, no.evidence_snippet,
                  no.interpretation, no.affected_entities,
                  no.match_score::float, no.review_status
           from top_evidence
           join narrative_observations no on no.id = top_evidence.id
           join documents d on d.id = top_evidence.document_id
           where no.matched
           order by top_evidence.narrative_definition_id,
                    top_evidence.evidence_rank`,
          [promptVersion, narrativeIds, latestDate]
        );
        evidenceRows = evidence.rows;
      } catch (error) {
        evidenceDegraded = true;
        console.warn(
          `[db] narrative homepage evidence preview failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    const evidenceByNarrative = new Map<string, NarrativeEvidence[]>();
    for (const row of evidenceRows) {
      const items = evidenceByNarrative.get(row.narrative_definition_id) ?? [];
      items.push({
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
        matchScore: Number(row.match_score),
        reviewStatus: row.review_status
      });
      evidenceByNarrative.set(row.narrative_definition_id, items);
    }

    return {
      databaseConfigured: true,
      degraded: evidenceDegraded,
      latestDate,
      trackedNarrativeCount,
      narratives: trendRows.map((row): NarrativeHomepageItem => ({
        id: row.id,
        slug: row.slug ?? "",
        version: row.version ?? 1,
        name: row.name ?? "",
        proposition: row.proposition ?? "",
        category: row.category ?? "Other",
        inclusionGuidance: row.inclusion_guidance ?? "",
        exclusionGuidance: row.exclusion_guidance ?? "",
        positiveExamples: row.positive_examples ?? [],
        negativeExamples: row.negative_examples ?? [],
        status: row.status ?? "active",
        kind: row.kind ?? "structural",
        eventLabel: row.event_label,
        trendWindow: "7d",
        latestDate,
        density: Number(row.density),
        baselineMean: Number(row.baseline_mean),
        zScore: Number(row.z_score),
        percentileRank: Number(row.percentile_rank),
        change: Number(row.change_value),
        acceleration: Number(row.acceleration),
        riskTone: Number(row.risk_tone),
        bullishTone: Number(row.bullish_tone),
        eligibleDocuments: row.eligible_documents ?? 0,
        matchedDocuments: row.matched_documents ?? 0,
        publisherBreadth: row.publisher_breadth ?? 0,
        publisherOwnerBreadth: row.publisher_owner_breadth ?? 0,
        sourceClassBreadth: row.source_class_breadth ?? 0,
        entityBreadth: row.entity_breadth ?? 0,
        lowHistory: row.low_history ?? true,
        evidencePreview: evidenceByNarrative.get(row.id) ?? []
      }))
    };
  } catch (error) {
    console.warn(
      `[db] narrative homepage query failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return emptyNarrativeHomepageStatus(Boolean(databaseUrl), true);
  } finally {
    if (client) {
      await closeDatabaseClient(client);
    }
  }
}

export async function getNarrativeBoardStatus(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeBoardStatus> {
  if (!databaseUrl) return { databaseConfigured: false, latestDate: null, narratives: [] };
  const definitions = await getActiveNarrativeDefinitions(databaseUrl);
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v5";
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const latest = await client.query<{ date: string | null }>(
      "select max(date)::text as date from narrative_trends where prompt_version = $1",
      [promptVersion]
    );
    const latestDate = latest.rows[0]?.date ?? null;
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
      }>(
        `select date::text, trend_window, density::float, baseline_mean::float,
                z_score::float, percentile_rank::float, change_value::float,
                acceleration::float, risk_tone::float, bullish_tone::float,
                eligible_documents, matched_documents, publisher_breadth,
                publisher_owner_breadth, source_class_breadth, entity_breadth,
                low_history
         from narrative_trends
         where narrative_definition_id = $1
           and trend_window = '7d'
           and prompt_version = $2
         order by date desc
         limit 90`,
        [definition.id, promptVersion]
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
         where no.matched and no.review_status = 'approved'
         order by d.published_at desc, no.match_score desc
         limit 12`,
        [definition.id, promptVersion]
      );

      narratives.push({
        ...definition,
        trendWindow: "7d",
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
        lowHistory: current?.low_history ?? true,
        history: trends.rows.reverse().map((row) => ({
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
      narratives: narratives.sort(
        (left, right) =>
          right.zScore - left.zScore || right.publisherOwnerBreadth - left.publisherOwnerBreadth
      )
    };
  } finally {
    await client.end();
  }
}

export async function getNarrativeDetailStatus(
  idOrSlug: string,
  databaseUrl = process.env.DATABASE_URL
) {
  const board = await getNarrativeBoardStatus(databaseUrl);
  return board.narratives.find(
    (narrative) => narrative.id === idOrSlug || narrative.slug === idOrSlug
  ) ?? null;
}

function emptyNarrativeHomepageStatus(
  databaseConfigured: boolean,
  degraded = false
): NarrativeHomepageStatus {
  return {
    databaseConfigured,
    degraded,
    latestDate: null,
    trackedNarrativeCount: 0,
    narratives: []
  };
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
  kind: NarrativeDefinition["kind"];
  event_label: string | null;
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
    status: row.status,
    kind: row.kind,
    eventLabel: row.event_label
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

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
