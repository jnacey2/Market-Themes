import Link from "next/link";
import {
  getLiveDashboardStatus,
  type TrendSummary
} from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dashboard = await getLiveDashboardStatus().catch((error) => {
    console.warn(
      `[web] live dashboard failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return {
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      degraded: true,
      totalTrendRows: 0,
      latestTrendDate: null,
      confirmedSevenDayThemes: [],
      emergingSevenDayThemes: [],
      confirmedThirtyDayThemes: []
    };
  });
  const topSevenDayThemes = topDashboardThemes(
    dashboard.confirmedSevenDayThemes,
    dashboard.emergingSevenDayThemes,
    5
  );
  const topTheme = topSevenDayThemes[0] ?? dashboard.confirmedThirtyDayThemes[0];
  const averageZScore =
    topSevenDayThemes.length > 0
      ? topSevenDayThemes.reduce((total, theme) => total + theme.zScore, 0) /
        topSevenDayThemes.length
      : 0;
  const brief = dashboard.degraded && !topTheme
    ? {
        headline: "Theme rankings are delayed.",
        summary:
          "The homepage could not finish reading theme_trends in time. Open Narrative Currents for the live board, then retry this page after the database is less busy."
      }
    : buildDashboardBrief(
        topSevenDayThemes,
        dashboard.confirmedThirtyDayThemes
      );

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Market Themes</div>
        <div className="nav-links">
          <a href="#themes">Themes</a>
          <a href="#brief">Daily Brief</a>
          <a href="#copilot">Copilot</a>
          <Link href="/ingestion">Ingestion</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/trends">Trends</Link>
          <Link href="/narrative-candidates">Candidates</Link>
          <Link href="/theme-mappings">Theme Mappings</Link>
        </div>
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
            {topTheme?.themeLabel ??
              (dashboard.degraded
                ? "Theme rankings are delayed"
                : "No confirmed live themes yet")}
          </h2>
          <p>
            {topTheme
              ? themeSummary(topTheme)
              : dashboard.degraded
                ? "The live dashboard query timed out on the database. Narrative Currents is still available."
                : dashboard.databaseConfigured
                  ? "Run extraction, theme normalization, and trend recompute to populate the live dashboard."
                  : "Set DATABASE_URL to connect the dashboard to live trend data."}
          </p>
          <div className="metric-row">
            <div className="metric">
              <span>Z-score</span>
              <strong>{topTheme?.zScore.toFixed(1) ?? "0.0"}</strong>
            </div>
            <div className="metric">
              <span>Evidence</span>
              <strong>{topTheme?.evidenceCount ?? 0}</strong>
            </div>
            <div className="metric">
              <span>Entities</span>
              <strong>{topTheme?.entityBreadth ?? 0}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <span className="label">Coverage</span>
          <h2>S&P 500 + Nasdaq-100</h2>
          <p>Initial scope targets US equities plus macro themes.</p>
        </div>
        <div className="panel">
          <span className="label">Signal</span>
          <h2>{averageZScore.toFixed(1)} avg z-score</h2>
          <p>
            Showing the top {topSevenDayThemes.length} ranked 7-day market themes,
            including {dashboard.confirmedSevenDayThemes.length} confirmed by the breadth gate.
          </p>
        </div>
        <div className="panel">
          <span className="label">Latest trend date</span>
          <h2>
            {dashboard.latestTrendDate ??
              (dashboard.degraded ? "Temporarily unavailable" : "None yet")}
          </h2>
          <p>
            {dashboard.degraded
              ? "Ranking query hit the dashboard timeout. Open Narrative Currents for live measurements."
              : `${dashboard.totalTrendRows} live trend rows currently stored.`}
          </p>
        </div>
      </section>

      <section className="section" id="themes">
        <p className="eyebrow">Top Market Themes</p>
        <div className="grid">
          {topSevenDayThemes.length === 0 ? (
            <div className="panel">
              <h2>
                {dashboard.degraded
                  ? "Live theme cards are delayed"
                  : "No ranked 7-day themes yet"}
              </h2>
              <p>
                {dashboard.degraded
                  ? "The homepage ranking query did not finish in time. Narrative Currents still loads from a smaller table."
                  : "Run extraction, theme normalization, and trend recompute to populate the live theme list."}
              </p>
              <Link className="pill" href="/trends">
                Open Narrative Currents
              </Link>
            </div>
          ) : (
            topSevenDayThemes.map((theme) => (
              <ThemeCard key={theme.id} theme={theme} />
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

function topDashboardThemes(
  confirmedThemes: TrendSummary[],
  emergingThemes: TrendSummary[],
  limit: number
) {
  const themes = new Map<string, TrendSummary>();

  for (const theme of [...confirmedThemes, ...emergingThemes]) {
    if (!themes.has(theme.themeId)) {
      themes.set(theme.themeId, theme);
    }
  }

  return Array.from(themes.values()).slice(0, limit);
}

function ThemeCard({ theme }: { theme: TrendSummary }) {
  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <span className="pill">{theme.trendWindow}</span>
          <span className="pill">z {theme.zScore.toFixed(1)}</span>
          <span className="pill">{theme.percentileRank}th pctile</span>
          <span className="pill">{theme.evidenceCount} evidence</span>
          <span className="pill">{independentDocumentCount(theme)} docs</span>
          <span className="pill">{theme.entityBreadth} entities</span>
        </div>
        <h2>{theme.themeLabel}</h2>
        <p>{themeDescription(theme)}</p>
        <p>{themeSummary(theme)}</p>
        {theme.affectedEntities.length > 0 ? (
          <div className="pill-row">
            {theme.affectedEntities.slice(0, 6).map((entity) => (
              <span className="pill" key={entity}>
                {entity}
              </span>
            ))}
          </div>
        ) : null}
        <details className="detail-block">
          <summary>Drill down: companies and citations</summary>
          <div className="grid">
            <div className="panel">
              <span className="label">Affected companies and entities</span>
              {theme.affectedEntities.length === 0 ? (
                <p>No affected entities were extracted for this theme yet.</p>
              ) : (
                <div className="pill-row">
                  {theme.affectedEntities.map((entity) => (
                    <span className="pill" key={entity}>
                      {entity}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {theme.recentEvidence.length === 0 ? (
              <div className="evidence-card">
                <p>No citation snippets available for this theme yet.</p>
              </div>
            ) : (
              theme.recentEvidence.map((evidence) => (
                <div className="evidence-card" key={evidence.id}>
                  <span className="label">
                    {evidence.publisher} · {evidence.sourceClass.replace("_", " ")}
                  </span>
                  <h3>{evidence.title}</h3>
                  <p>{evidence.snippet}</p>
                </div>
              ))
            )}
            <Link className="pill" href="/trends">
              Open full trend view
            </Link>
            <Link className="pill" href={`/themes/${encodeURIComponent(theme.themeId)}`}>
              Open theme detail
            </Link>
          </div>
        </details>
      </div>
      <div className="score-stack">
        <div className="score">
          <span className="label">Z-score</span>
          <strong>{theme.zScore.toFixed(1)}</strong>
        </div>
        <div className="score">
          <span className="label">Intensity</span>
          <strong>{theme.intensity.toFixed(1)}</strong>
        </div>
        <Link className="pill" href={`/themes/${encodeURIComponent(theme.themeId)}`}>
          Details
        </Link>
      </div>
    </article>
  );
}

function buildDashboardBrief(sevenDayThemes: TrendSummary[], thirtyDayThemes: TrendSummary[]) {
  const lead = sevenDayThemes[0] ?? thirtyDayThemes[0];
  const context = thirtyDayThemes.find((theme) => theme.themeId !== lead?.themeId);

  if (!lead) {
    return {
      headline: "No confirmed live market themes yet.",
      summary:
        "Run ingestion, Claude extraction, theme normalization, and trend recompute to populate the live daily brief."
    };
  }

  return {
    headline: `${lead.themeLabel} is the top confirmed live theme.`,
    summary: [
      `${lead.themeLabel} leads the 7-day digest with ${lead.evidenceCount} evidence items across ${independentDocumentCount(
        lead
      )} documents and ${lead.entityBreadth} entities.`,
      context
        ? `${context.themeLabel} is the main 30-day context theme, with a z-score of ${context.zScore.toFixed(
            1
          )}.`
        : "No separate 30-day context theme currently clears the breadth gate."
    ].join(" ")
  };
}

function themeSummary(theme: TrendSummary) {
  return `Intensity ${theme.intensity.toFixed(1)} vs baseline ${theme.baselineMean.toFixed(
    1
  )}, with ${theme.evidenceCount} evidence items across ${independentDocumentCount(
    theme
  )} documents and ${theme.entityBreadth} entities.`;
}

function themeDescription(theme: TrendSummary) {
  if (theme.themeDescription.trim()) {
    return theme.themeDescription;
  }

  return "A normalized market narrative assembled from extracted filing and transcript evidence.";
}

function independentDocumentCount(theme: TrendSummary) {
  return theme.documentBreadth > 0 ? theme.documentBreadth : theme.evidenceCount;
}
