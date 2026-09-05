import Link from "next/link";
import {
  getNarrativeHomepageStatus,
  type NarrativeHomepageItem,
  type NarrativeHomepageLane,
  type NarrativeHomepageStatus
} from "@market-themes/db";
import {
  hasThinEvidence,
  LifecycleBadge,
  peakSummary,
  ThinEvidencePill
} from "../components/narratives/LifecycleBadge";
import { HowToReadLink, MetricTerm } from "../components/narratives/MetricTerm";
import { formatMeasurementDate, METRIC_GLOSSARY } from "../lib/metric-glossary";
import { narrativeDataPath, narrativePath } from "../lib/narrative-paths";

export const dynamic = "force-dynamic";

const LANE_COPY: Record<
  NarrativeHomepageLane,
  { title: string; description: string; empty: string }
> = {
  rising: {
    title: "Rising",
    description: "Reviewed density climbing beyond noise, ranked by raw-attention surprise.",
    empty: "Nothing is rising beyond its normal range right now."
  },
  peaking: {
    title: "Peaking",
    description: "Near the 90-day high and no longer accelerating.",
    empty: "No narrative is sitting at a recent peak."
  },
  fading: {
    title: "Fading",
    description: "Below half of peak or declining in consecutive windows.",
    empty: "No narrative is currently fading."
  },
  emerging: {
    title: "New and probationary",
    description:
      "Recently promoted or activated definitions, and measured narratives whose history is still too short to compare against. Not a lifecycle state.",
    empty: "No new or probationary narratives are measured yet."
  }
};

const MOTION_LANES: NarrativeHomepageLane[] = ["rising", "peaking", "fading"];

export default async function HomePage() {
  const dashboard = await getNarrativeHomepageStatus();
  const leadNarrative = pickLeadNarrative(dashboard);
  const summaryUnavailable =
    !dashboard.databaseConfigured ||
    (dashboard.degraded && dashboard.narratives.length === 0);
  const motionCount = MOTION_LANES.reduce(
    (total, lane) => total + dashboard.lanes[lane].length,
    0
  );
  const latestMeasurement = formatMeasurementDate(dashboard.latestDate);

  return (
    <div className="shell">
      <nav className="page-jump-nav" aria-label="On this page">
        <span>On this page</span>
        <a href="#themes">Structural themes</a>
        <a href="#lanes">Lifecycle lanes</a>
        <a href="#narratives">Most surprising</a>
        <a href="#brief">Daily Brief</a>
        <a href="#copilot">Copilot</a>
        <HowToReadLink>How to read</HowToReadLink>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Narrative Intelligence</p>
          <h1>See which market stories are actually changing.</h1>
          <p className="lede">
            Track narratives as they emerge, rise, peak, and fade across filings,
            transcripts, official releases, and news. Rankings favor surprise versus
            each narrative&apos;s own history, not raw popularity.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Today&apos;s highest priority</p>
          <h2>
            {leadNarrative?.name ??
              (!dashboard.databaseConfigured
                ? "Narrative database is unavailable"
                : summaryUnavailable
                  ? "Narrative summary is delayed"
                  : "Awaiting a published 7-day signal")}
          </h2>
          {leadNarrative ? (
            <div className="pill-row">
              <LifecycleBadge state={leadNarrative.lifecycleState} />
              {hasThinEvidence(leadNarrative) ? <ThinEvidencePill /> : null}
              {peakSummary(leadNarrative) ? (
                <span className="pill" title={METRIC_GLOSSARY.peak.description}>
                  {peakSummary(leadNarrative)}
                </span>
              ) : null}
            </div>
          ) : null}
          <p>
            {leadNarrative
              ? leadNarrative.proposition
              : !dashboard.databaseConfigured
                ? "Connect the research database to load reviewed narratives."
                : summaryUnavailable
                  ? "The lightweight narrative summary could not finish. Open Narrative Currents for the full live board."
                  : "Reviewed evidence may exist historically or await the next narrative trend publication."}
          </p>
          <div className="metric-row">
            <div className="metric">
              <span>
                <MetricTerm term="attentionZScore" short />
              </span>
              <strong>
                {leadNarrative ? leadNarrative.attentionZScore.toFixed(1) : "—"}
              </strong>
            </div>
            <div className="metric">
              <span>
                <MetricTerm term="change" short />
              </span>
              <strong>{leadNarrative ? signed(leadNarrative.change) : "—"}</strong>
            </div>
            <div className="metric">
              <span>
                <MetricTerm term="uniqueStories" />
              </span>
              <strong>{leadNarrative?.storyBreadth ?? "—"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <span className="label">Tracked narratives</span>
          <h2>{summaryUnavailable ? "Unavailable" : dashboard.trackedNarrativeCount}</h2>
          <p>Active and probationary propositions measured from source evidence.</p>
        </div>
        <div className="panel">
          <span className="label">In motion</span>
          <h2>{summaryUnavailable ? "Unavailable" : `${motionCount} narratives`}</h2>
          <p>
            Rising, peaking, or fading as of the latest measurement.{" "}
            <Link href="/changes">See what changed</Link>.
          </p>
        </div>
        <div className="panel">
          <span className="label">Latest measurement</span>
          <h2>
            {latestMeasurement ??
              (summaryUnavailable ? "Temporarily unavailable" : "None yet")}
          </h2>
          <p>
            {!dashboard.databaseConfigured
              ? "Connect the research database to measure current narratives."
              : summaryUnavailable
                ? "The live summary query did not finish; nothing on this page is a measurement until it recovers."
                : "Seven-day window ending on this UTC day. Reviewed density uses approved evidence only; attention z-scores also count pending classifier matches."}{" "}
            <HowToReadLink>How to read these numbers</HowToReadLink>
          </p>
        </div>
      </section>

      <section className="section" id="themes">
        <p className="eyebrow">Structural themes</p>
        <StructuralThemes
          themes={dashboard.structuralThemes}
          unavailable={summaryUnavailable}
        />
      </section>

      <section className="section" id="lanes">
        <p className="eyebrow">Lifecycle lanes</p>
        <div className="lane-grid">
          {(Object.keys(LANE_COPY) as NarrativeHomepageLane[]).map((lane) => (
            <Lane
              key={lane}
              lane={lane}
              items={dashboard.lanes[lane]}
              unavailable={summaryUnavailable}
            />
          ))}
        </div>
      </section>

      <section className="section" id="narratives">
        <p className="eyebrow">Most surprising versus own history</p>
        <p className="lane-empty">
          Structural themes first, then event narratives, each ranked by attention
          z-score.
        </p>
        {dashboard.degraded && !summaryUnavailable ? (
          <p className="lane-empty">
            Evidence previews are temporarily unavailable; the measurements below are
            current.
          </p>
        ) : null}
        <div className="grid">
          {dashboard.narratives.length === 0 ? (
            <div className="panel">
              <h2>
                {summaryUnavailable && dashboard.databaseConfigured
                  ? "Live narrative cards are delayed"
                  : !dashboard.databaseConfigured
                    ? "Narrative database is unavailable"
                    : "No measured 7-day narrative signals yet"}
              </h2>
              <p>
                {summaryUnavailable && dashboard.databaseConfigured
                  ? "Open Narrative Currents for the complete live board."
                  : !dashboard.databaseConfigured
                    ? "Connect DATABASE_URL to load the live narrative board."
                    : "Reviewed evidence may be historical or awaiting the next scheduled narrative trend publication."}
              </p>
              <Link className="pill" href="/trends">
                Open Narrative Currents
              </Link>
            </div>
          ) : (
            dashboard.narratives.slice(0, 6).map((narrative) => (
              <NarrativeCard
                evidenceDegraded={dashboard.degraded}
                key={narrative.id}
                narrative={narrative}
              />
            ))
          )}
        </div>
      </section>

      <section className="section grid two">
        <BriefPanel dashboard={dashboard} unavailable={summaryUnavailable} />
        <div className="panel" id="copilot">
          <p className="eyebrow">Research Copilot</p>
          <h2>Ask from the evidence, not the model&apos;s memory.</h2>
          <div className="copilot-box">
            What are management teams saying about consumer weakness this week?
          </div>
          <p>
            Not yet live. The first copilot will retrieve storyboard evidence and
            document chunks, then answer with citations and clear separation between
            sourced evidence and interpretation.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * Structural themes lead when one is moving; a week of headlines only takes the
 * lead card when no structural theme is rising or peaking.
 */
function pickLeadNarrative(dashboard: NarrativeHomepageStatus) {
  const structural = (item: NarrativeHomepageItem) =>
    (item.kind ?? "structural") === "structural";
  return (
    dashboard.lanes.rising.find(structural) ??
    dashboard.lanes.peaking.find(structural) ??
    dashboard.lanes.rising[0] ??
    dashboard.lanes.peaking[0] ??
    dashboard.narratives[0] ??
    null
  );
}

function StructuralThemes({
  themes,
  unavailable
}: {
  themes: NarrativeHomepageItem[];
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <div className="panel">
        <p className="lane-empty">Unavailable.</p>
      </div>
    );
  }
  if (themes.length === 0) {
    return (
      <div className="panel">
        <p className="lane-empty">No structural themes are defined yet.</p>
      </div>
    );
  }
  return (
    <div className="panel theme-strip">
      <p className="lane-empty">
        The long-running propositions the board exists to track, ranked by how unusual
        this week is against each theme&apos;s own history. Event narratives (headline
        stories) are listed separately below.
      </p>
      <div className="theme-rows">
        {themes.map((theme) => {
          const measured =
            theme.coverageStatus === "measured" || theme.coverageStatus === "measured_zero";
          return (
            <Link className="theme-row" href={narrativeDataPath(theme.slug)} key={theme.id}>
              <div className="theme-row-name">
                <strong>{theme.name}</strong>
                <div className="pill-row">
                  <LifecycleBadge compact state={theme.lifecycleState} />
                  {hasThinEvidence(theme) ? <ThinEvidencePill compact /> : null}
                </div>
              </div>
              <div className="theme-row-metric">
                <span>
                  <MetricTerm term="density">Density</MetricTerm>
                </span>
                <strong>{measured ? theme.density.toFixed(1) : "—"}</strong>
              </div>
              <div className="theme-row-metric">
                <span>
                  <MetricTerm term="change" short />
                </span>
                <strong className={!measured ? "" : theme.change >= 0 ? "rising" : "fading"}>
                  {measured ? signed(theme.change) : "—"}
                </strong>
              </div>
              <div className="theme-row-metric">
                <span>
                  <MetricTerm term="zScore" short />
                </span>
                <strong>{measured ? theme.zScore.toFixed(1) : "—"}</strong>
              </div>
              <div className="theme-row-metric">
                <span>
                  <MetricTerm term="uniqueStories" short />
                </span>
                <strong>{theme.storyBreadth}</strong>
              </div>
              <small className="theme-row-caption">{themeCaption(theme, measured)}</small>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function themeCaption(theme: NarrativeHomepageItem, measured: boolean) {
  if (theme.coverageStatus === "backfill_pending") return "classification pending";
  if (theme.coverageStatus === "no_corpus") return "no readable corpus this week";
  if (!measured) return "unmeasured";
  if (theme.density <= 0) {
    return theme.attentionMatchedDocuments > 0
      ? `no approved coverage · ${theme.attentionMatchedDocuments} awaiting review`
      : peakSummary(theme) ?? "no approved coverage this week";
  }
  return `${theme.publisherOwnerBreadth} publisher ${theme.publisherOwnerBreadth === 1 ? "group" : "groups"} · ${peakSummary(theme) ?? ""}`.replace(/ · $/, "");
}

function Lane({
  lane,
  items,
  unavailable
}: {
  lane: NarrativeHomepageLane;
  items: NarrativeHomepageItem[];
  unavailable: boolean;
}) {
  const copy = LANE_COPY[lane];
  const empty = !unavailable && items.length === 0;
  return (
    <div className={`lane${empty ? " is-empty" : ""}`} aria-label={`${copy.title} narratives`}>
      <div className="lane-header">
        <h2>{copy.title}</h2>
        <small>{items.length}</small>
      </div>
      {unavailable ? (
        <p className="lane-empty">Unavailable.</p>
      ) : empty ? (
        <p className="lane-empty">{copy.empty}</p>
      ) : (
        <>
          <p className="lane-empty">{copy.description}</p>
          {items.map((item) => (
            <Link
              className="lane-item"
              href={narrativePath(item.slug)}
              key={item.id}
            >
              <div className="pill-row">
                <LifecycleBadge compact state={item.lifecycleState} />
                {(item.kind ?? "structural") === "event" ? (
                  <span className="pill kind-pill" title="A headline-driven narrative tied to a specific event; expires when the event does.">
                    event
                  </span>
                ) : null}
                {item.status === "probationary" ? (
                  <span className="pill" title={METRIC_GLOSSARY.probationary.description}>
                    probationary
                  </span>
                ) : null}
                {hasThinEvidence(item) ? <ThinEvidencePill compact /> : null}
              </div>
              <strong>{item.name}</strong>
              <span>{laneCaption(lane, item)}</span>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

function laneCaption(lane: NarrativeHomepageLane, item: NarrativeHomepageItem) {
  if (lane === "fading") {
    return `${peakSummary(item) ?? "—"} · ${signed(item.change)} vs prior week`;
  }
  if (lane === "emerging") {
    return `${item.attentionMatchedDocuments} classifier matches · ${item.matchedDocuments} reviewed · ${item.publisherOwnerBreadth} publisher groups`;
  }
  return `attention z ${item.attentionZScore.toFixed(1)} · ${signed(item.change)} vs prior week · ${item.storyBreadth} ${item.storyBreadth === 1 ? "story" : "stories"} from ${item.publisherOwnerBreadth} ${item.publisherOwnerBreadth === 1 ? "publisher group" : "publisher groups"}`;
}

function BriefPanel({
  dashboard,
  unavailable
}: {
  dashboard: NarrativeHomepageStatus;
  unavailable: boolean;
}) {
  const brief = dashboard.brief;
  return (
    <div className="panel brief" id="brief">
      <p className="eyebrow">
        Daily Brief{brief ? ` · ${formatMeasurementDate(brief.date)}` : ""}
      </p>
      {unavailable ? (
        <>
          <h2>Live narrative summary is temporarily unavailable.</h2>
          <p>Open Narrative Currents for the full board while the homepage summary recovers.</p>
        </>
      ) : brief ? (
        <>
          <h2>{brief.headline}</h2>
          <p>{brief.summary}</p>
          <div className="brief-sections">
            {brief.sections.map((section) => (
              <div key={section.title}>
                <h3>{section.title}</h3>
                <ul>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="label">
            Derived from stored measurements only; no model synthesis.{" "}
            <Link href="/changes">Full change log</Link>
          </p>
        </>
      ) : (
        <>
          <h2>No brief has been generated yet.</h2>
          <p>
            The daily brief is written from the latest published measurement by the
            scheduled brief job. <Link href="/changes">See what changed</Link> in the
            meantime.
          </p>
        </>
      )}
    </div>
  );
}

function NarrativeCard({
  evidenceDegraded,
  narrative
}: {
  evidenceDegraded: boolean;
  narrative: NarrativeHomepageItem;
}) {
  const peak = peakSummary(narrative);
  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <LifecycleBadge state={narrative.lifecycleState} />
          <span className="pill">{narrative.category}</span>
          <span className="pill">{narrative.kind ?? "structural"}</span>
          {narrative.status === "probationary" ? (
            <span className="pill" title={METRIC_GLOSSARY.probationary.description}>
              probationary
            </span>
          ) : null}
          <span className="pill" title={METRIC_GLOSSARY.uniqueStories.description}>
            {narrative.storyBreadth} unique stories
          </span>
          <span className="pill" title={METRIC_GLOSSARY.publisherGroups.description}>
            {narrative.publisherOwnerBreadth} publisher groups
          </span>
          {peak ? (
            <span className="pill" title={METRIC_GLOSSARY.peak.description}>
              {peak}
            </span>
          ) : null}
          {hasThinEvidence(narrative) ? <ThinEvidencePill /> : null}
          {narrative.lowHistory ? (
            <span className="pill warning-pill" title={METRIC_GLOSSARY.thinBaseline.description}>
              thin baseline
            </span>
          ) : null}
        </div>
        <h2>{narrative.name}</h2>
        {narrative.eventLabel ? <p className="label">{narrative.eventLabel}</p> : null}
        <p>{narrative.proposition}</p>
        <p>{narrativeSummary(narrative)}</p>
        <details className="detail-block">
          <summary>Reviewed evidence</summary>
          <div className="grid">
            {narrative.evidencePreview.length === 0 ? (
              <div className="evidence-card">
                <p>
                  {evidenceDegraded
                    ? "Evidence preview is temporarily unavailable."
                    : "No current seven-day citation preview is available."}
                </p>
              </div>
            ) : (
              narrative.evidencePreview.map((evidence) => (
                <div className="evidence-card" key={evidence.id}>
                  <span className="label">
                    Sourced evidence · {evidence.publisher} ·{" "}
                    {evidence.sourceClass.replaceAll("_", " ")}
                  </span>
                  <h3>{evidence.title}</h3>
                  <blockquote>{evidence.evidenceSnippet}</blockquote>
                </div>
              ))
            )}
            <Link className="pill" href="/trends">
              Open full trend view
            </Link>
            <Link className="pill" href={narrativePath(narrative.slug)}>
              Open live storyboard
            </Link>
          </div>
        </details>
      </div>
      <div className="score-stack">
        <div className="score">
          <span className="label">
            <MetricTerm term="attentionZScore" short />
          </span>
          <strong>{narrative.attentionZScore.toFixed(1)}</strong>
        </div>
        <div className="score">
          <span className="label">
            <MetricTerm term="change" short />
          </span>
          <strong className={narrative.change >= 0 ? "rising" : "fading"}>
            {signed(narrative.change)}
          </strong>
        </div>
        <div className="score">
          <span className="label">
            <MetricTerm term="density" />
          </span>
          <strong>{narrative.density.toFixed(1)}</strong>
        </div>
        <Link className="pill" href={narrativeDataPath(narrative.slug)}>
          Details
        </Link>
      </div>
    </article>
  );
}

function narrativeSummary(narrative: NarrativeHomepageItem) {
  if (narrative.density <= 0) {
    return [
      `No approved evidence this week; raw attention density is ${narrative.attentionDensity.toFixed(1)}% across ${narrative.attentionMatchedDocuments} classifier matches awaiting review.`,
      narrative.lowHistory
        ? `The baseline has ${narrative.baselineWindows} comparison windows so far; z-scores are provisional.`
        : `Reviewed z-score ${narrative.zScore.toFixed(1)}, ${narrative.percentileRank}th percentile of its own history.`
    ].join(" ");
  }
  return [
    `Reviewed seven-day density is ${narrative.density.toFixed(1)}% (${signed(narrative.change)} vs the prior window); raw attention density is ${narrative.attentionDensity.toFixed(1)}% across ${narrative.attentionMatchedDocuments} classifier matches.`,
    `${narrative.storyBreadth} unique ${narrative.storyBreadth === 1 ? "story spans" : "stories span"} ${narrative.publisherOwnerBreadth} publisher ${narrative.publisherOwnerBreadth === 1 ? "group" : "groups"} and ${narrative.sourceClassBreadth} source ${narrative.sourceClassBreadth === 1 ? "class" : "classes"}.`,
    narrative.lowHistory
      ? `The baseline has ${narrative.baselineWindows} comparison windows so far; z-scores are provisional.`
      : `Reviewed z-score ${narrative.zScore.toFixed(1)}, ${narrative.percentileRank}th percentile of its own history.`
  ].join(" ");
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
