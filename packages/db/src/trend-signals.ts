import type pg from "pg";
import type { SourceClass } from "./types";

export type SignalTrendInput = {
  signalId: string;
  documentId: string;
  themeId: string;
  themeLabel: string;
  trendLevel: "market" | "sector" | "unmapped";
  signalDate: string;
  sourceClass: SourceClass;
  affectedEntities: string[];
  scoreContribution: number;
};

const DOCUMENT_BATCH_SIZE = 250;

/** Uses a dedicated, UTC connection outside a transaction. Each signal query is
 * bounded, while repeatable read preserves the former single-query snapshot.
 */
export async function loadSignalsForTrendComputation(
  client: pg.Client,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>
): Promise<SignalTrendInput[]> {
  await client.query("begin isolation level repeatable read read only");
  try {
    // Keep published_at bare so its index and column statistics are usable.
    // Casting it to date badly underestimated the year-long production window.
    const documents = await client.query<{ id: string; signalDate: string; sourceClass: SourceClass }>(
      `select id, published_at::date::text as "signalDate", source_class as "sourceClass" from documents
       where published_at >= $1::date
         and published_at < $2::date + interval '1 day'
       order by id`,
      [startDate, endDate]
    );
    const themes = await client.query<{ id: string; label: string }>("select id, label from themes");
    const labels = new Map(themes.rows.map((theme) => [theme.id, theme.label]));
    const rows: SignalTrendInput[] = [];
    for (let offset = 0; offset < documents.rows.length; offset += DOCUMENT_BATCH_SIZE) {
      const batch = documents.rows.slice(offset, offset + DOCUMENT_BATCH_SIZE);
      const documentsById = new Map(batch.map((document) => [document.id, document]));
      const result = await client.query<{
        signalId: string; documentId: string; themeId: string;
        canonicalThemeId: string | null; canonicalSubthemeId: string | null;
        affectedEntities: string[]; scoreContribution: number;
      }>(
        `select s.id as "signalId", s.document_id as "documentId",
                s.theme_id as "themeId", s.canonical_theme_id as "canonicalThemeId",
                s.canonical_subtheme_id as "canonicalSubthemeId",
                s.affected_entities as "affectedEntities",
                s.score_contribution::float as "scoreContribution"
         from signals s
         where s.document_id = any($1::text[])`,
        [batch.map((document) => document.id)]
      );
      for (const signal of result.rows) {
        const document = documentsById.get(signal.documentId)!;
        // Match the original UNION ALL, including two contributions when market
        // and sector happen to reference the same theme. Labels are read once,
        // avoiding repeated joins against the entire theme catalog per batch.
        const contributions: Array<[string | null, SignalTrendInput["trendLevel"]]> = [
          [signal.canonicalThemeId ?? signal.themeId, signal.canonicalThemeId === null ? "unmapped" : "market"],
          [signal.canonicalSubthemeId, "sector"]
        ];
        for (const [themeId, trendLevel] of contributions) {
          if (themeId === null) continue;
          const themeLabel = labels.get(themeId);
          if (themeLabel === undefined) continue;
          rows.push({
            signalId: signal.signalId, documentId: signal.documentId,
            themeId, themeLabel, trendLevel, signalDate: document.signalDate,
            sourceClass: document.sourceClass, affectedEntities: signal.affectedEntities,
            scoreContribution: signal.scoreContribution
          });
        }
      }
      await onProgress?.(`loaded ${rows.length} signal rows from ${offset + batch.length}/${documents.rows.length} documents`);
    }
    await client.query("commit");
    // The previous UNION ALL emitted its base-theme branch before the sector
    // branch. Grouping takes the first level seen for a theme, so retain that
    // precedence even when a theme appears in both roles across batches.
    return rows.sort((a, b) => Number(a.trendLevel === "sector") - Number(b.trendLevel === "sector"));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}
