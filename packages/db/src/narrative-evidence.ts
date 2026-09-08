import { createDatabaseClient } from "./persistence";
import type { NarrativeTrendSummary, TrendWindow } from "./types";

export type NarrativeEvidencePage = {
  items: NarrativeTrendSummary["evidence"];
  hasMore: boolean;
};
export async function getNarrativeEvidence(
  options: {
    id: string;
    date: string;
    window: TrendWindow;
    source?: string;
    tone?: string;
    page?: number;
  },
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeEvidencePage> {
  if (!databaseUrl) return { items: [], hasMore: false };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(options.date) ||
    !Number.isFinite(Date.parse(options.date))
  )
    throw new Error("Invalid evidence date.");
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const rows = await client.query<NarrativeTrendSummary["evidence"][number]>(
      `
      with latest as (
        select distinct on (document_id) * from narrative_observations
        where narrative_definition_id = $1 and prompt_version = $2
        order by document_id, observed_at desc, id desc
      )
      select no.id, d.title, d.publisher, d.published_at::text as "publishedAt", d.url,
        d.source_class as "sourceClass", no.stance, no.evidence_snippet as "evidenceSnippet",
        no.interpretation, no.affected_entities as "affectedEntities", no.match_score::float as "matchScore",
        no.review_status as "reviewStatus"
      from latest no join documents d on d.id = no.document_id
      join document_texts dt on dt.document_id = d.id
      join narrative_definitions nd on nd.id = no.narrative_definition_id
      where no.matched and no.review_status = 'approved'
        and nd.status = 'active' and d.retention_policy <> 'metadata_only'
        and no.metadata->>'textHash' = dt.content_hash
        and no.metadata->>'definitionVersion' = nd.version::text
        and d.published_at >= $3::date - ($4::integer - 1) * interval '1 day'
        and d.published_at < $3::date + interval '1 day'
        and ($5::text is null or d.source_class = $5)
        and ($6::text is null or no.stance = $6)
      order by d.published_at desc, no.id
      limit 25 offset $7`,
      [
        options.id,
        process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
          "narrative_classification_v6",
        options.date,
        options.window === "30d" ? 30 : 7,
        options.source === "all" ? null : (options.source ?? null),
        options.tone === "all" ? null : (options.tone ?? null),
        Math.max(0, Math.min(10000, Math.floor(options.page ?? 0))) * 24
      ]
    );
    return { items: rows.rows.slice(0, 24), hasMore: rows.rows.length > 24 };
  } finally {
    await client.end();
  }
}
