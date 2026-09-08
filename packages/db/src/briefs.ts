import { createDatabaseClient } from "./persistence";
import { getNarrativeBoardStatus } from "./narratives";

type BriefEvidence = {
  narrativeId: string;
  name: string;
  density: number;
  change: number;
  citations: Array<{
    title: string;
    url: string;
    quote: string;
    publisher: string;
  }>;
};
export type StoredBrief = {
  date: string;
  headline: string;
  summary: string;
  measurementDate: string | null;
  generatedAt: string;
  evidence: BriefEvidence[];
};

export async function generateDailyNarrativeBrief() {
  const board = await getNarrativeBoardStatus();
  if (!board.databaseConfigured || !board.latestDate)
    throw new Error("No narrative measurements are available for the brief.");
  const evidence: BriefEvidence[] = board.narratives
    .filter(
      (n) =>
        n.coverageComplete &&
        n.comparisonReady &&
        !n.measurementPending &&
        n.evidence.length
    )
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5)
    .map((n) => ({
      narrativeId: n.id,
      name: n.name,
      density: n.density,
      change: n.change,
      citations: n.evidence.slice(0, 3).map((item) => ({
        title: item.title,
        url: item.url,
        quote: item.evidenceSnippet,
        publisher: item.publisher
      }))
    }));
  const headline = evidence.length
    ? "Changes in reviewed market narratives"
    : "Coverage is not ready for a comparative brief";
  const summary = evidence.length
    ? evidence
        .map(
          (item) =>
            `${item.name}: ${item.density.toFixed(1)}% density, ${item.change >= 0 ? "+" : ""}${item.change.toFixed(1)} percentage points versus the preceding seven days.`
        )
        .join(" ")
    : "No narrative has complete reviewed coverage, a comparable prior window, and a supporting citation. Complete review and source coverage before interpreting movement.";
  const client = createDatabaseClient();
  await client.connect();
  try {
    const date = new Date().toISOString().slice(0, 10);
    await client.query(
      `insert into briefs (id, brief_date, headline, summary, evidence, measurement_date, prompt_version)
      values ($1,$2,$3,$4,$5::jsonb,$6,$7) on conflict (brief_date) do update set
      headline = excluded.headline, summary = excluded.summary, evidence = excluded.evidence,
      measurement_date = excluded.measurement_date, prompt_version = excluded.prompt_version, generated_at = now()`,
      [
        `brief:${date}`,
        date,
        headline,
        summary,
        JSON.stringify(evidence),
        board.latestDate,
        process.env.NARRATIVE_CLASSIFICATION_PROMPT_VERSION ??
          "narrative_classification_v6"
      ]
    );
    return { date, headline, summary };
  } finally {
    await client.end();
  }
}
export async function getDailyBriefArchive(
  databaseUrl = process.env.DATABASE_URL
): Promise<StoredBrief[]> {
  if (!databaseUrl) return [];
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    return (
      await client.query<StoredBrief>(`select brief_date::text as date, headline, summary, measurement_date::text as "measurementDate",
      generated_at::text as "generatedAt", evidence from briefs where measurement_date is not null order by brief_date desc limit 30`)
    ).rows;
  } finally {
    await client.end();
  }
}
