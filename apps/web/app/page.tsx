import Link from "next/link";
import {
  getNarrativeHomepageStatus,
  type NarrativeHomepageItem,
  type NarrativeHomepageLane,
  type NarrativeHomepageStatus
} from "@market-themes/db";
import {
  LifecycleBadge,
  peakSummary
} from "../components/narratives/LifecycleBadge";

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
    title: "New and emerging",
    description: "Probationary, recently activated, or measured with a thin baseline.",
    empty: "No new or probationary narratives are measured yet."
  }
};

export default async function HomePage() {
  const dashboard = await getNarrativeHomepageStatus();
  const leadNarrative =
    dashboard.lanes.rising[0] ??
    dashboard.lanes.peaking[0] ??
    dashboard.narratives[0] ??
    null;
  const summaryUnavailable =
    !dashboard.databaseConfigured ||
    (dashboard.degraded && dashboard.narratives.length === 0);
  const laneCount = (Object.keys(LANE_COPY) as NarrativeHomepageLane[]).reduce(
    (total, lane) => total + dashboard.lanes[lane].length,
    0
  );

  return (
    <div className="shell">
      <nav className="page-jump-nav" aria-label="On this page">
        <span>On this page</span>
        <a href="#lanes">Lifecycle lanes</a>
        <a href="#narratives">Most surprising</a>
        <a href="#brief">Daily Brief</a>
        <a href="#copilot">Copilot</a>
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
                : dashboard.degraded
                  ? "Narrative summary is delayed"
                  : "Awaiting a published 7-day signal")}
          </h2>
          {leadNarrative ? (
            <div className="pill-row">
              <LifecycleBadge state={leadNarrative.lifecycleState} />
              {peakSummary(leadNarrative) ? (
                <span className="pill">{peakSummary(leadNarrative)}</span>
              ) : null}
            </div>
          ) : null}
          <p>
            {leadNarrative
              ? leadNarrative.proposition
              : !dashboard.databaseConfigured
                ? "Connect the research database to load reviewed narratives."
                : dashboard.degraded
                  ? "The lightweight narrative summary could not finish. Open Narrative Currents for the full live board."
                  : "Reviewed evidence may exist historically or await the next narrative trend publication."}
          </p>
          <div className="metric-row">
            <div className="metric">
              <span>Attention z</span>
              <strong>
                {leadNarrative ? leadNarrative.attentionZScore.toFixed(1) : "—"}
              </strong>
            </div>
            <div className="metric">
              <span>7d change</span>
              <strong>{leadNarrative ? signed(leadNarrative.change) : "—"}</strong>
            </div>
            <div className="metric">
              <span>Unique stories</span>
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
          <h2>{summaryUnavailable ? "Unavailable" : `${laneCount} narratives`}</h2>
          <p>
            Rising, peaking, fading, or emerging as of the latest measurement.{" "}
            <Link href="/changes">See what changed</Link>.
          </p>
        </div>
        <div className="panel">
          <span className="label">Latest measurement</span>
          <h2>
            {dashboard.latestDate ??
              (dashboard.degraded ? "Temporarily unavailable" : "None yet")}
          </h2>
          <p>
            {!dashboard.databaseConfigured
              ? "Connect the research database to measure current narratives."
              : dashboard.degraded
                ? "Some live summary data is temporarily unavailable; displayed zeroes should not be treated as measurements."
                : "Reviewed density uses approved evidence only. Attention z-scores also count pending classifier matches."}
          </p>
        </div>
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
        <div className="grid">
          {dashboard.narratives.length === 0 ? (
            <div className="panel">
              <h2>
                {dashboard.degraded
                  ? "Live narrative cards are delayed"
                  : !dashboard.databaseConfigured
                    ? "Narrative database is unavailable"
                    : "No measured 7-day narrative signals yet"}
              </h2>
              <p>
                {dashboard.degraded
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
  return (
    <div className="lane" aria-label={`${copy.title} narratives`}>
      <div className="lane-header">
        <h2>{copy.title}</h2>
        <small>{items.length}</small>
      </div>
      <p className="lane-empty">{copy.description}</p>
      {unavailable ? (
        <p className="lane-empty">Unavailable.</p>
      ) : items.length === 0 ? (
        <p className="lane-empty">{copy.empty}</p>
      ) : (
        items.map((item) => (
          <Link
            className="lane-item"
            href={`/storyboards/${encodeURIComponent(item.slug)}`}
            key={item.id}
          >
            <div className="pill-row">
              <LifecycleBadge compact state={item.lifecycleState} />
              {item.status === "probationary" ? (
                <span className="pill">probationary</span>
              ) : null}
            </div>
            <strong>{item.name}</strong>
            <span>
              {lane === "fading"
                ? `${peakSummary(item) ?? "—"} · ${signed(item.change)} vs prior week`
                : lane === "emerging"
                  ? `${item.attentionMatchedDocuments} classifier matches · ${item.matchedDocuments} reviewed · ${item.publisherOwnerBreadth} publisher groups`
                  : `attention z ${item.attentionZScore.toFixed(1)} · ${signed(item.change)} vs prior week · ${item.storyBreadth} stories`}
            </span>
          </Link>
        ))
      )}
    </div>
  );
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
        Daily Brief{brief ? ` · ${brief.date}` : ""}
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
            <span className="pill">probationary</span>
          ) : null}
          <span className="pill">{narrative.storyBreadth} unique stories</span>
          <span className="pill">{narrative.publisherOwnerBreadth} publisher groups</span>
          {peak ? <span className="pill">{peak}</span> : null}
          {narrative.lowHistory ? (
            <span className="pill warning-pill">thin baseline</span>
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
            <Link
              className="pill"
              href={`/storyboards/${encodeURIComponent(narrative.slug)}`}
            >
              Open live storyboard
            </Link>
          </div>
        </details>
      </div>
      <div className="score-stack">
        <div className="score">
          <span className="label">Attention z</span>
          <strong>{narrative.attentionZScore.toFixed(1)}</strong>
        </div>
        <div className="score">
          <span className="label">7d change</span>
          <strong className={narrative.change >= 0 ? "rising" : "fading"}>
            {signed(narrative.change)}
          </strong>
        </div>
        <div className="score">
          <span className="label">Reviewed density</span>
          <strong>{narrative.density.toFixed(1)}</strong>
        </div>
        <Link className="pill" href={`/themes/${encodeURIComponent(narrative.id)}`}>
          Details
        </Link>
      </div>
    </article>
  );
}

function narrativeSummary(narrative: NarrativeHomepageItem) {
  return [
    `Reviewed seven-day density is ${narrative.density.toFixed(1)}% (${signed(narrative.change)} vs the prior window); raw attention density is ${narrative.attentionDensity.toFixed(1)}% across ${narrative.attentionMatchedDocuments} classifier matches.`,
    `${narrative.storyBreadth} unique stories span ${narrative.publisherOwnerBreadth} publisher groups and ${narrative.sourceClassBreadth} source classes.`,
    narrative.lowHistory
      ? `The baseline has ${narrative.baselineWindows} comparison windows so far; z-scores are provisional.`
      : `Reviewed z-score ${narrative.zScore.toFixed(1)}, ${narrative.percentileRank}th percentile of its own history.`
  ].join(" ");
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
