import Link from "next/link";
import {
  getNarrativeBoardStatus,
  type NarrativeBoardStatus,
  type NarrativeLifecycleState
} from "@market-themes/db";
import { NarrativeSparkline } from "../../components/narratives/NarrativeSparkline";
import {
  LifecycleBadge,
  LIFECYCLE_LABELS,
  peakSummary
} from "../../components/narratives/LifecycleBadge";

export const dynamic = "force-dynamic";

const STATE_FILTERS: Array<NarrativeLifecycleState | "all"> = [
  "all",
  "rising",
  "peaking",
  "fading",
  "emerging",
  "steady",
  "dormant",
  "unmeasured"
];

export default async function TrendsPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: requestedState } = await searchParams;
  const activeState: NarrativeLifecycleState | "all" = STATE_FILTERS.includes(
    requestedState as NarrativeLifecycleState
  )
    ? (requestedState as NarrativeLifecycleState)
    : "all";
  let status: NarrativeBoardStatus;
  let loadError = false;
  try {
    status = await getNarrativeBoardStatus();
  } catch (error) {
    console.warn(
      `[web] narrative board failed: ${error instanceof Error ? error.message : String(error)}`
    );
    status = { databaseConfigured: Boolean(process.env.DATABASE_URL), latestDate: null, narratives: [] };
    loadError = true;
  }
  const counts = status.narratives.reduce<Record<string, number>>((totals, narrative) => {
    totals[narrative.lifecycleState] = (totals[narrative.lifecycleState] ?? 0) + 1;
    return totals;
  }, {});
  const visible =
    activeState === "all"
      ? status.narratives
      : status.narratives.filter((narrative) => narrative.lifecycleState === activeState);

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
          <p>
            {status.narratives.length} versioned narratives tracked.{" "}
            <Link href="/changes">What changed</Link>
          </p>
        </div>
      </section>

      <nav className="pill-row" aria-label="Filter by lifecycle state">
        {STATE_FILTERS.map((state) => (
          <Link
            aria-current={state === activeState ? "page" : undefined}
            className={`pill${state === activeState ? " active" : ""}`}
            href={state === "all" ? "/trends" : `/trends?state=${state}`}
            key={state}
          >
            {state === "all" ? "All" : LIFECYCLE_LABELS[state]}{" "}
            {state === "all" ? status.narratives.length : counts[state] ?? 0}
          </Link>
        ))}
      </nav>

      <section className="currents-board" aria-label="Tracked market narratives">
        <div className="currents-header">
          <span>Narrative</span>
          <span>90-day current</span>
          <span>Now</span>
          <span>Movement</span>
          <span>Breadth</span>
        </div>
        {loadError ? (
          <div className="panel">
            <h2>The narrative board is temporarily unavailable</h2>
            <p>The database query did not finish. Refresh in a moment; no measurements were lost.</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel">
            <h2>
              {status.narratives.length === 0
                ? "No narrative measurements yet"
                : `No narratives are ${activeState} right now`}
            </h2>
            <p>
              {status.narratives.length === 0
                ? "Apply migrations, classify documents, and recompute narrative trends to populate this board."
                : "Clear the filter to see the full board."}
            </p>
          </div>
        ) : visible.map((narrative) => (
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
                {narrative.status === "probationary" ? " · probationary" : ""}
              </span>
              <strong>{narrative.name}</strong>
              <div className="pill-row">
                <LifecycleBadge compact state={narrative.lifecycleState} />
                {peakSummary(narrative) ? <small>{peakSummary(narrative)}</small> : null}
              </div>
              <small>{narrative.proposition}</small>
            </div>
            <NarrativeSparkline points={narrative.history} label={narrative.name} />
            <div className="current-level">
              <strong>{measured(narrative) ? narrative.density.toFixed(1) : "—"}</strong>
              <span>{levelCaption(narrative)}</span>
            </div>
            <div className="current-movement">
              <strong
                className={
                  !measured(narrative) ? "" : narrative.change >= 0 ? "rising" : "fading"
                }
              >
                {movementLabel(narrative)}
              </strong>
              <span>{movementCaption(narrative)}</span>
            </div>
            <div className="current-breadth">
              <strong>{narrative.storyBreadth}</strong>
              <span>unique stories</span>
              <small>
                {narrative.publisherOwnerBreadth} publisher groups ·{" "}
                {narrative.eligibleDocuments}/{narrative.corpusDocuments} documents classified
              </small>
              {narrative.lowHistory && measured(narrative) ? (
                <em>thin baseline · {narrative.baselineWindows} comparison windows</em>
              ) : null}
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

type BoardNarrative = NarrativeBoardStatus["narratives"][number];

function measured(narrative: BoardNarrative) {
  return (
    narrative.coverageStatus === "measured" ||
    narrative.coverageStatus === "measured_zero"
  );
}

function levelCaption(narrative: BoardNarrative) {
  if (narrative.coverageStatus === "no_corpus") return "no readable corpus";
  if (narrative.coverageStatus === "backfill_pending") return "classification pending";
  const attention = `attention ${narrative.attentionDensity.toFixed(1)} · z ${narrative.attentionZScore.toFixed(1)}`;
  if (narrative.coverageStatus === "measured_zero") return `0 approved · ${attention}`;
  return narrative.lowHistory
    ? `${attention} · provisional`
    : `${narrative.percentileRank}th pct · ${attention}`;
}

function movementLabel(narrative: BoardNarrative) {
  if (narrative.coverageStatus === "no_corpus") return "No recent corpus";
  if (narrative.coverageStatus === "backfill_pending") return "Classification pending";
  return `${narrative.change >= 0 ? "↑" : "↓"} ${Math.abs(narrative.change).toFixed(1)}`;
}

function movementCaption(narrative: BoardNarrative) {
  if (narrative.coverageStatus === "no_corpus") return "ingest recent sources";
  if (narrative.coverageStatus === "backfill_pending") return "movement suppressed";
  const z = narrative.lowHistory
    ? `z ${narrative.zScore.toFixed(1)} (provisional)`
    : `z ${narrative.zScore.toFixed(1)}`;
  return `${z} · accel ${signed(narrative.acceleration)}`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
