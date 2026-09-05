import Link from "next/link";
import type { AttentionBurstWatchlist } from "@market-themes/db";
import { formatMeasurementDate, METRIC_GLOSSARY } from "../../lib/metric-glossary";

const KIND_LABELS = {
  title_ngram: "headline phrase",
  entity: "entity",
  theme_label: "extracted theme"
} as const;

export function AttentionWatchlist({
  watchlist,
  title = "Attention watchlist",
  limit = 12,
  showCovered = true
}: {
  watchlist: AttentionBurstWatchlist;
  title?: string;
  limit?: number;
  showCovered?: boolean;
}) {
  const bursts = (
    showCovered
      ? watchlist.bursts
      : watchlist.bursts.filter((burst) => burst.coveringNarrativeDefinitionIds.length === 0)
  ).slice(0, limit);

  return (
    <div className="panel">
      <p className="eyebrow">
        {title}
        {watchlist.date ? ` · ${formatMeasurementDate(watchlist.date)}` : ""}
      </p>
      <p className="lane-empty" title={METRIC_GLOSSARY.corpusBurst.description}>
        Phrases, entities and extracted themes that several independent publisher groups
        started covering this week, counted across the whole corpus without a model.
        {watchlist.uncoveredCount > 0
          ? ` ${watchlist.uncoveredCount} ${watchlist.uncoveredCount === 1 ? "is" : "are"} gaining coverage that no tracked narrative explains; these are the gaps in the board.`
          : " Every burst is explained by a tracked narrative."}
      </p>
      {!watchlist.databaseConfigured ? (
        <p className="lane-empty">Narrative database is unavailable.</p>
      ) : bursts.length === 0 ? (
        <p className="lane-empty">
          {watchlist.date
            ? "No unusual corpus attention in the latest scan."
            : "No burst scan has run yet."}
        </p>
      ) : (
        <div className="change-list">
          {bursts.map((burst) => (
            <article className="change-row" key={burst.id}>
              <div>
                <span
                  className="change-kind"
                  title={
                    burst.novel
                      ? "No mentions in the prior twelve weeks."
                      : `${burst.zScore.toFixed(1)} standard deviations above its own twelve-week weekly story count.`
                  }
                >
                  {burst.novel ? "New this week" : `z ${burst.zScore.toFixed(1)} vs 12-week norm`}
                </span>
                <p className="change-detail">{KIND_LABELS[burst.kind]}</p>
              </div>
              <div>
                <strong>{burst.term}</strong>
                <p className="change-detail">
                  {burst.currentStories} unique stories · {burst.currentOwners} publisher
                  groups
                  {burst.novel
                    ? " · no mentions in the prior 12 weeks"
                    : ` · baseline ${burst.baselineMean.toFixed(1)} per week`}
                </p>
                {burst.sampleTitles[0] ? (
                  <p className="change-detail">“{burst.sampleTitles[0]}”</p>
                ) : null}
                {burst.coveringNarrativeNames.length > 0 ? (
                  <p className="change-detail">
                    Covered by {burst.coveringNarrativeNames.join(", ")}
                  </p>
                ) : (
                  <p className="change-detail">
                    Not covered by any tracked narrative ·{" "}
                    <Link href="/narrative-candidates">check discovery queue</Link>
                  </p>
                )}
              </div>
              <div className="score-stack">
                <div className="score">
                  <span
                    className="label"
                    title="Burst strength: unusualness weighted by how many independent publisher groups are covering it. Higher ranks higher; the scale is relative to this scan."
                  >
                    Burst score
                  </span>
                  <strong>{burst.score.toFixed(1)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
