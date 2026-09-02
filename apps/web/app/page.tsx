import Link from "next/link";
import {
  getNarrativeHomepageStatus,
  type NarrativeHomepageItem
} from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getNarrativeHomepageStatus();
  const leadNarrative = dashboard.narratives[0];
  const summaryUnavailable =
    !dashboard.databaseConfigured ||
    (dashboard.degraded && dashboard.narratives.length === 0);
  const brief =
    summaryUnavailable
      ? {
          headline: "Live narrative summary is temporarily unavailable.",
          summary:
            "Open Narrative Currents for the full board while the homepage summary recovers."
        }
      : buildNarrativeBrief(dashboard.narratives);

  return (
    <div className="shell">
      <nav className="page-jump-nav" aria-label="On this page">
        <span>On this page</span>
        <a href="#narratives">Narratives</a>
        <a href="#brief">Daily Brief</a>
        <a href="#copilot">Copilot</a>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Narrative Intelligence</p>
          <h1>See which market stories are actually changing.</h1>
          <p className="lede">
            Track emerging risks and bullish themes across filings, transcripts,
            press releases, and news. Each storyboard explains the narrative,
            why it is unusual, and the evidence behind the signal.
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
              <span>Unique stories</span>
              <strong>{leadNarrative?.storyBreadth ?? "—"}</strong>
            </div>
            <div className="metric">
              <span>Publisher groups</span>
              <strong>{leadNarrative?.publisherOwnerBreadth ?? "—"}</strong>
            </div>
            <div className="metric">
              <span>Classification coverage</span>
              <strong>
                {leadNarrative
                  ? `${leadNarrative.classificationCoveragePercent}%`
                  : "—"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <span className="label">Tracked narratives</span>
          <h2>
            {summaryUnavailable
              ? "Unavailable"
              : dashboard.trackedNarrativeCount}
          </h2>
          <p>Versioned propositions measured from reviewed source evidence.</p>
        </div>
        <div className="panel">
          <span className="label">Homepage focus</span>
          <h2>
            {summaryUnavailable
              ? "Unavailable"
              : `${dashboard.narratives.length} active signals`}
          </h2>
          <p>
            Ranked by unique-story breadth and source diversity, not immature
            z-scores or raw article count.
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
              : "Approved evidence only. Pending and rejected matches are excluded."}
          </p>
        </div>
      </section>

      <section className="section" id="narratives">
        <p className="eyebrow">Leading Market Narratives</p>
        <div className="grid">
          {dashboard.narratives.length === 0 ? (
            <div className="panel">
              <h2>
                {dashboard.degraded
                  ? "Live narrative cards are delayed"
                  : !dashboard.databaseConfigured
                    ? "Narrative database is unavailable"
                    : "No published 7-day narrative signals yet"}
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
            dashboard.narratives.map((narrative) => (
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
        <div className="panel brief" id="brief">
          <p className="eyebrow">Daily Brief</p>
          <h2>{brief.headline}</h2>
          <p>{brief.summary}</p>
        </div>
        <div className="panel" id="copilot">
          <p className="eyebrow">Research Copilot</p>
          <h2>Ask from the evidence, not the model&apos;s memory.</h2>
          <div className="copilot-box">
            What are management teams saying about consumer weakness this week?
          </div>
          <p>
            The first copilot will retrieve storyboard evidence and document
            chunks, then answer with citations and clear separation between
            sourced evidence and interpretation.
          </p>
        </div>
      </section>
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
  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <span className="pill">{narrative.category}</span>
          <span className="pill">{narrative.kind ?? "structural"}</span>
          <span className="pill">{narrative.trendWindow}</span>
          <span className="pill">{narrative.matchedDocuments} reviewed docs</span>
          <span className="pill">{narrative.storyBreadth} unique stories</span>
          <span className="pill">
            {narrative.publisherOwnerBreadth} publisher groups
          </span>
          {narrative.coverageStatus !== "measured" ? (
            <span className="pill warning-pill">
              {narrative.coverageStatus === "backfill_pending"
                ? "classification pending"
                : narrative.coverageStatus === "no_corpus"
                  ? "no recent corpus"
                  : narrative.coverageStatus === "measured_zero"
                    ? "measured zero"
                : `${narrative.classificationCoveragePercent}% classified`}
            </span>
          ) : null}
          {narrative.lowHistory ? (
            <span className="pill warning-pill">building baseline</span>
          ) : null}
        </div>
        <h2>{narrative.name}</h2>
        {narrative.eventLabel ? (
          <p className="label">{narrative.eventLabel}</p>
        ) : null}
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
                    {evidence.publisher} ·{" "}
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
          <span className="label">Density</span>
          <strong>{narrative.density.toFixed(1)}</strong>
        </div>
        <div className="score">
          <span className="label">Unique stories</span>
          <strong>{narrative.storyBreadth}</strong>
        </div>
        <Link
          className="pill"
          href={`/themes/${encodeURIComponent(narrative.id)}`}
        >
          Details
        </Link>
      </div>
    </article>
  );
}

function buildNarrativeBrief(narratives: NarrativeHomepageItem[]) {
  const lead = narratives[0];
  const context = narratives[1];
  if (!lead) {
    return {
      headline: "No published 7-day narrative signal yet.",
      summary:
        "Reviewed evidence may be historical or awaiting the next scheduled narrative trend publication."
    };
  }

  return {
    headline: `${lead.name} has the broadest reviewed evidence.`,
    summary: [
      `${lead.name} appears in ${lead.storyBreadth} unique stories across ${lead.publisherOwnerBreadth} publisher groups.`,
      context
        ? `${context.name} is the next-broadest current narrative with ${context.storyBreadth} unique stories.`
        : "No second narrative currently has reviewed evidence."
    ].join(" ")
  };
}

function narrativeSummary(narrative: NarrativeHomepageItem) {
  return [
    `Seven-day attention density is ${narrative.density.toFixed(1)}%.`,
    `${narrative.storyBreadth} unique stories span ${narrative.publisherOwnerBreadth} publisher groups and ${narrative.sourceClassBreadth} source classes.`,
    `${narrative.eligibleDocuments} of ${narrative.corpusDocuments} readable documents are classified (${narrative.classificationCoveragePercent}%).`,
    narrative.lowHistory
      ? "The historical baseline is still building."
      : "Evidence breadth, rather than the immature z-score, determines homepage priority."
  ].join(" ");
}
