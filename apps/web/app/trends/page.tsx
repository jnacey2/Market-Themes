import Link from "next/link";
import { getNarrativeBoardStatus } from "@market-themes/db";
import { NarrativeSparkline } from "../../components/narratives/NarrativeSparkline";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const status = await getNarrativeBoardStatus();

  return (
    <div className="shell wide-shell">
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
              <span className="label">
                {narrative.parentName
                  ? `${narrative.parentName} · ${narrative.dimension ?? "dimension"}`
                  : `${narrative.category} · ${narrative.kind ?? "structural"}`}
              </span>
              <strong>{narrative.name}</strong>
              <small>{narrative.proposition}</small>
            </div>
            <NarrativeSparkline points={narrative.history} label={narrative.name} />
            <div className="current-level">
              <strong>
                {narrative.coverageStatus === "measured" ||
                narrative.coverageStatus === "measured_zero"
                  ? narrative.density.toFixed(1)
                  : "—"}
              </strong>
              <span>
                {narrative.coverageStatus === "no_corpus"
                  ? "no readable corpus"
                  : narrative.coverageStatus === "backfill_pending"
                  ? "classification pending"
                  : narrative.coverageStatus === "measured_zero"
                    ? "0 approved matches · fully classified"
                    : narrative.eligibleDocuments > 0 && !narrative.lowHistory
                  ? `${narrative.percentileRank}th pct`
                  : narrative.eligibleDocuments > 0
                    ? "building baseline"
                    : "measured zero"}
              </span>
            </div>
            <div className="current-movement">
              <strong
                className={
                  narrative.coverageStatus !== "measured" ||
                  narrative.eligibleDocuments === 0 ||
                  narrative.lowHistory
                    ? ""
                    : narrative.change >= 0
                      ? "rising"
                      : "fading"
                }
              >
                {narrative.coverageStatus === "no_corpus"
                  ? "No recent corpus"
                  : narrative.coverageStatus === "backfill_pending"
                  ? "Classification pending"
                  : narrative.coverageStatus === "measured_zero"
                    ? "Measured zero"
                    : narrative.eligibleDocuments > 0 && !narrative.lowHistory
                  ? `${narrative.change >= 0 ? "↑" : "↓"} ${Math.abs(narrative.change).toFixed(1)}`
                  : narrative.eligibleDocuments > 0
                    ? "Baseline pending"
                    : "Measured zero"}
              </strong>
              <span>
                {narrative.coverageStatus === "no_corpus"
                  ? "ingest recent sources"
                  : narrative.coverageStatus === "backfill_pending"
                    ? "movement suppressed"
                    : narrative.coverageStatus === "measured_zero"
                      ? "no approved matches"
                  : narrative.eligibleDocuments > 0 && !narrative.lowHistory
                  ? `accel ${signed(narrative.acceleration)}`
                  : narrative.eligibleDocuments > 0
                    ? "movement suppressed"
                    : "no approved matches"}
              </span>
            </div>
            <div className="current-breadth">
              <strong>{narrative.storyBreadth}</strong>
              <span>unique stories</span>
              <small>
                {narrative.publisherOwnerBreadth} publisher groups ·{" "}
                {narrative.eligibleDocuments}/{narrative.corpusDocuments} documents classified
              </small>
              {narrative.lowHistory ? <em>building baseline</em> : null}
            </div>
          </Link>
        ))}
      </section>

      <section className="section methodology-note">
        <div className="panel">
          <p className="eyebrow">Reading the board</p>
          <p>
            “Now” is the seven-day percentage density averaged across active source
            classes. Coverage shows classified readable documents over the current
            seven-day corpus; pending and partial coverage are not measured zeroes.
            Unique-story breadth deduplicates syndicated copies. Movement compares
            adjacent seven-day windows. A high reading is attention—not a forecast,
            recommendation, or measure of agreement.
          </p>
        </div>
      </section>
    </div>
  );
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
