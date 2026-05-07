import Link from "next/link";
import { getTrendStatus, type TrendSummary } from "@market-themes/db";

export const dynamic = "force-dynamic";

const MARKET_THEME_LIMIT = 8;
const SECTOR_CHILD_LIMIT = 4;
const CONTEXT_THEME_LIMIT = 6;

export default async function TrendsPage() {
  const status = await getTrendStatus();
  const allMarketSevenDayTrends = rankDigestTrends(
    status.trends.filter((trend) => trend.trendWindow === "7d" && trend.themeLevel === "market")
  );
  const marketSevenDayTrends = allMarketSevenDayTrends.slice(0, MARKET_THEME_LIMIT);
  const sectorSevenDayTrends = status.trends.filter(
    (trend) => trend.trendWindow === "7d" && trend.themeLevel === "sector"
  );
  const unmappedSevenDayTrends = status.trends.filter(
    (trend) => trend.trendWindow === "7d" && trend.themeLevel === "unmapped"
  );
  const thirtyDayTrends = rankDigestTrends(
    status.trends.filter((trend) => trend.trendWindow === "30d" && trend.themeLevel === "market")
  ).slice(0, CONTEXT_THEME_LIMIT);
  const visibleSectorCount = sectorSevenDayTrends.filter((trend) =>
    marketSevenDayTrends.some((marketTrend) => marketTrend.themeId === trend.parentThemeId)
  ).length;

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/theme-mappings">Theme Mappings</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/ingestion">Ingestion</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Trend Aggregation</p>
          <h1>Market theme digest.</h1>
          <p className="lede">
            A short ranked view of normalized market narratives. Expand each
            theme for sector sub-themes and evidence; use Theme Mappings for the
            full audit trail.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Latest Trend Date</p>
          <h2>{status.latestTrendDate ?? "None yet"}</h2>
          <p>
            {status.databaseConfigured
              ? `${status.totalTrendRows} trend rows stored across 7-day and 30-day windows.`
              : "Set DATABASE_URL to inspect trend rows."}
          </p>
        </div>
      </section>

      <section className="grid three">
        <Metric label="Trend rows" value={status.totalTrendRows} />
        <Metric label="Market themes" value={marketSevenDayTrends.length} />
        <Metric label="Nested sub-themes" value={visibleSectorCount} />
      </section>

      <DigestSection
        marketTrends={marketSevenDayTrends}
        sectorTrends={sectorSevenDayTrends}
      />
      <TrendSection
        title="30-day context"
        description="Top slower-moving overall market themes."
        trends={thirtyDayTrends}
        compact
      />
      <DebugSummary unmappedCount={unmappedSevenDayTrends.length} />
    </div>
  );
}

function DigestSection({
  marketTrends,
  sectorTrends
}: {
  marketTrends: TrendSummary[];
  sectorTrends: TrendSummary[];
}) {
  return (
    <section className="section">
      <p className="eyebrow">Top Overall Market Themes</p>
      <p className="lede">
        Showing the highest-signal normalized narratives. Sector sub-themes and
        evidence are collapsed to keep the page readable.
      </p>
      <div className="grid">
        {marketTrends.length === 0 ? (
          <div className="panel">
            <h2>No market themes yet</h2>
            <p>Run npm run themes:normalize, then recompute trends.</p>
          </div>
        ) : (
          marketTrends.map((trend, index) => (
            <MarketThemeCard
              key={trend.id}
              rank={index + 1}
              trend={trend}
              sectorTrends={rankDigestTrends(
                sectorTrends.filter((sectorTrend) => sectorTrend.parentThemeId === trend.themeId)
              ).slice(0, SECTOR_CHILD_LIMIT)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function TrendSection({
  title,
  description,
  trends,
  compact = false
}: {
  title: string;
  description: string;
  trends: TrendSummary[];
  compact?: boolean;
}) {
  return (
    <section className="section">
      <p className="eyebrow">{title}</p>
      <p className="lede">{description}</p>
      <div className="grid">
        {trends.length === 0 ? (
          <div className="panel">
            <h2>No trend rows yet</h2>
            <p>Run npm run trends:recompute --workspace @market-themes/workers.</p>
          </div>
        ) : (
          trends.map((trend) => <TrendCard compact={compact} key={trend.id} trend={trend} />)
        )}
      </div>
    </section>
  );
}

function MarketThemeCard({
  rank,
  trend,
  sectorTrends
}: {
  rank: number;
  trend: TrendSummary;
  sectorTrends: TrendSummary[];
}) {
  const topEvidence = trend.recentEvidence[0];

  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <span className="pill">#{rank}</span>
          <span className="pill">7d</span>
          <span className="pill">z {trend.zScore.toFixed(2)}</span>
          <span className="pill">{trend.evidenceCount} evidence</span>
          <span className="pill">{trend.entityBreadth} entities</span>
          {trend.lowHistory ? <span className="pill">low history</span> : null}
        </div>
        <h2>{trend.themeLabel}</h2>
        <p>
          Intensity {trend.intensity.toFixed(2)} vs baseline {trend.baselineMean.toFixed(2)}.
          Source breadth {trend.sourceDiversity}, entity breadth {trend.entityBreadth}.
        </p>
        {topEvidence ? (
          <div className="evidence-card">
            <p>{topEvidence.snippet}</p>
            <p>
              <strong>{topEvidence.title}</strong> · {topEvidence.publisher}
            </p>
          </div>
        ) : null}
        {sectorTrends.length > 0 ? (
          <details className="detail-block">
            <summary>Show {sectorTrends.length} sector sub-theme{sectorTrends.length === 1 ? "" : "s"}</summary>
            <div className="grid">
              {sectorTrends.map((sectorTrend) => (
                <TrendCard compact key={sectorTrend.id} trend={sectorTrend} />
              ))}
            </div>
          </details>
        ) : null}
        {trend.recentEvidence.length > 1 ? (
          <details className="detail-block">
            <summary>Show more evidence</summary>
            <div className="grid">
              {trend.recentEvidence.slice(1).map((evidence) => (
                <div className="evidence-card" key={evidence.id}>
                  <p>{evidence.snippet}</p>
                  <p>
                    <strong>{evidence.title}</strong> · {evidence.publisher}
                  </p>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="score-stack">
        <Score label="Z-score" value={trend.zScore} />
        <Score label="Intensity" value={trend.intensity} />
        <Score label="Entities" value={trend.entityBreadth} />
      </div>
    </article>
  );
}

function TrendCard({ trend, compact = false }: { trend: TrendSummary; compact?: boolean }) {
  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <span className="pill">{trend.trendWindow}</span>
          <span className="pill">{trend.themeLevel}</span>
          <span className="pill">z {trend.zScore.toFixed(2)}</span>
          <span className="pill">{trend.percentileRank}th pctile</span>
          {trend.lowHistory ? <span className="pill">low history</span> : null}
          {trend.candidate ? <span className="pill">candidate</span> : null}
        </div>
        <h2>{trend.themeLabel}</h2>
        <p>
          Intensity {trend.intensity.toFixed(2)} vs baseline{" "}
          {trend.baselineMean.toFixed(2)}. Evidence count {trend.evidenceCount},
          source breadth {trend.sourceDiversity}, entity breadth {trend.entityBreadth}.
        </p>
        {!compact ? (
          <>
            <div className="pill-row">
              {Object.entries(trend.sourceMix).map(([sourceClass, count]) => (
                <span className="pill" key={sourceClass}>
                  {sourceClass} {count}
                </span>
              ))}
            </div>
            <EvidenceList evidence={trend.recentEvidence} />
          </>
        ) : null}
      </div>
      <div className="score-stack">
        <Score label="Z-score" value={trend.zScore} />
        <Score label="Intensity" value={trend.intensity} />
        <Score label="Baseline" value={trend.baselineMean} />
      </div>
    </article>
  );
}

function EvidenceList({ evidence }: { evidence: TrendSummary["recentEvidence"] }) {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="grid">
      {evidence.map((item) => (
        <div className="evidence-card" key={item.id}>
          <p>{item.snippet}</p>
          <p>
            <strong>{item.title}</strong> · {item.publisher}
          </p>
        </div>
      ))}
    </div>
  );
}

function DebugSummary({ unmappedCount }: { unmappedCount: number }) {
  return (
    <section className="section">
      <div className="panel">
        <p className="eyebrow">Audit Details</p>
        <h2>Debug rows moved out of the digest</h2>
        <p>
          {unmappedCount} unmapped extracted themes are hidden from this digest.
          Review them in <Link href="/theme-mappings">Theme Mappings</Link> instead of
          letting them clog the main trend page.
        </p>
      </div>
    </section>
  );
}

function rankDigestTrends(trends: TrendSummary[]) {
  return [...trends].sort((left, right) => digestScore(right) - digestScore(left));
}

function digestScore(trend: TrendSummary) {
  return (
    trend.zScore * 4 +
    Math.log1p(trend.evidenceCount) +
    Math.log1p(trend.entityBreadth) +
    Math.log1p(trend.sourceDiversity) -
    (trend.lowHistory ? 1 : 0)
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel">
      <span className="label">{label}</span>
      <h2>{value}</h2>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="score">
      <span className="label">{label}</span>
      <strong>{value.toFixed(1)}</strong>
    </div>
  );
}
