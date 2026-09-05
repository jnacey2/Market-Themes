import { randomUUID } from "node:crypto";
import { closeDatabaseClient, createDatabaseClient } from "./persistence";
import {
  calculateNarrativeTrendSeries,
  type NarrativeMetricObservation
} from "./narrative-metrics";
import type {
  AnalysisDocument,
  BriefSection,
  NarrativeBacklogSummary,
  NarrativeBoardStatus,
  NarrativeChange,
  NarrativeChangeKind,
  NarrativeChangeReport,
  NarrativeDefinition,
  NarrativeEvidence,
  NarrativeHomepageItem,
  NarrativeHomepageStatus,
  NarrativeLifecycleState,
  NarrativeObservationInput,
  NarrativeReviewQueue,
  NarrativeReviewStatus,
  NarrativeTrendPoint,
  NarrativeTrendSummary,
  SourceClass,
  StoredBrief,
  TrendWindow
} from "./types";

export async function getActiveNarrativeDefinitions(
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeDefinition[]> {
  return getNarrativeDefinitionsByStatuses(["active"], databaseUrl);
}

export async function getTrackedNarrativeDefinitions(
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeDefinition[]> {
  return getNarrativeDefinitionsByStatuses(
    ["active", "probationary"],
    databaseUrl
  );
}

async function getNarrativeDefinitionsByStatuses(
  statuses: string[],
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
      metadata: Record<string, unknown>;
      parent_definition_id: string | null;
      merged_into_definition_id: string | null;
      parent_name: string | null;
      dimension: string | null;
      event_expires_at: string | null;
      activated_at: string | null;
    }>(
      `select nd.id, nd.slug, nd.version, nd.name, nd.proposition, nd.category,
              nd.inclusion_guidance, nd.exclusion_guidance,
              nd.positive_examples, nd.negative_examples, nd.status, nd.kind,
              nd.event_label, nd.metadata, nd.parent_definition_id,
              nd.merged_into_definition_id,
              parent.name as parent_name, nd.dimension,
              nd.event_expires_at::text, nd.activated_at::text
       from narrative_definitions nd
       left join narrative_definitions parent
         on parent.id = nd.parent_definition_id
       where nd.status = any($1::text[])
       order by coalesce(parent.name, nd.name), nd.dimension nulls first, nd.name`,
      [statuses]
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
    /** Only documents published within this many days are (re)classified. */
    lookbackDays?: number;
    /**
     * Documents published within this many days are claimed newest-first across all
     * source classes before any older backfill work. Trend coverage requires every
     * document in the measured window to be classified, so recent documents must not
     * queue behind year-old filings.
     */
    priorityDays?: number;
    /** Documents with this many failed batch attempts are no longer resubmitted. */
    maxAttempts?: number;
  },
  databaseUrl = process.env.DATABASE_URL
): Promise<AnalysisDocument[]> {
  const lookbackDays = resolveClassificationLookbackDays(options.lookbackDays);
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
           and d.published_at >= now() - ($5::int * interval '1 day')
           and not (d.id = any($4::text[]))
           and ${classificationAttemptsRemainingSql("$7", "$8")}
           and not exists (
             select 1
             from anthropic_message_batch_items mbi
             join anthropic_message_batches mb on mb.id = mbi.batch_id
             where mbi.document_id = d.id
               and mb.workload = 'narrative_classification'
               and mb.status in (
                 'submitting',
                 'submission_unknown',
                 'in_progress',
                 'canceling',
                 'processing_results'
               )
           )
           and exists (
             select 1
             from narrative_definitions nd
             where nd.status in ('active', 'probationary')
               and d.published_at >= now() - (coalesce(nd.history_backfill_days, $5)::int * interval '1 day')
               and not exists (
                 select 1
                 from narrative_observations no
                 where no.narrative_definition_id = nd.id
                   and no.document_id = d.id
                   and no.model = $1
                   and no.prompt_version = any($2::text[])
                   and coalesce(no.metadata->>'promotionSeed', 'false') <> 'true'
               )
           )
       )
       select id, source_id, source_class, title, publisher, url,
              published_at::text, tickers, summary, metadata, content, text_hash
       from eligible
       order by
         (published_at >= now() - ($6::int * interval '1 day')) desc,
         case when published_at >= now() - ($6::int * interval '1 day')
              then published_at end desc nulls last,
         source_rank, published_at desc, source_class, id
       limit $3`,
      [
        options.model,
        resolveCompatibleClassificationPromptVersions(options.promptVersion),
        options.limit,
        options.excludedDocumentIds ?? [],
        lookbackDays,
        resolveClassificationPriorityDays(options.priorityDays),
        options.promptVersion,
        resolveClassificationMaxAttempts(options.maxAttempts)
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

export const DEFAULT_NARRATIVE_CLASSIFICATION_LOOKBACK_DAYS = 60;
export const DEFAULT_NARRATIVE_CLASSIFICATION_PRIORITY_DAYS = 14;
export const DEFAULT_NARRATIVE_CLASSIFICATION_MAX_ATTEMPTS = 5;

/**
 * Failed batch attempts after which a document stops being resubmitted for
 * classification and leaves the trend coverage denominator. Without a bound a document
 * the model cannot process is re-queued every batch and pins every narrative's window
 * at "backfill pending" forever.
 */
export function resolveClassificationMaxAttempts(
  value: number | string | undefined = process.env.NARRATIVE_CLASSIFICATION_MAX_ATTEMPTS
) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_NARRATIVE_CLASSIFICATION_MAX_ATTEMPTS;
}

/**
 * SQL predicate (for a `documents d` alias) that is true when the document has not
 * exhausted its classification attempts under the given prompt version. Parameter
 * placeholders are supplied by the caller so the fragment can be embedded anywhere.
 */
export function classificationAttemptsRemainingSql(
  promptVersionParam: string,
  maxAttemptsParam: string
) {
  return `(
    select count(*)
    from anthropic_message_batch_items mbi
    join anthropic_message_batches mb on mb.id = mbi.batch_id
    where mbi.document_id = d.id
      and mb.workload = 'narrative_classification'
      and mb.prompt_version = ${promptVersionParam}
      and mbi.status not in ('submitted', 'completed')
  ) < ${maxAttemptsParam}::int`;
}

/**
 * Window of recent documents that classification claims first, newest-first across all
 * source classes. Covers the 7-day measured window plus the previous week used for
 * movement, so the board recovers coverage before backfill work resumes.
 */
export function resolveClassificationPriorityDays(
  value: number | string | undefined = process.env.NARRATIVE_CLASSIFICATION_PRIORITY_DAYS
) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_NARRATIVE_CLASSIFICATION_PRIORITY_DAYS;
}

/**
 * Prompt versions whose observations are interchangeable with the current one for trend
 * measurement and classification eligibility. Trend history is keyed by prompt version, so
 * a cosmetic prompt edit would otherwise reset every baseline to zero and re-classify the
 * corpus. List only versions with unchanged matching semantics; a stricter or looser
 * contract must stay incompatible and be backfilled instead. The current version is
 * always first so it wins when a document was classified under more than one.
 */
export function resolveCompatibleClassificationPromptVersions(
  currentVersion: string,
  value: string | undefined = process.env.NARRATIVE_CLASSIFICATION_COMPATIBLE_PROMPT_VERSIONS
): string[] {
  const compatible = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== currentVersion);
  return [currentVersion, ...new Set(compatible)];
}

/**
 * Builds the observation prompt-version filter and the DISTINCT ON ordering used to pick
 * one observation per (definition, document). With a single version (the normal case)
 * the predicate is a plain equality and the ordering matches
 * narrative_observations_homepage_idx exactly, so the planner streams from the index.
 * Only when compatible versions are configured does it fall back to an array match and
 * an expression ordering that prefers the current version.
 */
export function observationVersionSql(
  versions: string[],
  versionsParam: string,
  currentParam: string
) {
  if (versions.length === 1) {
    // Both parameters stay referenced so the bind matches; the equality drives the
    // index and the array check is a no-op filter.
    return {
      predicate: `prompt_version = ${currentParam} and prompt_version = any(${versionsParam}::text[])`,
      order: "observed_at desc, prompt_version desc"
    };
  }
  return {
    predicate: `prompt_version = any(${versionsParam}::text[])`,
    order: `(prompt_version = ${currentParam}) desc, observed_at desc, prompt_version desc`
  };
}

/**
 * Bounds how far back the classifier revisits documents when a definition is added or a
 * prompt version changes. Keep this aligned with NARRATIVE_TREND_LOOKBACK_DAYS: trend
 * baselines can only see classified history, so a shorter classification lookback caps
 * how much history the 30-day window can ever accumulate.
 */
export function resolveClassificationLookbackDays(
  value: number | string | undefined = process.env.NARRATIVE_CLASSIFICATION_LOOKBACK_DAYS
) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_NARRATIVE_CLASSIFICATION_LOOKBACK_DAYS;
}

export async function countNarrativeClassificationBacklog(
  options: {
    model: string;
    promptVersion: string;
    lookbackDays?: number;
    maxAttempts?: number;
  },
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeBacklogSummary> {
  const lookbackDays = resolveClassificationLookbackDays(options.lookbackDays);
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{ source_class: SourceClass; count: string }>(
      `select d.source_class, count(*)::text as count
       from documents d
       join document_texts dt on dt.document_id = d.id
       where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
         and d.published_at >= now() - ($3::int * interval '1 day')
         and ${classificationAttemptsRemainingSql("$4", "$5")}
         and not exists (
           select 1
           from anthropic_message_batch_items mbi
           join anthropic_message_batches mb on mb.id = mbi.batch_id
           where mbi.document_id = d.id
             and mb.workload = 'narrative_classification'
             and mb.status in (
               'submitting',
               'submission_unknown',
               'in_progress',
               'canceling',
               'processing_results'
             )
         )
         and exists (
           select 1
           from narrative_definitions nd
           where nd.status in ('active', 'probationary')
             and d.published_at >= now() - (coalesce(nd.history_backfill_days, $3)::int * interval '1 day')
             and not exists (
               select 1
               from narrative_observations no
               where no.narrative_definition_id = nd.id
                 and no.document_id = d.id
                 and no.model = $1
                 and no.prompt_version = any($2::text[])
                 and coalesce(no.metadata->>'promotionSeed', 'false') <> 'true'
             )
         )
       group by d.source_class
       order by d.source_class`,
      [
        options.model,
        resolveCompatibleClassificationPromptVersions(options.promptVersion),
        lookbackDays,
        options.promptVersion,
        resolveClassificationMaxAttempts(options.maxAttempts)
      ]
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
    const previousActor =
      (
        previous.rows[0].metadata.reviewProvenance as
          | { actorType?: unknown }
          | undefined
      )?.actorType ??
      (previous.rows[0].metadata.autoReview !== undefined
        ? "automatic"
        : undefined);
    if (
      previousActor === "automatic" &&
      previous.rows[0].review_status !== input.status &&
      !input.note?.trim()
    ) {
      throw new Error(
        "A review note is required when overriding an automatic decision."
      );
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

export async function reconcileNarrativeDefinitionLifecycle(
  options: {
    model?: string;
    promptVersion?: string;
    minimumStories?: number;
    minimumPublisherOwners?: number;
    lookbackDays?: number;
  } = {},
  databaseUrl = process.env.DATABASE_URL
) {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    "narrative_classification_v7";
  const minimumStories = positiveInteger(
    options.minimumStories ??
      Number(process.env.NARRATIVE_ACTIVATION_MIN_STORIES ?? 3),
    3
  );
  const minimumPublisherOwners = positiveInteger(
    options.minimumPublisherOwners ??
      Number(process.env.NARRATIVE_ACTIVATION_MIN_PUBLISHER_OWNERS ?? 3),
    3
  );
  const lookbackDays = positiveInteger(
    options.lookbackDays ??
      Number(process.env.NARRATIVE_ACTIVATION_LOOKBACK_DAYS ?? 7),
    7
  );
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const expired = await client.query<{ narrative_definition_id: string }>(
      `with changed as (
         update narrative_definitions
         set status = 'expired',
             metadata = metadata || jsonb_build_object(
               'expiration',
               jsonb_build_object(
                 'actorType', 'system',
                 'expiredAt', now(),
                 'eventExpiresAt', event_expires_at
               )
             ),
             updated_at = now()
         where kind = 'event'
           and status in ('active', 'probationary')
           and event_expires_at is not null
           and event_expires_at <= now()
         returning id
       )
       insert into narrative_definition_events (
         id, narrative_definition_id, action, actor_type, reason, metadata
       )
       select
         'narrative:definition:event:expired:' ||
           md5(id || clock_timestamp()::text),
         id,
         'expired',
         'system',
         'Event reached its configured publication expiry.',
         jsonb_build_object('eventExpiresAt', now())
       from changed
       returning narrative_definition_id`
    );

    const activated = await client.query<{
      narrative_definition_id: string;
    }>(
      `with qualifying as (
         select nd.id
         from narrative_definitions nd
         join narrative_observations no
           on no.narrative_definition_id = nd.id
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         where nd.status = 'probationary'
           and (nd.event_expires_at is null or nd.event_expires_at > now())
           and no.matched
           and no.review_status = 'approved'
           and no.model = $1
           and no.prompt_version = $2
           and position(no.evidence_snippet in dt.content) > 0
           and d.published_at >= now() - ($3::text || ' days')::interval
           and d.published_at <= now()
           and lower(coalesce(d.metadata->>'content', '')) <> 'preview'
           and coalesce(no.metadata->>'promotionSeed', 'false') <> 'true'
           and no.metadata->'contractValidation'->>'satisfied' = 'true'
         group by nd.id
         having count(distinct coalesce(
                  nullif(d.near_duplicate_key, ''),
                  nullif(d.metadata->>'wireStoryId', ''),
                  md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
                )) >= $4
            and count(distinct lower(coalesce(
                  nullif(d.publisher_owner, ''),
                  nullif(d.publisher_id, ''),
                  d.publisher
                ))) >= $5
       ),
       changed as (
         update narrative_definitions nd
         set status = 'active',
             activated_at = now(),
             metadata = metadata || jsonb_build_object(
               'activation',
               jsonb_build_object(
                 'actorType', 'system',
                 'activatedAt', now(),
                 'model', $1::text,
                 'promptVersion', $2::text,
                 'minimumStories', $4::integer,
                 'minimumPublisherOwners', $5::integer,
                 'lookbackDays', $3::integer
               )
             ),
             updated_at = now()
         from qualifying q
         where nd.id = q.id
         returning nd.id
       )
       insert into narrative_definition_events (
         id, narrative_definition_id, action, actor_type, reason, metadata
       )
       select
         'narrative:definition:event:activated:' ||
           md5(id || clock_timestamp()::text),
         id,
         'activated',
         'system',
         'Probation completed with current-version unique-story and publisher breadth.',
         jsonb_build_object(
           'model', $1::text,
           'promptVersion', $2::text,
           'minimumStories', $4::integer,
           'minimumPublisherOwners', $5::integer,
           'lookbackDays', $3::integer
         )
       from changed
       returning narrative_definition_id`,
      [
        model,
        promptVersion,
        lookbackDays,
        minimumStories,
        minimumPublisherOwners
      ]
    );
    await client.query("commit");
    return {
      activatedDefinitions: activated.rowCount ?? 0,
      activatedDefinitionIds: activated.rows.map(
        (row) => row.narrative_definition_id
      ),
      expiredDefinitions: expired.rowCount ?? 0,
      expiredDefinitionIds: expired.rows.map(
        (row) => row.narrative_definition_id
      )
    };
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
  /** Restrict the pass to definitions of these kinds (default: all kinds). */
  kinds?: Array<"structural" | "event">;
  /**
   * End of the corroboration window (default: now). Backlog passes step this
   * through history so evidence published months ago is judged against its own
   * week rather than against today's.
   */
  windowEnd?: Date;
  /** Label recorded on the review note and provenance; defaults to "default". */
  tier?: string;
};

/**
 * Structural themes (pricing power, margin pressure, ...) match more diffusely
 * and at lower scores than a headline event, so the single 90-point gate
 * approved almost none of their evidence. This second tier applies only to
 * structural definitions; event narratives keep the strict gate. 70 is the
 * classifier's floor for a match (each has passed the contract audit), so the
 * corroboration requirement, not the score, is the gate here.
 */
export function resolveStructuralAutoReviewOptions(
  env: NodeJS.ProcessEnv = process.env
): NarrativeAutoReviewOptions | null {
  if (env.NARRATIVE_AUTO_REVIEW_STRUCTURAL_ENABLED === "false") return null;
  return {
    kinds: ["structural"],
    tier: "structural",
    minimumMatchScore: Number(env.NARRATIVE_AUTO_REVIEW_STRUCTURAL_MIN_SCORE ?? 70),
    minimumDocuments: Number(env.NARRATIVE_AUTO_REVIEW_STRUCTURAL_MIN_DOCUMENTS ?? 2),
    minimumPublisherOwners: Number(
      env.NARRATIVE_AUTO_REVIEW_STRUCTURAL_MIN_PUBLISHER_OWNERS ?? 2
    ),
    lookbackDays: Number(env.NARRATIVE_AUTO_REVIEW_STRUCTURAL_LOOKBACK_DAYS ?? 14)
  };
}

export async function autoApproveNarrativeObservations(
  options: NarrativeAutoReviewOptions = {},
  databaseUrl = process.env.DATABASE_URL
) {
  const model =
    options.model ??
    process.env.ANTHROPIC_MODEL ??
    "claude-haiku-4-5-20251001";
  const promptVersion =
    options.promptVersion ??
    process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
    "narrative_classification_v7";
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
  const kinds = options.kinds ?? null;
  const windowEnd = options.windowEnd ?? new Date();
  const tier = options.tier ?? "default";
  const reviewNote =
    `Auto-approved${tier === "default" ? "" : ` (${tier} tier)`}: score >= ${minimumMatchScore}; corroborated by >= ` +
    `${minimumDocuments} unique stories from >= ${minimumPublisherOwners} ` +
    `publisher groups within ${lookbackDays} days` +
    (options.windowEnd ? ` ending ${windowEnd.toISOString().slice(0, 10)}` : "") +
    ".";
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      approved_count: string;
      narratives_touched: string;
      observation_ids: string[];
    }>(
      `with eligible as (
         select no.id, no.narrative_definition_id, no.document_id,
                lower(coalesce(
                  nullif(d.publisher_owner, ''),
                  nullif(d.publisher_id, ''),
                  d.publisher
                )) as publisher_owner,
                coalesce(
                  nullif(d.near_duplicate_key, ''),
                  nullif(d.metadata->>'wireStoryId', ''),
                  md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
                ) as story_fingerprint,
                no.match_score,
                d.published_at
         from narrative_observations no
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         join narrative_definitions nd on nd.id = no.narrative_definition_id
         where no.matched
           and nd.status in ('active', 'probationary')
           and no.review_status in ('pending', 'approved')
           and no.model = $1
           and no.prompt_version = $2
           and no.match_score >= $3
           and no.evidence_snippet <> ''
           and position(no.evidence_snippet in dt.content) > 0
           and coalesce(no.metadata->>'promotionSeed', 'false') <> 'true'
           and no.metadata->'contractValidation'->>'satisfied' = 'true'
           and d.published_at >= $11::timestamptz - ($4::text || ' days')::interval
           and d.published_at <= $11::timestamptz
           and ($10::text[] is null or nd.kind = any($10::text[]))
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
       corroborating as (
         select id, narrative_definition_id, document_id,
                publisher_owner, story_fingerprint
         from (
           select eligible.*,
                  row_number() over (
                    partition by narrative_definition_id, story_fingerprint
                    order by match_score desc, published_at desc, id
                  ) as story_rank
           from eligible
         ) ranked
         where story_rank = 1
       ),
       qualified as (
         select narrative_definition_id,
                array_agg(id order by id) as corroborating_observation_ids
         from corroborating
         group by narrative_definition_id
         having count(distinct story_fingerprint) >= $6
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
            tier,
            model,
            promptVersion,
            minimumMatchScore,
            minimumDocuments,
            minimumPublisherOwners,
            lookbackDays,
            windowEnd: windowEnd.toISOString(),
            kinds,
            excludedPublisherOwners
          }
        }),
        kinds,
        windowEnd.toISOString()
      ]
    );
    return {
      tier,
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
    configuredPromptVersion ?? "narrative_classification_v7";
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
      "narrative_classification_v7";
    const observationVersions =
      resolveCompatibleClassificationPromptVersions(promptVersion);
    const recomputeVersionSql = observationVersionSql(observationVersions, "$3", "$4");
    const windows = options.windows ?? ["7d", "30d"];
    const startDate = addDays(asOfDate, -(lookbackDays - 1));
    const dates = enumerateDates(startDate, asOfDate);
    const definitions = await client.query<{ id: string }>(
      "select id from narrative_definitions where status in ('active', 'probationary')"
    );
    const corpus = await client.query<{
      date: string;
      document_id: string;
      source_class: string;
    }>(
      `select d.published_at::date::text as date,
              d.id as document_id, d.source_class
       from documents d
       where coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
         and d.published_at >= $1::date
         and d.published_at < $2::date + interval '1 day'
         and exists (
           select 1
           from document_texts dt
           where dt.document_id = d.id
         )
         and ${classificationAttemptsRemainingSql("$3", "$4")}`,
      [startDate, asOfDate, promptVersion, resolveClassificationMaxAttempts()]
    );
    const corpusDocuments = corpus.rows.map((row) => ({
      date: row.date,
      documentId: row.document_id,
      sourceClass: row.source_class
    }));
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
      story_fingerprint: string;
      source_class: string;
      affected_entities: string[];
      review_status: NarrativeReviewStatus;
      evidence_current: boolean;
    }>(
      `with latest_observations as (
         select distinct on (narrative_definition_id, document_id) *
         from narrative_observations
         where ${recomputeVersionSql.predicate}
         order by narrative_definition_id, document_id, ${recomputeVersionSql.order}
       )
       select no.narrative_definition_id, d.published_at::date::text as date,
              no.document_id, no.matched, no.match_score::float,
              no.risk_tone::float, no.bullish_tone::float,
              coalesce(d.publisher_id, d.publisher) as publisher_id,
              coalesce(d.publisher_owner, d.publisher) as publisher_owner,
              coalesce(
                nullif(d.near_duplicate_key, ''),
                nullif(d.metadata->>'wireStoryId', ''),
                md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
              ) as story_fingerprint,
              d.source_class, no.affected_entities, no.review_status,
              case
                when no.matched and no.review_status = 'approved'
                  then exists (
                    select 1 from document_texts dt
                    where dt.document_id = no.document_id
                      and position(no.evidence_snippet in dt.content) > 0
                  )
                else true
              end as evidence_current
       from latest_observations no
       join documents d on d.id = no.document_id
       where d.published_at >= $1::date
         and d.published_at < $2::date + interval '1 day'
         and exists (
           select 1 from document_texts dt where dt.document_id = d.id
         )`,
      [startDate, asOfDate, observationVersions, promptVersion]
    );

    const rowsByDefinition = new Map<string, typeof rows.rows>();
    for (const row of rows.rows) {
      const group = rowsByDefinition.get(row.narrative_definition_id);
      if (group) group.push(row);
      else rowsByDefinition.set(row.narrative_definition_id, [row]);
    }

    let rowsWritten = 0;
    await client.query("begin");
    try {
      for (const definition of definitions.rows) {
        const observations: NarrativeMetricObservation[] = (
          rowsByDefinition.get(definition.id) ?? []
        ).map((row) => ({
            narrativeDefinitionId: row.narrative_definition_id,
            date: row.date,
            documentId: row.document_id,
            matched:
              row.matched &&
              row.review_status === "approved" &&
              row.evidence_current,
            rawMatched: row.matched && row.review_status !== "rejected",
            matchScore: row.match_score,
            riskTone: row.risk_tone,
            bullishTone: row.bullish_tone,
            publisherId: row.publisher_id ?? "",
            publisherOwner: row.publisher_owner ?? "",
            storyFingerprint: row.story_fingerprint,
            sourceClass: row.source_class,
            affectedEntities: row.affected_entities
          }));

        for (const window of windows) {
          const points = calculateNarrativeTrendSeries(
            observations,
            dates,
            window === "7d" ? 7 : 30,
            lowHistoryDays,
            corpusDocuments
          );
          for (const point of points) {
            await client.query(
              `insert into narrative_trends (
                 id, narrative_definition_id, date, trend_window, density,
                 baseline_mean, baseline_stddev, z_score, percentile_rank,
                 change_value, acceleration, risk_tone, bullish_tone,
                 eligible_documents, matched_documents, publisher_breadth,
                 publisher_owner_breadth, story_breadth, source_class_breadth,
                 entity_breadth, corpus_eligible_documents,
                 classified_documents, classification_coverage_pct,
                 coverage_state, low_history, prompt_version,
                 baseline_windows, attention_density,
                 attention_matched_documents, attention_z_score,
                 peak_density, peak_date, days_since_peak, percent_of_peak,
                 lifecycle_state
               ) values (
                 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                 $21, $22, $23, $24, $25, $26,
                 $27, $28, $29, $30, $31, $32, $33, $34, $35
               )
               on conflict (narrative_definition_id, date, trend_window, prompt_version)
               do update set
                 baseline_windows = excluded.baseline_windows,
                 attention_density = excluded.attention_density,
                 attention_matched_documents = excluded.attention_matched_documents,
                 attention_z_score = excluded.attention_z_score,
                 peak_density = excluded.peak_density,
                 peak_date = excluded.peak_date,
                 days_since_peak = excluded.days_since_peak,
                 percent_of_peak = excluded.percent_of_peak,
                 lifecycle_state = excluded.lifecycle_state,
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
                 story_breadth = excluded.story_breadth,
                 source_class_breadth = excluded.source_class_breadth,
                 entity_breadth = excluded.entity_breadth,
                 corpus_eligible_documents = excluded.corpus_eligible_documents,
                 classified_documents = excluded.classified_documents,
                 classification_coverage_pct = excluded.classification_coverage_pct,
                 coverage_state = excluded.coverage_state,
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
                point.storyBreadth,
                point.sourceClassBreadth,
                point.entityBreadth,
                point.corpusEligibleDocuments,
                point.classifiedDocuments,
                point.classificationCoveragePercent,
                point.coverageState,
                point.lowHistory,
                promptVersion,
                point.baselineWindows,
                point.attentionDensity,
                point.attentionMatchedDocuments,
                point.attentionZScore,
                point.peakDensity,
                point.peakDate,
                point.daysSincePeak,
                point.percentOfPeak,
                point.lifecycleState
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
export const NARRATIVE_BOARD_QUERY_TIMEOUT_MS = 15_000;
const HOMEPAGE_LANE_SIZE = 6;
const HOMEPAGE_EVIDENCE_NARRATIVES = 12;

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
  story_fingerprint: string;
};

type DefinitionRow = {
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
  metadata: Record<string, unknown>;
  parent_definition_id: string | null;
  merged_into_definition_id: string | null;
  parent_name: string | null;
  dimension: string | null;
  event_expires_at: string | null;
  activated_at: string | null;
};

type TrendRow = {
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
  story_breadth: number;
  source_class_breadth: number;
  entity_breadth: number;
  corpus_eligible_documents: number;
  classified_documents: number;
  classification_coverage_pct: number;
  coverage_state: NarrativeTrendSummary["coverageStatus"];
  low_history: boolean;
  baseline_windows: number;
  attention_density: number;
  attention_matched_documents: number;
  attention_z_score: number;
  peak_density: number;
  peak_date: string | null;
  days_since_peak: number | null;
  percent_of_peak: number;
  lifecycle_state: NarrativeLifecycleState;
};

const DEFINITION_COLUMNS = `nd.id, nd.slug, nd.version, nd.name, nd.proposition, nd.category,
       nd.inclusion_guidance, nd.exclusion_guidance,
       nd.positive_examples, nd.negative_examples, nd.status, nd.kind,
       nd.event_label, nd.metadata, nd.parent_definition_id,
       nd.merged_into_definition_id,
       parent.name as parent_name, nd.dimension,
       nd.event_expires_at::text, nd.activated_at::text`;

const TREND_COLUMNS = `nt.date::text, nt.trend_window, nt.density::float,
       nt.baseline_mean::float, nt.z_score::float, nt.percentile_rank::float,
       nt.change_value::float, nt.acceleration::float, nt.risk_tone::float,
       nt.bullish_tone::float, nt.eligible_documents, nt.matched_documents,
       nt.publisher_breadth, nt.publisher_owner_breadth, nt.story_breadth,
       nt.source_class_breadth, nt.entity_breadth,
       nt.corpus_eligible_documents, nt.classified_documents,
       nt.classification_coverage_pct::float, nt.coverage_state, nt.low_history,
       nt.baseline_windows, nt.attention_density::float,
       nt.attention_matched_documents, nt.attention_z_score::float,
       nt.peak_density::float, nt.peak_date::text, nt.days_since_peak,
       nt.percent_of_peak::float, nt.lifecycle_state`;

const EVIDENCE_STORY_FINGERPRINT = `coalesce(
  nullif(d.near_duplicate_key, ''),
  nullif(d.metadata->>'wireStoryId', ''),
  md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
)`;

function mapTrendMetrics(
  row: TrendRow | undefined,
  latestDate: string | null
): Omit<NarrativeTrendSummary, keyof NarrativeDefinition | "history" | "evidence"> {
  return {
    trendWindow: "7d",
    latestDate: row?.date ?? latestDate,
    density: Number(row?.density ?? 0),
    baselineMean: Number(row?.baseline_mean ?? 0),
    zScore: Number(row?.z_score ?? 0),
    percentileRank: Number(row?.percentile_rank ?? 0),
    change: Number(row?.change_value ?? 0),
    acceleration: Number(row?.acceleration ?? 0),
    riskTone: Number(row?.risk_tone ?? 0),
    bullishTone: Number(row?.bullish_tone ?? 0),
    eligibleDocuments: row?.eligible_documents ?? 0,
    matchedDocuments: row?.matched_documents ?? 0,
    publisherBreadth: row?.publisher_breadth ?? 0,
    publisherOwnerBreadth: row?.publisher_owner_breadth ?? 0,
    storyBreadth: row?.story_breadth ?? 0,
    sourceClassBreadth: row?.source_class_breadth ?? 0,
    entityBreadth: row?.entity_breadth ?? 0,
    lowHistory: row?.low_history ?? true,
    corpusDocuments: row?.corpus_eligible_documents ?? 0,
    classificationCoveragePercent: Number(row?.classification_coverage_pct ?? 0),
    coverageStatus: row?.coverage_state ?? "no_corpus",
    lifecycleState: row?.lifecycle_state ?? "unmeasured",
    baselineWindows: row?.baseline_windows ?? 0,
    attentionDensity: Number(row?.attention_density ?? 0),
    attentionMatchedDocuments: row?.attention_matched_documents ?? 0,
    attentionZScore: Number(row?.attention_z_score ?? 0),
    peakDensity: Number(row?.peak_density ?? 0),
    peakDate: row?.peak_date ?? null,
    daysSincePeak: row?.days_since_peak ?? null,
    percentOfPeak: Number(row?.percent_of_peak ?? 0)
  };
}

function mapTrendPoint(row: TrendRow): NarrativeTrendPoint {
  return {
    date: row.date,
    density: Number(row.density),
    baselineMean: Number(row.baseline_mean),
    zScore: Number(row.z_score),
    percentileRank: Number(row.percentile_rank),
    change: Number(row.change_value),
    acceleration: Number(row.acceleration),
    riskTone: Number(row.risk_tone),
    bullishTone: Number(row.bullish_tone),
    attentionDensity: Number(row.attention_density ?? 0),
    lifecycleState: row.lifecycle_state ?? "unmeasured"
  };
}

function mapEvidenceRow(row: NarrativeHomepageEvidenceRow): NarrativeEvidence {
  return {
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
    reviewStatus: row.review_status,
    storyFingerprint: row.story_fingerprint
  };
}

/**
 * Sort key for "what deserves attention": surprise first (attention z-score, which
 * includes pending classifier matches), then reviewed z-score, then unique-story breadth.
 */
export function compareBySurprise(
  left: Pick<NarrativeTrendSummary, "attentionZScore" | "zScore" | "storyBreadth" | "name">,
  right: Pick<NarrativeTrendSummary, "attentionZScore" | "zScore" | "storyBreadth" | "name">
) {
  return (
    right.attentionZScore - left.attentionZScore ||
    right.zScore - left.zScore ||
    right.storyBreadth - left.storyBreadth ||
    left.name.localeCompare(right.name)
  );
}

export function buildHomepageLanes(
  narratives: NarrativeHomepageItem[],
  latestDate: string | null,
  laneSize = HOMEPAGE_LANE_SIZE
): NarrativeHomepageStatus["lanes"] {
  const measured = narratives.filter(
    (item) =>
      item.coverageStatus === "measured" || item.coverageStatus === "measured_zero"
  );
  const bySurprise = [...measured].sort(compareBySurprise);
  const recentlyActivated = (item: NarrativeHomepageItem) =>
    Boolean(
      latestDate &&
        item.activatedAt &&
        daysBetween(item.activatedAt.slice(0, 10), latestDate) <= 7
    );
  const rising = bySurprise.filter((item) => item.lifecycleState === "rising");
  const peaking = bySurprise.filter((item) => item.lifecycleState === "peaking");
  const fading = [...measured]
    .filter((item) => item.lifecycleState === "fading")
    .sort(
      (left, right) =>
        left.change - right.change ||
        (right.daysSincePeak ?? 0) - (left.daysSincePeak ?? 0) ||
        left.name.localeCompare(right.name)
    );
  const emerging = [...narratives]
    .filter(
      (item) =>
        item.lifecycleState === "emerging" ||
        item.status === "probationary" ||
        recentlyActivated(item)
    )
    .filter((item) => !rising.includes(item) && !peaking.includes(item))
    .sort(
      (left, right) =>
        right.attentionMatchedDocuments - left.attentionMatchedDocuments ||
        right.attentionDensity - left.attentionDensity ||
        left.name.localeCompare(right.name)
    );
  return {
    rising: rising.slice(0, laneSize),
    peaking: peaking.slice(0, laneSize),
    fading: fading.slice(0, laneSize),
    emerging: emerging.slice(0, laneSize)
  };
}

export async function getNarrativeHomepageStatus(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeHomepageStatus> {
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v7";
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
    const overview = await client.query<{
      tracked_count: string;
      latest_date: string | null;
    }>(
      `select
         (select count(*)::text
            from narrative_definitions
            where status in ('active', 'probationary')) as tracked_count,
         (select nt.date::text
            from narrative_trends nt
            join narrative_definitions nd
              on nd.id = nt.narrative_definition_id
            where nt.prompt_version = $1
              and nt.trend_window = '7d'
              and nd.status in ('active', 'probationary')
            order by nt.date desc
            limit 1) as latest_date`,
      [promptVersion]
    );
    const trackedNarrativeCount = Number(overview.rows[0]?.tracked_count ?? 0);
    const latestDate = overview.rows[0]?.latest_date ?? null;
    let trendRows: Array<DefinitionRow & TrendRow> = [];
    if (latestDate) {
      const trends = await client.query<DefinitionRow & TrendRow>(
        `select ${DEFINITION_COLUMNS}, ${TREND_COLUMNS}
         from narrative_trends nt
         join narrative_definitions nd on nd.id = nt.narrative_definition_id
         left join narrative_definitions parent
           on parent.id = nd.parent_definition_id
         where nt.date = $2::date
           and nt.trend_window = '7d'
           and nt.prompt_version = $1
           and nd.status in ('active', 'probationary')
         order by nt.attention_z_score desc, nt.z_score desc,
                  nt.story_breadth desc, nd.id`,
        [promptVersion, latestDate]
      );
      trendRows = trends.rows;
    }
    const evidenceNarrativeIds = trendRows
      .filter((row) => row.matched_documents > 0)
      .slice(0, HOMEPAGE_EVIDENCE_NARRATIVES)
      .map((row) => row.id);
    let evidenceRows: NarrativeHomepageEvidenceRow[] = [];
    let evidenceDegraded = false;
    if (evidenceNarrativeIds.length > 0 && latestDate) {
      try {
        // Drive from the week's documents into approved matches (partial index on
        // matched rows) rather than scanning every observation for the top
        // narratives: ~0.5s instead of 20s+ once observations pass 100k rows.
        const evidence = await client.query<NarrativeHomepageEvidenceRow>(
          `with window_documents as materialized (
             select d.id, d.published_at,
                    ${EVIDENCE_STORY_FINGERPRINT} as story_fingerprint
             from documents d
             where d.published_at >= $3::date - interval '6 days'
               and d.published_at < $3::date + interval '1 day'
           ),
           latest_observations as (
             select distinct on (no.narrative_definition_id, no.document_id)
                    no.id, no.narrative_definition_id, no.document_id,
                    wd.published_at, no.matched,
                    no.match_score::float, no.review_status,
                    wd.story_fingerprint
             from window_documents wd
             join narrative_observations no
               on no.document_id = wd.id
              and no.matched
              and no.review_status = 'approved'
             where no.prompt_version = $1
               and no.narrative_definition_id = any($2::text[])
             order by no.narrative_definition_id, no.document_id,
                      no.observed_at desc, no.id
           ),
           unique_stories as (
             select id, narrative_definition_id, document_id,
                    published_at, match_score, story_fingerprint,
                    row_number() over (
                      partition by narrative_definition_id, story_fingerprint
                      order by published_at desc, match_score desc, id
                    ) as story_rank
             from latest_observations
             where matched and review_status = 'approved'
           ),
           ranked as (
             select id, narrative_definition_id, document_id,
                    story_fingerprint,
                    row_number() over (
                      partition by narrative_definition_id
                      order by published_at desc, match_score desc, id
                    ) as evidence_rank
             from unique_stories
             where story_rank = 1
           ),
           top_evidence as (
             select id, narrative_definition_id, document_id,
                    story_fingerprint, evidence_rank
             from ranked
             where evidence_rank <= 3
           )
           select no.id, top_evidence.narrative_definition_id,
                  d.title, d.publisher, d.published_at::text, d.url,
                  d.source_class, no.stance, no.evidence_snippet,
                  no.interpretation, no.affected_entities,
                  no.match_score::float, no.review_status,
                  top_evidence.story_fingerprint
           from top_evidence
           join narrative_observations no on no.id = top_evidence.id
           join documents d on d.id = top_evidence.document_id
           join document_texts dt on dt.document_id = d.id
           where no.matched
             and position(no.evidence_snippet in dt.content) > 0
           order by top_evidence.narrative_definition_id,
                    top_evidence.evidence_rank`,
          [promptVersion, evidenceNarrativeIds, latestDate]
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
      items.push(mapEvidenceRow(row));
      evidenceByNarrative.set(row.narrative_definition_id, items);
    }
    let brief: StoredBrief | null = null;
    try {
      brief = await getLatestStoredBrief(client);
    } catch (error) {
      console.warn(
        `[db] narrative homepage brief lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const narratives = trendRows.map(
      (row): NarrativeHomepageItem => ({
        ...mapDefinition(row),
        ...mapTrendMetrics(row, latestDate),
        evidencePreview: evidenceByNarrative.get(row.id) ?? []
      })
    );
    const measured = narratives
      .filter(
        (item) =>
          item.coverageStatus === "measured" ||
          item.coverageStatus === "measured_zero"
      )
      .sort(compareBySurprise);

    return {
      databaseConfigured: true,
      degraded: evidenceDegraded,
      latestDate,
      trackedNarrativeCount,
      narratives: measured,
      lanes: buildHomepageLanes(narratives, latestDate),
      brief
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

async function getLatestStoredBrief(
  client: ReturnType<typeof createDatabaseClient>
): Promise<StoredBrief | null> {
  const result = await client.query<{
    id: string;
    brief_date: string;
    headline: string;
    summary: string;
    sections: unknown;
    generated_at: string;
  }>(
    `select id, brief_date::text, headline, summary, sections, generated_at::text
     from briefs
     order by brief_date desc
     limit 1`
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    date: row.brief_date,
    headline: row.headline,
    summary: row.summary,
    sections: Array.isArray(row.sections)
      ? (row.sections as BriefSection[]).filter(
          (section) =>
            section &&
            typeof section.title === "string" &&
            Array.isArray(section.items)
        )
      : [],
    generatedAt: row.generated_at
  };
}

export async function getLatestBrief(
  databaseUrl = process.env.DATABASE_URL
): Promise<StoredBrief | null> {
  if (!databaseUrl) return null;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    return await getLatestStoredBrief(client);
  } finally {
    await client.end();
  }
}

export async function getNarrativeBoardStatus(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeBoardStatus> {
  if (!databaseUrl) return { databaseConfigured: false, latestDate: null, narratives: [] };
  return loadNarrativeBoard({ databaseUrl, configuredPromptVersion });
}

async function loadNarrativeBoard(options: {
  databaseUrl: string;
  configuredPromptVersion?: string;
  definitionIds?: string[];
}): Promise<NarrativeBoardStatus> {
  const promptVersion =
    options.configuredPromptVersion ?? "narrative_classification_v7";
  const client = createDatabaseClient(options.databaseUrl, {
    queryTimeoutMs: NARRATIVE_BOARD_QUERY_TIMEOUT_MS,
    statementTimeoutMs: NARRATIVE_BOARD_QUERY_TIMEOUT_MS
  });
  await client.connect();
  try {
    const definitions = await client.query<DefinitionRow>(
      `select ${DEFINITION_COLUMNS}
       from narrative_definitions nd
       left join narrative_definitions parent
         on parent.id = nd.parent_definition_id
       where nd.status in ('active', 'probationary')
         and ($1::text[] is null or nd.id = any($1::text[]))
       order by coalesce(parent.name, nd.name), nd.dimension nulls first, nd.name`,
      [options.definitionIds ?? null]
    );
    if (definitions.rows.length === 0) {
      return { databaseConfigured: true, latestDate: null, narratives: [] };
    }
    const definitionIds = definitions.rows.map((row) => row.id);
    const latest = await client.query<{ date: string | null }>(
      "select max(date)::text as date from narrative_trends where prompt_version = $1",
      [promptVersion]
    );
    const latestDate = latest.rows[0]?.date ?? null;
    const history = await client.query<TrendRow & { narrative_definition_id: string }>(
      `select nt.narrative_definition_id, ${TREND_COLUMNS}
       from narrative_trends nt
       where nt.narrative_definition_id = any($1::text[])
         and nt.trend_window = '7d'
         and nt.prompt_version = $2
         and ($3::date is null or nt.date > $3::date - interval '90 days')
       order by nt.narrative_definition_id, nt.date asc`,
      [definitionIds, promptVersion, latestDate]
    );
    const historyByDefinition = new Map<string, TrendRow[]>();
    for (const row of history.rows) {
      const rows = historyByDefinition.get(row.narrative_definition_id) ?? [];
      rows.push(row);
      historyByDefinition.set(row.narrative_definition_id, rows);
    }
    const evidenceVersions = resolveCompatibleClassificationPromptVersions(promptVersion);
    const evidenceVersionSql = observationVersionSql(evidenceVersions, "$2", "$3");
    // With a single prompt version the unique key (definition, document, model,
    // version) already yields one observation per document, so "latest" is the row
    // itself and the approved filter can be applied first: the partial review-queue
    // index returns the few approved rows instead of scanning every observation for
    // the tracked definitions (125k+ rows and growing ~12k/hour). Only when compatible
    // versions are configured must the newest row be resolved before filtering.
    const latestObservationsCte =
      evidenceVersions.length === 1
        ? `select *
           from narrative_observations
           where narrative_definition_id = any($1::text[])
             and ${evidenceVersionSql.predicate}
             and matched
             and review_status = 'approved'`
        : `select distinct on (narrative_definition_id, document_id) *
           from narrative_observations
           where narrative_definition_id = any($1::text[])
             and ${evidenceVersionSql.predicate}
           order by narrative_definition_id, document_id, ${evidenceVersionSql.order}`;
    const evidence = await client.query<NarrativeHomepageEvidenceRow>(
      `with latest_observations as (
         ${latestObservationsCte}
       ),
       evidence_with_story as (
         select no.id, no.narrative_definition_id, d.title, d.publisher,
                d.published_at, d.url, d.source_class, no.stance,
                no.evidence_snippet, no.interpretation, no.affected_entities,
                no.match_score, no.review_status,
                ${EVIDENCE_STORY_FINGERPRINT} as story_fingerprint
         from latest_observations no
         join documents d on d.id = no.document_id
         join document_texts dt on dt.document_id = d.id
         where no.matched
           and no.review_status = 'approved'
           and position(no.evidence_snippet in dt.content) > 0
       ),
       ranked as (
         select *,
                row_number() over (
                  partition by narrative_definition_id, story_fingerprint
                  order by published_at desc, match_score desc, id
                ) as story_rank
         from evidence_with_story
       ),
       per_definition as (
         select *,
                row_number() over (
                  partition by narrative_definition_id
                  order by published_at desc, match_score desc, id
                ) as evidence_rank
         from ranked
         where story_rank = 1
       )
       select id, narrative_definition_id, title, publisher,
              published_at::text, url, source_class, stance,
              evidence_snippet, interpretation, affected_entities,
              match_score::float, review_status, story_fingerprint
       from per_definition
       where evidence_rank <= 12
       order by narrative_definition_id, evidence_rank`,
      [definitionIds, evidenceVersions, promptVersion]
    );
    const evidenceByDefinition = new Map<string, NarrativeEvidence[]>();
    for (const row of evidence.rows) {
      const rows = evidenceByDefinition.get(row.narrative_definition_id) ?? [];
      rows.push(mapEvidenceRow(row));
      evidenceByDefinition.set(row.narrative_definition_id, rows);
    }

    const narratives: NarrativeTrendSummary[] = definitions.rows.map((row) => {
      const rows = historyByDefinition.get(row.id) ?? [];
      const current = rows.at(-1);
      return {
        ...mapDefinition(row),
        ...mapTrendMetrics(current, null),
        history: rows.map(mapTrendPoint),
        evidence: evidenceByDefinition.get(row.id) ?? []
      };
    });

    return {
      databaseConfigured: true,
      latestDate,
      narratives: narratives.sort((left, right) => {
        const leftMeasured =
          left.coverageStatus === "measured" || left.coverageStatus === "measured_zero";
        const rightMeasured =
          right.coverageStatus === "measured" || right.coverageStatus === "measured_zero";
        return (
          Number(rightMeasured) - Number(leftMeasured) ||
          compareBySurprise(left, right)
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
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
) {
  if (!databaseUrl) return null;
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  let definitionId: string | null;
  try {
    const result = await client.query<{ id: string }>(
      `select id
       from narrative_definitions
       where (id = $1 or slug = $1)
         and status in ('active', 'probationary')
       order by version desc
       limit 1`,
      [idOrSlug]
    );
    definitionId = result.rows[0]?.id ?? null;
  } finally {
    await client.end();
  }
  if (!definitionId) return null;
  const board = await loadNarrativeBoard({
    databaseUrl,
    configuredPromptVersion,
    definitionIds: [definitionId]
  });
  return board.narratives[0] ?? null;
}

const LIFECYCLE_STATES: NarrativeLifecycleState[] = [
  "unmeasured",
  "dormant",
  "emerging",
  "rising",
  "peaking",
  "steady",
  "fading"
];

export type ChangeSnapshotRow = DefinitionRow & {
  current_density: number | null;
  current_state: NarrativeLifecycleState | null;
  current_attention_z: number | null;
  current_coverage: NarrativeTrendSummary["coverageStatus"] | null;
  previous_density: number | null;
  previous_state: NarrativeLifecycleState | null;
  previous_coverage: NarrativeTrendSummary["coverageStatus"] | null;
};

/**
 * Compares the two most recent published 7-day measurements and reports what changed:
 * lifecycle transitions, narratives entering or leaving the measured board, the largest
 * density moves, and definitions activated or expired since the previous measurement.
 */
export async function getNarrativeChangeReport(
  databaseUrl = process.env.DATABASE_URL,
  configuredPromptVersion = process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION
): Promise<NarrativeChangeReport> {
  const empty = (databaseConfigured: boolean): NarrativeChangeReport => ({
    databaseConfigured,
    currentDate: null,
    previousDate: null,
    changes: [],
    stateCounts: Object.fromEntries(
      LIFECYCLE_STATES.map((state) => [state, 0])
    ) as Record<NarrativeLifecycleState, number>
  });
  if (!databaseUrl) return empty(false);
  const promptVersion =
    configuredPromptVersion ?? "narrative_classification_v7";
  const client = createDatabaseClient(databaseUrl, {
    queryTimeoutMs: NARRATIVE_BOARD_QUERY_TIMEOUT_MS,
    statementTimeoutMs: NARRATIVE_BOARD_QUERY_TIMEOUT_MS
  });
  await client.connect();
  try {
    const dates = await client.query<{ date: string }>(
      `select distinct nt.date::text as date
       from narrative_trends nt
       where nt.prompt_version = $1 and nt.trend_window = '7d'
       order by date desc
       limit 2`,
      [promptVersion]
    );
    const currentDate = dates.rows[0]?.date ?? null;
    const previousDate = dates.rows[1]?.date ?? null;
    if (!currentDate) return empty(true);
    const rows = await client.query<ChangeSnapshotRow>(
      `select ${DEFINITION_COLUMNS},
              cur.density::float as current_density,
              cur.lifecycle_state as current_state,
              cur.attention_z_score::float as current_attention_z,
              cur.coverage_state as current_coverage,
              prev.density::float as previous_density,
              prev.lifecycle_state as previous_state,
              prev.coverage_state as previous_coverage
       from narrative_definitions nd
       left join narrative_definitions parent
         on parent.id = nd.parent_definition_id
       left join narrative_trends cur
         on cur.narrative_definition_id = nd.id
        and cur.trend_window = '7d'
        and cur.prompt_version = $1
        and cur.date = $2::date
       left join narrative_trends prev
         on prev.narrative_definition_id = nd.id
        and prev.trend_window = '7d'
        and prev.prompt_version = $1
        and $3::date is not null
        and prev.date = $3::date
       where nd.status in ('active', 'probationary', 'expired')
         and (cur.id is not null or prev.id is not null
              or nd.updated_at >= $2::date - interval '1 day')`,
      [promptVersion, currentDate, previousDate]
    );
    return {
      ...deriveNarrativeChanges(rows.rows, currentDate, previousDate),
      databaseConfigured: true
    };
  } finally {
    await client.end();
  }
}

export function deriveNarrativeChanges(
  rows: ChangeSnapshotRow[],
  currentDate: string,
  previousDate: string | null
): Omit<NarrativeChangeReport, "databaseConfigured"> {
  const changes: NarrativeChange[] = [];
  const stateCounts = Object.fromEntries(
    LIFECYCLE_STATES.map((state) => [state, 0])
  ) as Record<NarrativeLifecycleState, number>;
  const measured = (state: NarrativeTrendSummary["coverageStatus"] | null) =>
    state === "measured" || state === "measured_zero";

  for (const row of rows) {
    const base = {
      narrativeDefinitionId: row.id,
      slug: row.slug,
      name: row.name,
      proposition: row.proposition,
      category: row.category,
      kindLabel: row.kind ?? ("structural" as const),
      previousState: row.previous_state,
      currentState: row.current_state,
      previousDensity: row.previous_density,
      currentDensity: row.current_density,
      attentionZScore: row.current_attention_z,
      change:
        row.current_density !== null && row.previous_density !== null
          ? Math.round((row.current_density - row.previous_density) * 100) / 100
          : 0
    };
    if (row.current_state && measured(row.current_coverage)) {
      stateCounts[row.current_state] += 1;
    } else if (row.status !== "expired") {
      stateCounts.unmeasured += 1;
    }
    if (row.status === "expired") {
      changes.push({
        ...base,
        kind: "expired_definition",
        detail: "Event narrative reached its publication expiry and left the board."
      });
      continue;
    }
    if (row.activated_at && row.activated_at.slice(0, 10) >= (previousDate ?? currentDate)) {
      changes.push({
        ...base,
        kind: "new_definition",
        detail: `Activated on ${row.activated_at.slice(0, 10)} and now published on the board.`
      });
    }
    const nowMeasured = measured(row.current_coverage);
    const wasMeasured = measured(row.previous_coverage);
    if (nowMeasured && !wasMeasured && previousDate) {
      changes.push({
        ...base,
        kind: "entered_board",
        detail: "Coverage became complete; the narrative is measured for the first time in this window."
      });
    } else if (!nowMeasured && wasMeasured) {
      changes.push({
        ...base,
        kind: "left_board",
        detail: "Coverage is no longer complete for the current window; movement is suppressed."
      });
    }
    if (
      nowMeasured &&
      wasMeasured &&
      row.current_state &&
      row.previous_state &&
      row.current_state !== row.previous_state
    ) {
      changes.push({
        ...base,
        kind: "state_change",
        detail: `${labelState(row.previous_state)} → ${labelState(row.current_state)}.`
      });
    } else if (nowMeasured && wasMeasured && Math.abs(base.change) >= 1) {
      changes.push({
        ...base,
        kind: "mover",
        detail: `${base.change > 0 ? "Up" : "Down"} ${Math.abs(base.change).toFixed(1)} density points versus the previous measurement.`
      });
    }
  }

  const priority: Record<NarrativeChangeKind, number> = {
    new_definition: 0,
    state_change: 1,
    entered_board: 2,
    expired_definition: 3,
    left_board: 4,
    mover: 5
  };
  changes.sort(
    (left, right) =>
      priority[left.kind] - priority[right.kind] ||
      Math.abs(right.change) - Math.abs(left.change) ||
      left.name.localeCompare(right.name)
  );
  return { currentDate, previousDate, changes, stateCounts };
}

export function labelState(state: NarrativeLifecycleState | null) {
  switch (state) {
    case "rising":
      return "Rising";
    case "peaking":
      return "Peaking";
    case "fading":
      return "Fading";
    case "emerging":
      return "Emerging";
    case "steady":
      return "Steady";
    case "dormant":
      return "Dormant";
    case "unmeasured":
    default:
      return "Unmeasured";
  }
}

function daysBetween(start: string, end: string) {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.round((endMs - startMs) / 86_400_000);
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
    narratives: [],
    lanes: { rising: [], peaking: [], fading: [], emerging: [] },
    brief: null
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
  metadata: Record<string, unknown>;
  parent_definition_id: string | null;
  merged_into_definition_id: string | null;
  parent_name: string | null;
  dimension: string | null;
  event_expires_at: string | null;
  activated_at: string | null;
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
    eventLabel: row.event_label,
    metadata: row.metadata,
    parentDefinitionId: row.parent_definition_id,
    parentName: row.parent_name,
    mergedIntoDefinitionId: row.merged_into_definition_id,
    dimension: row.dimension,
    eventExpiresAt: row.event_expires_at,
    activatedAt: row.activated_at
  };
}

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
