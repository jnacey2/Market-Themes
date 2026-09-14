/** Narrow, explainable checks for recurring unsupported inference. These return
 * review reasons, never manufacture a corrected investment conclusion. */
export function evidenceQualityReasons(quote: string, interpretation: string, proposition = ""): string[] {
  const reasons: string[] = [];
  const conclusion = `${interpretation} ${proposition}`;
  if (/\b(10b5-1|stock.sale|sell.{0,35}shares|sale.{0,35}stock|liquidat)/i.test(quote) &&
      /\b(conviction|confidence|underpric|appreciat|returns|monetiz|valuation)/i.test(conclusion)) {
    reasons.push("A share-sale plan or its cancellation does not establish expected returns or insider motivation.");
  }
  if (/\b(investor demand|listing|depositary receipts|initial public offering|IPO)\b/i.test(quote) &&
      /\b(infrastructure demand|compute demand|AI.*demand)/i.test(conclusion) &&
      !/\b(backlog|utilization|orders|megawatts|capacity deployed|revenue grew)\b/i.test(quote)) {
    reasons.push("Demand for securities is not evidence of demand for operating capacity.");
  }
  if (quote.trim().split(/\s+/).length < 7 && !/\d|\b(rose|grew|doubled|fell|declined|increased)\b/i.test(quote) && /\b(demand|growth|revenue|returns)\b/i.test(conclusion)) {
    reasons.push("The quotation is too fragmentary to establish the claimed business change.");
  }
  return reasons;
}

import { randomUUID } from "node:crypto";
import { createDatabaseClient } from "./persistence";

/** Recheck recent automatic decisions. Human reviews are never overwritten. */
export async function auditNarrativeEvidenceQuality(databaseUrl = process.env.DATABASE_URL, now = new Date()) {
  const client = createDatabaseClient(databaseUrl, { queryTimeoutMs: 65000, statementTimeoutMs: 60000 });
  await client.connect();
  let rejected = 0;
  try {
    const rows = await client.query<{ id: string; evidence_snippet: string; interpretation: string; proposition: string; review_status: string }>(
      `select no.id,no.evidence_snippet,no.interpretation,nd.proposition,no.review_status
       from narrative_observations no join narrative_definitions nd on nd.id=no.narrative_definition_id
       join documents d on d.id=no.document_id
       where no.matched and no.review_status in ('pending','approved')
         and no.prompt_version=$1 and d.published_at >= $2::timestamptz-interval '30 days' and d.published_at <= $2::timestamptz
         and no.metadata#>>'{reviewProvenance,actorType}' is distinct from 'human'
       order by d.published_at desc limit 2000`,
      [process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ?? 'narrative_classification_v7',now.toISOString()]);
    for (const row of rows.rows) {
      const reasons = evidenceQualityReasons(row.evidence_snippet,row.interpretation,row.proposition);
      if (!reasons.length) continue;
      const note = `Evidence quality audit v1: ${reasons.join(" ")}`;
      await client.query('begin');
      try {
        const changed = await client.query(`update narrative_observations
          set review_status='rejected',review_note=$2,reviewed_at=now(),
            metadata=(metadata-'autoReview') || jsonb_build_object('reviewProvenance',jsonb_build_object('actorType','automatic','policy','evidence_quality_v1'))
          where id=$1 and review_status=$3 and metadata#>>'{reviewProvenance,actorType}' is distinct from 'human'
          returning id`,[row.id,note,row.review_status]);
        if (changed.rowCount) {
          await client.query(`insert into narrative_review_events(id,observation_id,observation_key,previous_status,new_status,actor_type,review_note,metadata)
            values($1,$2,$2,$3,'rejected','system',$4,'{"policy":"evidence_quality_v1"}'::jsonb)`,
          [`narrative:quality:${randomUUID()}`,row.id,row.review_status,note]);
          rejected++;
        }
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; }
    }
    return { evaluated:rows.rows.length,rejected };
  } finally { await client.end(); }
}
