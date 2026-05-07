import Link from "next/link";
import { getTrendStatus, type TrendSummary } from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const status = await getTrendStatus();
  const sevenDayTrends = status.trends.filter((trend) => trend.trendWindow === "7d");
  const thirtyDayTrends = status.trends.filter((trend) => trend.trendWindow === "30d");

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/ingestion">Ingestion</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Trend Aggregation</p>
          <h1>Audit real theme momentum.</h1>
          <p className="lede">
            Review deterministic trend scores computed from Claude-extracted
            signals before they replace the mock dashboard storyboards.
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
        <Metric label="7-day themes" value={sevenDayTrends.length} />
        <Metric label="30-day themes" value={thirtyDayTrends.length} />
      </section>

      <TrendSection
        title="7-day ranked trends"
        description="Default view for emerging narrative changes."
        trends={sevenDayTrends}
      />
      <TrendSection
        title="30-day context"
        description="Slower moving view for steadier changes."
        trends={thirtyDayTrends}
      />
    </div>
  );
}

function TrendSection({
  title,
  description,
  trends
}: {
  title: string;
  description: string;
  trends: TrendSummary[];
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
          trends.map((trend) => <TrendCard key={trend.id} trend={trend} />)
        )}
      </div>
    </section>
  );
}

function TrendCard({ trend }: { trend: TrendSummary }) {
  return (
    <article className="storyboard-card">
      <div>
        <div className="pill-row">
          <span className="pill">{trend.trendWindow}</span>
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
        <div className="pill-row">
          {Object.entries(trend.sourceMix).map(([sourceClass, count]) => (
            <span className="pill" key={sourceClass}>
              {sourceClass} {count}
            </span>
          ))}
        </div>
        <div className="grid">
          {trend.recentEvidence.map((evidence) => (
            <div className="evidence-card" key={evidence.id}>
              <p>{evidence.snippet}</p>
              <p>
                <strong>{evidence.title}</strong> · {evidence.publisher}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="score-stack">
        <Score label="Z-score" value={trend.zScore} />
        <Score label="Intensity" value={trend.intensity} />
        <Score label="Baseline" value={trend.baselineMean} />
      </div>
    </article>
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
