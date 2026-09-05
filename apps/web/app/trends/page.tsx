import Link from "next/link";
import {
  getNarrativeBoardStatus,
  type NarrativeBoardStatus,
  type NarrativeLifecycleState
} from "@market-themes/db";
import { NarrativeSparkline } from "../../components/narratives/NarrativeSparkline";
import {
  hasThinEvidence,
  LifecycleBadge,
  LIFECYCLE_LABELS,
  peakSummary,
  ThinEvidencePill
} from "../../components/narratives/LifecycleBadge";
import { HowToReadLink, MetricTerm } from "../../components/narratives/MetricTerm";
import { groupBoard } from "../../lib/board-sections";
import { formatMeasurementDate, METRIC_GLOSSARY } from "../../lib/metric-glossary";
import { narrativeDataPath } from "../../lib/narrative-paths";

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
  const coverage = boardCoverage(status.narratives);
  const sections = groupBoard(visible);

  return (
    <div className="shell wide-shell">
      <section className="hero currents-hero">
        <div>
          <p className="eyebrow">Narrative Currents</p>
          <h1>See the stories moving markets.</h1>
          <p className="lede">
            Stable market propositions measured against their own history. Density is
            normalized by the eligible corpus, while publisher ownership and evidence
            breadth show whether a move is genuinely independent.{" "}
            <HowToReadLink>How to read these numbers</HowToReadLink>
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Latest measurement</p>
          <h2>{formatMeasurementDate(status.latestDate) ?? "Awaiting first run"}</h2>
          <p>
            {status.narratives.length} versioned narratives tracked.{" "}
            <Link href="/changes">What changed</Link>
          </p>
          {coverage ? (
            <p className="label" title={METRIC_GLOSSARY.coverage.description}>
              Classification coverage this week: {coverage.classified.toLocaleString()} of{" "}
              {coverage.corpus.toLocaleString()} readable documents (
              {coverage.percent.toFixed(1)}%)
            </p>
          ) : null}
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

      {loadError ? (
        <section className="panel">
          <h2>The narrative board is temporarily unavailable</h2>
          <p>The database query did not finish. Refresh in a moment; no measurements were lost.</p>
        </section>
      ) : visible.length === 0 ? (
        <section className="panel">
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
        </section>
      ) : (
        <>
          <div className="board-section-header">
            <h2>Structural themes</h2>
            <p>
              {sections.structural.length} long-running propositions, ranked by how unusual
              this week is against each theme&apos;s own history.
            </p>
          </div>
          {sections.structural.length === 0 ? (
            <section className="panel">
              <p className="lane-empty">No structural themes match this filter.</p>
            </section>
          ) : (
            <section className="currents-board" aria-label="Structural themes">
              <BoardHeader />
              {sections.structural.map((narrative) => (
                <BoardRow key={narrative.id} narrative={narrative} />
              ))}
            </section>
          )}

          <div className="board-section-header">
            <h2>Event narratives</h2>
            <p>
              {sections.eventCount} headline-driven propositions, grouped under their
              structural family where one exists. Event narratives expire with the event.
            </p>
          </div>
          {sections.eventGroups.length === 0 ? (
            <section className="panel">
              <p className="lane-empty">No event narratives match this filter.</p>
            </section>
          ) : (
            sections.eventGroups.map((group) => (
              <div key={group.key}>
                <p className="board-group-label">
                  {group.parentName
                    ? `${group.parentName} · family`
                    : "Standalone events (no structural parent)"}
                </p>
                <section
                  className="currents-board"
                  aria-label={group.parentName ?? "Standalone event narratives"}
                >
                  <BoardHeader />
                  {group.items.map((narrative) => (
                    <BoardRow
                      child={Boolean(group.parentId)}
                      key={narrative.id}
                      narrative={narrative}
                    />
                  ))}
                </section>
              </div>
            ))
          )}
        </>
      )}

      <section className="section methodology-note">
        <div className="panel">
          <p className="eyebrow">Reading the board</p>
          <p>
            “Now” is the seven-day reviewed density: the share of this week&apos;s readable
            documents approved as evidence, averaged across source classes. Pending and
            partial classification coverage are shown as unmeasured, not as zero.
            Unique-story breadth deduplicates syndicated copies. Movement compares
            adjacent seven-day windows. Rising and peaking need at least three unique
            stories from two publisher groups. A high reading is attention—not a
            forecast, recommendation, or measure of agreement. Dates are UTC.{" "}
            <HowToReadLink>Full glossary</HowToReadLink>
          </p>
        </div>
      </section>
    </div>
  );
}

type BoardNarrative = NarrativeBoardStatus["narratives"][number];

function BoardHeader() {
  return (
    <div className="currents-header">
      <span>Narrative</span>
      <span title="Reviewed density over the trailing 90 days">90-day trend</span>
      <span>
        <MetricTerm term="density">Now</MetricTerm>
      </span>
      <span>
        <MetricTerm term="change">Movement</MetricTerm>
      </span>
      <span>
        <MetricTerm term="uniqueStories">Breadth</MetricTerm>
      </span>
    </div>
  );
}

function BoardRow({ narrative, child = false }: { narrative: BoardNarrative; child?: boolean }) {
  return (
    <Link
      className={`current-row${child ? " is-child" : ""}`}
      href={narrativeDataPath(narrative.slug)}
    >
      <div className="current-name">
        <span className="label">
          {narrative.parentName
            ? `${narrative.dimension ?? "dimension"}`
            : `${narrative.category} · ${narrative.kind ?? "structural"}`}
          {narrative.status === "probationary" ? " · probationary" : ""}
        </span>
        <strong>{narrative.name}</strong>
        <div className="pill-row">
          <LifecycleBadge compact state={narrative.lifecycleState} />
          {hasThinEvidence(narrative) ? <ThinEvidencePill compact /> : null}
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
          className={!measured(narrative) ? "" : narrative.change >= 0 ? "rising" : "fading"}
        >
          {movementLabel(narrative)}
        </strong>
        <span>{movementCaption(narrative)}</span>
      </div>
      <div className="current-breadth">
        <strong>{narrative.storyBreadth}</strong>
        <span>{narrative.storyBreadth === 1 ? "unique story" : "unique stories"}</span>
        <small>{breadthCaption(narrative)}</small>
        {narrative.lowHistory && measured(narrative) ? (
          <em>thin baseline · {narrative.baselineWindows} comparison windows</em>
        ) : null}
      </div>
    </Link>
  );
}

function measured(narrative: BoardNarrative) {
  return (
    narrative.coverageStatus === "measured" ||
    narrative.coverageStatus === "measured_zero"
  );
}

/**
 * Classification coverage is a property of the corpus window, not of any one
 * narrative, so it is reported once at the top of the board.
 */
function boardCoverage(narratives: BoardNarrative[]) {
  const withCorpus = narratives.filter((narrative) => narrative.corpusDocuments > 0);
  if (withCorpus.length === 0) return null;
  const corpus = Math.max(...withCorpus.map((narrative) => narrative.corpusDocuments));
  const classified = Math.max(...withCorpus.map((narrative) => narrative.eligibleDocuments));
  return {
    corpus,
    classified: Math.min(classified, corpus),
    percent: corpus === 0 ? 0 : (Math.min(classified, corpus) / corpus) * 100
  };
}

function levelCaption(narrative: BoardNarrative) {
  if (narrative.coverageStatus === "no_corpus") return "no readable corpus";
  if (narrative.coverageStatus === "backfill_pending") return "classification pending";
  const attention = `attention ${narrative.attentionDensity.toFixed(1)} (z ${narrative.attentionZScore.toFixed(1)})`;
  if (narrative.coverageStatus === "measured_zero" || narrative.density <= 0) {
    return narrative.attentionMatchedDocuments > 0
      ? `no approved coverage · ${narrative.attentionMatchedDocuments} awaiting review`
      : "no approved coverage this week";
  }
  return narrative.lowHistory
    ? `${attention} · provisional`
    : `${narrative.percentileRank}th pct · ${attention}`;
}

function movementLabel(narrative: BoardNarrative) {
  if (narrative.coverageStatus === "no_corpus") return "No recent corpus";
  if (narrative.coverageStatus === "backfill_pending") return "Classification pending";
  if (narrative.change === 0) return "No change";
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

function breadthCaption(narrative: BoardNarrative) {
  if (narrative.storyBreadth === 0) return "no publisher groups this week";
  const groups = `${narrative.publisherOwnerBreadth} publisher ${narrative.publisherOwnerBreadth === 1 ? "group" : "groups"}`;
  return hasThinEvidence(narrative) ? `${groups} · too few to call a move` : groups;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
