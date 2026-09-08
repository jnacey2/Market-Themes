import { randomUUID } from "node:crypto";
import { createDatabaseClient } from "./persistence";
import type { AnalysisDocument } from "./types";

export async function claimNarrativeClassification(
  document: AnalysisDocument,
  model: string,
  promptVersion: string
) {
  const client = createDatabaseClient();
  await client.connect();
  const leaseId = randomUUID();
  try {
    const result = await client.query(
      `insert into narrative_classification_jobs
      (document_id, model, prompt_version, text_hash, lease_id, lease_until)
      values ($1,$2,$3,$4,$5,now() + interval '20 minutes')
      on conflict (document_id, model, prompt_version) do update set
        status = 'running', lease_id = excluded.lease_id, lease_until = excluded.lease_until,
        text_hash = excluded.text_hash,
        attempts = case when narrative_classification_jobs.status = 'completed' or narrative_classification_jobs.text_hash <> excluded.text_hash then 1
          else narrative_classification_jobs.attempts + 1 end,
        last_error = null, updated_at = now()
      where (narrative_classification_jobs.status <> 'running' or narrative_classification_jobs.lease_until < now())
        and (narrative_classification_jobs.status = 'completed' or narrative_classification_jobs.text_hash <> excluded.text_hash or
          (narrative_classification_jobs.attempts < 5 and coalesce(narrative_classification_jobs.retry_at, now()) <= now()))
      returning lease_id`,
      [document.id, model, promptVersion, document.textHash, leaseId]
    );
    return result.rowCount ? leaseId : null;
  } finally {
    await client.end();
  }
}

export async function failNarrativeClassification(
  leaseId: string,
  error: unknown
) {
  const client = createDatabaseClient();
  await client.connect();
  try {
    await client.query(
      `update narrative_classification_jobs set status = 'failed',
      last_error = $2, retry_at = now() + (least(attempts * attempts, 60) * interval '1 minute'), updated_at = now()
      where lease_id = $1 and status = 'running'`,
      [leaseId, error instanceof Error ? error.message : String(error)]
    );
  } finally {
    await client.end();
  }
}
