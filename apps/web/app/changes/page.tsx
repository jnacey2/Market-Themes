import Link from "next/link";
import {
  getAttentionBurstWatchlist,
  getNarrativeChangeReport,
  getLatestBrief,
  type AttentionBurstWatchlist as AttentionBurstWatchlistStatus,
  type NarrativeChange,
  type NarrativeChangeKind,
  type NarrativeChangeReport,
  type NarrativeLifecycleState,
  type StoredBrief
} from "@market-themes/db";
import { AttentionWatchlist } from "../../components/narratives/AttentionWatchlist";
import {
  LifecycleBadge,
  LIFECYCLE_LABELS
} from "../../components/narratives/LifecycleBadge";
import { HowToReadLink, MetricTerm } from "../../components/narratives/MetricTerm";
import { formatMeasurementDate } from "../../lib/metric-glossary";
import { narrativePath } from "../../lib/narrative-paths";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<NarrativeChangeKind, string> = {
  new_definition: "New narrative",
  state_change: "State change",
  entered_board: "Entered board",
  expired_definition: "Expired",
  left_board: "Left board",
  mover: "Large move"
};

const STATE_ORDER: NarrativeLifecycleState[] = [
  "rising",
  "peaking",
  "steady",
  "fading",
  "emerging",
  "dormant",
  "unmeasured"
];

export default async function ChangesPage() {
  let report: NarrativeChangeReport;
  let brief: StoredBrief | null = null;
  let failed = false;
  const emptyWatchlist: AttentionBurstWatchlistStatus = {
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    date: null,
    bursts: [],
    uncoveredCount: 0
  };
  let watchlist = emptyWatchlist;
  try {
    [report, brief, watchlist] = await Promise.all([
      getNarrativeChangeReport(),
      getLatestBrief(),
      getAttentionBurstWatchlist({ limit: 20, uncoveredOnly: true }).catch(() => emptyWatchlist)
    ]);
  } catch (error) {
    console.warn(
      `[web] change report failed: ${error instanceof Error ? error.message : String(error)}`
    );
    failed = true;
    report = {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      currentDate: null,
      previousDate: null,
      changes: [],
      stateCounts: {
        unmeasured: 0,
        dormant: 0,
        emerging: 0,
        rising: 0,
        peaking: 0,
        steady: 0,
        fading: 0
      }
    };
  }

  return (
    <div className="shell">
      <nav className="context-nav" aria-label="Narrative views">
        <span>What changed</span>
        <Link href="/trends">Open Narrative Currents</Link>
        <HowToReadLink />
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Daily changes</p>
          <h1>What changed since the last measurement.</h1>
          <p className="lede">
            Lifecycle transitions, narratives entering or leaving the measured board,
            the largest density moves, and definitions that were activated or expired.
            {report.currentDate
              ? ` Comparing ${formatMeasurementDate(report.currentDate)} with ${
                  report.previousDate
                    ? formatMeasurementDate(report.previousDate)
                    : "no earlier measurement"
                }.`
              : ""}
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Board by state</p>
          <div className="state-counts">
            {STATE_ORDER.map((state) => (
              <Link
                className="lifecycle-badge-link"
                href={`/trends?state=${state}`}
                key={state}
                title={`Show ${LIFECYCLE_LABELS[state]} narratives`}
              >
                <LifecycleBadge state={state} /> {report.stateCounts[state]}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {brief ? (
        <section className="panel">
          <p className="eyebrow">Daily Brief · {formatMeasurementDate(brief.date)}</p>
          <h2>{brief.headline}</h2>
          <p>{brief.summary}</p>
        </section>
      ) : null}

      <section className="section">
        <AttentionWatchlist
          watchlist={watchlist}
          title="Rising topics with no tracked narrative"
          limit={8}
          showCovered={false}
        />
      </section>

      <section className="section">
        <p className="eyebrow">Changes</p>
        {failed ? (
          <div className="panel">
            <h2>The change report is temporarily unavailable</h2>
            <p>The database query did not finish. Refresh in a moment.</p>
          </div>
        ) : !report.databaseConfigured ? (
          <div className="panel">
            <h2>Narrative database is unavailable</h2>
            <p>Connect DATABASE_URL to compute daily changes.</p>
          </div>
        ) : !report.currentDate ? (
          <div className="panel">
            <h2>No published measurements yet</h2>
            <p>Recompute narrative trends to produce the first measurement.</p>
          </div>
        ) : report.changes.length === 0 ? (
          <div className="panel">
            <h2>No changes since the previous measurement</h2>
            <p>Every measured narrative kept its lifecycle state and moved less than one density point.</p>
          </div>
        ) : (
          <div className="change-list">
            {report.changes.map((change) => (
              <ChangeRow change={change} key={`${change.kind}:${change.narrativeDefinitionId}`} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ChangeRow({ change }: { change: NarrativeChange }) {
  return (
    <article className="change-row">
      <div>
        <span className="change-kind">{KIND_LABELS[change.kind]}</span>
        <div className="pill-row">
          {change.previousState && change.kind === "state_change" ? (
            <>
              <LifecycleBadge compact state={change.previousState} />
              <span className="change-detail">→</span>
            </>
          ) : null}
          {change.currentState ? <LifecycleBadge compact state={change.currentState} /> : null}
        </div>
      </div>
      <div>
        <Link href={narrativePath(change.slug)}>
          <strong>{change.name}</strong>
        </Link>
        <p className="change-detail">{change.detail}</p>
      </div>
      <div className="score-stack">
        <div className="score">
          <span className="label">
            <MetricTerm term="density">Density</MetricTerm>
          </span>
          <strong>
            {change.previousDensity !== null ? change.previousDensity.toFixed(1) : "—"} →{" "}
            {change.currentDensity !== null ? change.currentDensity.toFixed(1) : "—"}
          </strong>
        </div>
        {change.attentionZScore !== null ? (
          <div className="score">
            <span className="label">
              <MetricTerm term="attentionZScore" short />
            </span>
            <strong>{change.attentionZScore.toFixed(1)}</strong>
          </div>
        ) : null}
      </div>
    </article>
  );
}
