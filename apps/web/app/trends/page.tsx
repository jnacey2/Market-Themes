import Link from "next/link";
import { getNarrativeBoardStatus } from "@market-themes/db";
import { NarrativeSparkline } from "../../components/narratives/NarrativeSparkline";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const status = await getNarrativeBoardStatus();

  return (
    <div className="shell wide-shell">
      <nav className="nav">
        <Link className="brand" href="/">Market Themes</Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/ingestion">Operations</Link>
        </div>
      </nav>

      <section className="hero currents-hero">
        <div>
          <p className="eyebrow">Narrative Currents</p>
          <h1>See the stories moving markets.</h1>
          <p className="lede">
            Stable market propositions measured against their own history. Density is
            normalized by the eligible corpus, while publisher ownership and evidence
            breadth show whether a move is genuinely independent.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Latest measurement</p>
          <h2>{status.latestDate ?? "Awaiting first run"}</h2>
          <p>{status.narratives.length} versioned narratives tracked.</p>
        </div>
      </section>

      <section className="currents-board" aria-label="Tracked market narratives">
        <div className="currents-header" aria-hidden="true">
          <span>Narrative</span>
          <span>90-day current</span>
          <span>Now</span>
          <span>Movement</span>
          <span>Breadth</span>
        </div>
        {status.narratives.length === 0 ? (
          <div className="panel">
            <h2>No narrative measurements yet</h2>
            <p>
              Apply migrations, classify documents, and recompute narrative trends to
              populate this board.
            </p>
          </div>
        ) : status.narratives.map((narrative) => (
          <Link
            className="current-row"
            href={`/themes/${encodeURIComponent(narrative.id)}`}
            key={narrative.id}
          >
            <div className="current-name">
              <span className="label">{narrative.category}</span>
              <strong>{narrative.name}</strong>
              <small>{narrative.proposition}</small>
            </div>
            <NarrativeSparkline points={narrative.history} label={narrative.name} />
            <div className="current-level">
              <strong>{narrative.density.toFixed(1)}</strong>
              <span>{narrative.percentileRank}th pct</span>
            </div>
            <div className="current-movement">
              <strong className={narrative.change >= 0 ? "rising" : "fading"}>
                {narrative.change >= 0 ? "↑" : "↓"} {Math.abs(narrative.change).toFixed(1)}
              </strong>
              <span>accel {signed(narrative.acceleration)}</span>
            </div>
            <div className="current-breadth">
              <strong>{narrative.publisherOwnerBreadth}</strong>
              <span>independent owners</span>
              {narrative.lowHistory ? <em>low history</em> : null}
            </div>
          </Link>
        ))}
      </section>

      <section className="section methodology-note">
        <div className="panel">
          <p className="eyebrow">Reading the board</p>
          <p>
            “Now” is the seven-day percentage density averaged across active source
            classes. Movement compares adjacent seven-day windows. A high reading is
            attention—not a forecast, recommendation, or measure of agreement.
          </p>
        </div>
      </section>
    </div>
  );
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
