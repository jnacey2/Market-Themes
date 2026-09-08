import Link from "next/link";
import { getNarrativeBoardStatus, type TrendWindow } from "@market-themes/db";
import { NarrativeSparkline } from "./NarrativeSparkline";
import { densityReady, measurementStatus } from "../../lib/narrative-quality";

export async function NarrativeBoard({ window }: { window: TrendWindow }) {
  const status = await getNarrativeBoardStatus(undefined, undefined, {
    window
  });
  return (
    <div className="shell wide-shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/narrative-review">Evidence review</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/briefs">Daily briefs</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/ingestion">Operations</Link>
        </div>
      </nav>
      <header className="board-heading">
        <p className="eyebrow">Narrative currents</p>
        <h1>What is changing in the evidence?</h1>
        <p className="lede">
          Reviewed market propositions, measured against their own history.
        </p>
        <div className="pill-row">
          <span className="pill">
            Through {status.latestDate ?? "first measurement pending"} · UTC
          </span>
          <span className="pill">
            {status.narratives.length} tracked narratives
          </span>
          <span className="pill">
            {
              status.narratives.filter(
                (n) => densityReady(n) && n.comparisonReady
              ).length
            }{" "}
            comparable
          </span>
        </div>
        <div className="button-row" aria-label="Measurement window">
          {(["7d", "30d"] as const).map((value) => (
            <Link
              key={value}
              className="pill"
              aria-current={window === value ? "page" : undefined}
              href={`/?window=${value}`}
            >
              {value === "7d" ? "7-day" : "30-day"} measurement
            </Link>
          ))}
        </div>
      </header>
      <section
        className="currents-board"
        aria-label="Tracked market narratives"
      >
        <div className="currents-header" aria-hidden="true">
          <span>Narrative & evidence</span>
          <span>90-day history</span>
          <span>Density</span>
          <span>Movement</span>
          <span>Coverage</span>
        </div>
        {!status.narratives.length ? (
          <div className="panel">
            <h2>Awaiting reviewed evidence</h2>
            <p>
              Connect sources and review their evidence to build the first
              measurement.
            </p>
            <Link className="pill" href="/sources">
              Manage sources
            </Link>
          </div>
        ) : (
          status.narratives.map((n) => {
            const ready = densityReady(n);
            return (
              <Link
                className="current-row"
                href={`/themes/${encodeURIComponent(n.slug)}?window=${window}`}
                key={n.id}
              >
                <div className="current-name">
                  <span className="label">{n.category}</span>
                  <strong>{n.name}</strong>
                  <small>{n.proposition}</small>
                  {n.evidence[0] ? (
                    <blockquote className="board-quote">
                      “{n.evidence[0].evidenceSnippet}”
                      <cite>{n.evidence[0].publisher}</cite>
                    </blockquote>
                  ) : null}
                </div>
                <NarrativeSparkline points={n.history} label={n.name} />
                <div className="current-level">
                  <strong>{ready ? `${n.density.toFixed(1)}%` : "—"}</strong>
                  <span>
                    {ready && !n.lowHistory
                      ? `${n.percentileRank}th percentile`
                      : measurementStatus(n)}
                  </span>
                </div>
                <div className="current-movement">
                  <strong
                    className={
                      ready && n.comparisonReady
                        ? n.change >= 0
                          ? "rising"
                          : "fading"
                        : ""
                    }
                  >
                    {ready && n.comparisonReady
                      ? `${n.change >= 0 ? "+" : ""}${n.change.toFixed(1)} pp`
                      : "—"}
                  </strong>
                  <span>vs prior {window === "7d" ? "7" : "30"} days</span>
                </div>
                <div className="current-breadth">
                  <strong>{n.matchedDocuments} reviewed matches</strong>
                  <span>
                    {n.eligibleDocuments} classified /{" "}
                    {n.expectedDocuments ?? "—"} documents
                  </span>
                  <span>{n.publisherOwnerBreadth} publisher groups</span>
                  <em>{measurementStatus(n)}</em>
                </div>
              </Link>
            );
          })
        )}
      </section>
      <details className="panel section">
        <summary>How to read these measurements</summary>
        <p>
          Density is the percentage of documents supporting a proposition,
          averaged equally across source classes. Movement compares adjacent
          windows in percentage points. Missing dates, unclassified documents,
          pending reviews, and changed source classes suppress comparisons. Flat
          baselines have no z-score. Every calendar day must have coverage; a
          quiet day therefore remains uncertain until ingestion completeness can
          be verified independently.
        </p>
        <p>
          This board describes attention in the connected corpus. It does not
          imply agreement or complete market coverage.
        </p>
      </details>
    </div>
  );
}
