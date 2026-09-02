import { createDatabaseClient } from "./persistence";
import type { AttentionBurstRecord, AttentionBurstWatchlist } from "./types";

export type BurstCorpusRow = {
  documentId: string;
  date: string;
  title: string;
  storyFingerprint: string;
  publisherOwner: string;
  entities: string[];
  themeLabels: string[];
};

export type AttentionBurstInput = Omit<
  AttentionBurstRecord,
  "id" | "date" | "coveringNarrativeDefinitionIds" | "coveringNarrativeNames"
> & {
  coveringNarrativeDefinitionIds?: string[];
};

const STORY_FINGERPRINT_SQL = `coalesce(
  nullif(d.near_duplicate_key, ''),
  nullif(d.metadata->>'wireStoryId', ''),
  md5(lower(regexp_replace(d.title, '[^a-z0-9]+', ' ', 'g')))
)`;

/**
 * Loads every document (regardless of retention policy: titles are always available) in
 * the trailing window together with extracted entities and canonical theme labels.
 */
export async function loadBurstCorpus(
  options: { asOfDate: string; lookbackDays: number },
  databaseUrl = process.env.DATABASE_URL
): Promise<BurstCorpusRow[]> {
  if (!databaseUrl) return [];
  const client = createDatabaseClient(databaseUrl, {
    queryTimeoutMs: 120_000,
    statementTimeoutMs: 120_000
  });
  await client.connect();
  try {
    const result = await client.query<{
      document_id: string;
      date: string;
      title: string;
      story_fingerprint: string;
      publisher_owner: string;
      entities: string[] | null;
      theme_labels: string[] | null;
    }>(
      `select d.id as document_id,
              (d.published_at at time zone 'UTC')::date::text as date,
              d.title,
              ${STORY_FINGERPRINT_SQL} as story_fingerprint,
              coalesce(nullif(d.publisher_owner, ''), nullif(d.publisher_id, ''), d.publisher) as publisher_owner,
              (select array_agg(distinct entity)
                 from (
                   select unnest(s.affected_entities) as entity
                   from signals s where s.document_id = d.id
                   union
                   select unnest(no.affected_entities)
                   from narrative_observations no
                   where no.document_id = d.id and no.matched
                 ) e) as entities,
              (select array_agg(distinct label)
                 from (
                   select nullif(s.canonical_theme_label, '') as label
                   from signals s where s.document_id = d.id
                 ) l where label is not null) as theme_labels
       from documents d
       where d.published_at >= $1::date - ($2::int * interval '1 day')
         and d.published_at < $1::date + interval '1 day'
         and d.title <> ''`,
      [options.asOfDate, options.lookbackDays]
    );
    return result.rows.map((row) => ({
      documentId: row.document_id,
      date: row.date,
      title: row.title,
      storyFingerprint: row.story_fingerprint,
      publisherOwner: row.publisher_owner ?? "",
      entities: row.entities ?? [],
      themeLabels: row.theme_labels ?? []
    }));
  } finally {
    await client.end();
  }
}

/**
 * Replaces the burst set for a date. Terms are cross-referenced with tracked narrative
 * names, propositions, and guidance so the watchlist can separate "already covered" from
 * "nobody is tracking this yet".
 */
export async function persistAttentionBursts(
  date: string,
  bursts: AttentionBurstInput[],
  databaseUrl = process.env.DATABASE_URL
) {
  if (!databaseUrl) return { written: 0 };
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const definitions = await client.query<{ id: string; haystack: string }>(
      `select id,
              lower(concat_ws(' ', name, proposition, inclusion_guidance,
                              array_to_string(positive_examples, ' '))) as haystack
       from narrative_definitions
       where status in ('active', 'probationary')`
    );
    await client.query("begin");
    await client.query("delete from attention_bursts where burst_date = $1::date", [date]);
    let written = 0;
    for (const burst of bursts) {
      const covering =
        burst.coveringNarrativeDefinitionIds ??
        definitions.rows
          .filter((row) => row.haystack.includes(burst.term))
          .map((row) => row.id);
      await client.query(
        `insert into attention_bursts (
           id, burst_date, term, kind, current_stories, current_owners,
           baseline_mean, baseline_scale, baseline_windows, z_score, novel, score,
           sample_document_ids, sample_titles, covering_narrative_definition_ids
         ) values (
           $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13::text[], $14::text[], $15::text[]
         )
         on conflict (burst_date, term) do update set
           kind = excluded.kind,
           current_stories = excluded.current_stories,
           current_owners = excluded.current_owners,
           baseline_mean = excluded.baseline_mean,
           baseline_scale = excluded.baseline_scale,
           baseline_windows = excluded.baseline_windows,
           z_score = excluded.z_score,
           novel = excluded.novel,
           score = excluded.score,
           sample_document_ids = excluded.sample_document_ids,
           sample_titles = excluded.sample_titles,
           covering_narrative_definition_ids = excluded.covering_narrative_definition_ids`,
        [
          `burst:${date}:${burst.term}`,
          date,
          burst.term,
          burst.kind,
          burst.currentStories,
          burst.currentOwners,
          burst.baselineMean,
          burst.baselineScale,
          burst.baselineWindows,
          burst.zScore,
          burst.novel,
          burst.score,
          burst.sampleDocumentIds,
          burst.sampleTitles,
          covering
        ]
      );
      written += 1;
    }
    await client.query("commit");
    return { written };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export async function getAttentionBurstWatchlist(
  options: { date?: string; limit?: number; uncoveredOnly?: boolean } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<AttentionBurstWatchlist> {
  if (!databaseUrl) {
    return { databaseConfigured: false, date: null, bursts: [], uncoveredCount: 0 };
  }
  const client = createDatabaseClient(databaseUrl, {
    queryTimeoutMs: 10_000,
    statementTimeoutMs: 10_000
  });
  await client.connect();
  try {
    const latest = options.date
      ? { rows: [{ date: options.date }] }
      : await client.query<{ date: string | null }>(
          "select max(burst_date)::text as date from attention_bursts"
        );
    const date = latest.rows[0]?.date ?? null;
    if (!date) {
      return { databaseConfigured: true, date: null, bursts: [], uncoveredCount: 0 };
    }
    const result = await client.query<{
      id: string;
      burst_date: string;
      term: string;
      kind: AttentionBurstRecord["kind"];
      current_stories: number;
      current_owners: number;
      baseline_mean: number;
      baseline_scale: number;
      baseline_windows: number;
      z_score: number;
      novel: boolean;
      score: number;
      sample_document_ids: string[];
      sample_titles: string[];
      covering_narrative_definition_ids: string[];
      covering_names: string[] | null;
    }>(
      `select ab.id, ab.burst_date::text, ab.term, ab.kind, ab.current_stories,
              ab.current_owners, ab.baseline_mean::float, ab.baseline_scale::float,
              ab.baseline_windows, ab.z_score::float, ab.novel, ab.score::float,
              ab.sample_document_ids, ab.sample_titles,
              ab.covering_narrative_definition_ids,
              (select array_agg(nd.name order by nd.name)
                 from narrative_definitions nd
                 where nd.id = any(ab.covering_narrative_definition_ids)) as covering_names
       from attention_bursts ab
       where ab.burst_date = $1::date
         and ($3::boolean is false or cardinality(ab.covering_narrative_definition_ids) = 0)
       order by ab.score desc, ab.current_owners desc, ab.term
       limit $2`,
      [date, options.limit ?? 40, options.uncoveredOnly ?? false]
    );
    const uncovered = await client.query<{ count: string }>(
      `select count(*)::text as count
       from attention_bursts
       where burst_date = $1::date and cardinality(covering_narrative_definition_ids) = 0`,
      [date]
    );
    return {
      databaseConfigured: true,
      date,
      uncoveredCount: Number(uncovered.rows[0]?.count ?? 0),
      bursts: result.rows.map((row) => ({
        id: row.id,
        date: row.burst_date,
        term: row.term,
        kind: row.kind,
        currentStories: row.current_stories,
        currentOwners: row.current_owners,
        baselineMean: Number(row.baseline_mean),
        baselineScale: Number(row.baseline_scale),
        baselineWindows: row.baseline_windows,
        zScore: Number(row.z_score),
        novel: row.novel,
        score: Number(row.score),
        sampleDocumentIds: row.sample_document_ids,
        sampleTitles: row.sample_titles,
        coveringNarrativeDefinitionIds: row.covering_narrative_definition_ids,
        coveringNarrativeNames: row.covering_names ?? []
      }))
    };
  } finally {
    await client.end();
  }
}
