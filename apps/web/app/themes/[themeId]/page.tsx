import { notFound, permanentRedirect } from "next/navigation";
import {
  getThemeDetailStatus,
  getNarrativeDetailStatus,
  type ThemeDetailStatus,
  type ThemeTrendPoint,
  type TrendSummary
} from "@market-themes/db";
import { isNarrativeDefinitionId, narrativeDataPath } from "../../../lib/narrative-paths";

export const dynamic = "force-dynamic";

type ThemePageProps = {
  params: Promise<{
    themeId: string;
  }>;
};

export default async function ThemeDetailPage({ params }: ThemePageProps) {
  const { themeId } = await params;
  const decodedId = decodeURIComponent(themeId);

  // Narrative definitions used to render here under their raw id. They now have
  // slug routes; keep the old links working.
  if (isNarrativeDefinitionId(decodedId)) {
    const narrative = await getNarrativeDetailStatus(decodedId);
    if (narrative) {
      permanentRedirect(narrativeDataPath(narrative.slug));
    }
  }

  const detail = await getThemeDetailStatus(decodeURIComponent(themeId));

  if (detail.databaseConfigured && !detail.theme) {
    notFound();
  }

  const primaryTrend = detail.sevenDayTrend ?? detail.thirtyDayTrend;

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Theme Detail</p>
          <h1>{detail.theme?.label ?? "Theme data unavailable"}</h1>
          <p className="lede">
            {detail.theme?.description ||
              "Set DATABASE_URL and recompute trends to inspect this theme."}
          </p>
          <div className="pill-row">
            {detail.theme?.themeLevel ? <span className="pill">{detail.theme.themeLevel}</span> : null}
            {detail.theme?.sector ? <span className="pill">{detail.theme.sector}</span> : null}
            {detail.latestTrendDate ? <span className="pill">{detail.latestTrendDate}</span> : null}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Why It Matters</p>
          <p>{whyItMatters(detail, primaryTrend)}</p>
          <div className="metric-row">
            <Metric label="Z-score" value={primaryTrend?.zScore.toFixed(1) ?? "0.0"} />
            <Metric label="Evidence" value={String(primaryTrend?.evidenceCount ?? 0)} />
            <Metric label="Entities" value={String(detail.affectedEntities.length)} />
          </div>
        </div>
      </section>

      <section className="grid two">
        <TrendPanel title="7-day signal" trend={detail.sevenDayTrend} />
        <TrendPanel title="30-day context" trend={detail.thirtyDayTrend} />
      </section>

      <section className="section grid two">
        <div className="panel">
          <p className="eyebrow">Trend History</p>
          <TrendChart points={detail.trendHistory} />
        </div>
        <div className="panel">
          <p className="eyebrow">Affected Companies And Entities</p>
          {detail.affectedEntities.length === 0 ? (
            <p>No affected entities have been extracted for this theme yet.</p>
          ) : (
            <div className="pill-row">
              {detail.affectedEntities.map((entity) => (
                <span className="pill" key={entity}>
                  {entity}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Citations</p>
        <div className="grid two">
          {detail.citations.length === 0 ? (
            <div className="evidence-card">
              <p>No citation snippets available yet.</p>
            </div>
          ) : (
            detail.citations.map((citation) => (
              <article className="evidence-card" key={citation.id}>
                <span className="label">
                  {citation.publisher} · {citation.sourceClass.replace("_", " ")}
                </span>
                <h3>{citation.title}</h3>
                <p>{citation.snippet}</p>
                <a className="pill" href={citation.url}>
                  Source link
                </a>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="section grid two">
        <div className="panel">
          <p className="eyebrow">Related Sector Sub-Themes</p>
          {detail.relatedSubthemes.length === 0 ? (
            <p>No sector sub-themes are linked to this theme yet.</p>
          ) : (
            <div className="grid">
              {detail.relatedSubthemes.map((subtheme) => (
                <div className="metric" key={subtheme.id}>
                  <span>{subtheme.sector ?? "Sector"}</span>
                  <strong>{subtheme.label}</strong>
                  <p>{subtheme.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <p className="eyebrow">What To Investigate Next</p>
          <div className="grid">
            {detail.followUpQuestions.map((question) => (
              <div className="copilot-box" key={question}>
                {question}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function TrendPanel({ title, trend }: { title: string; trend: TrendSummary | null }) {
  return (
    <div className="panel">
      <p className="eyebrow">{title}</p>
      {trend ? (
        <>
          <h2>{trend.themeLabel}</h2>
          <p>
            Intensity {trend.intensity.toFixed(1)} vs baseline{" "}
            {trend.baselineMean.toFixed(1)}, with {trend.evidenceCount} evidence
            items across {independentDocumentCount(trend)} documents and{" "}
            {trend.entityBreadth} entities.
          </p>
          <div className="metric-row">
            <Metric label="Z-score" value={trend.zScore.toFixed(1)} />
            <Metric label="Percentile" value={String(trend.percentileRank)} />
            <Metric label="Docs" value={String(independentDocumentCount(trend))} />
          </div>
        </>
      ) : (
        <p>No trend row exists for this window yet.</p>
      )}
    </div>
  );
}

function TrendChart({ points }: { points: ThemeTrendPoint[] }) {
  if (points.length === 0) {
    return <p>No trend history available yet.</p>;
  }

  const maxIntensity = Math.max(...points.map((point) => point.intensity), 1);

  return (
    <div className="chart" aria-label="Theme intensity chart">
      {points.slice(-14).map((point) => (
        <div
          className="bar"
          key={point.date}
          style={{ height: `${Math.max((point.intensity / maxIntensity) * 100, 8)}%` }}
          title={`${point.date}: intensity ${point.intensity.toFixed(
            1
          )}, z ${point.zScore.toFixed(1)}`}
        />
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function whyItMatters(detail: ThemeDetailStatus, trend: TrendSummary | null) {
  if (!detail.theme) {
    return "Theme details are unavailable because the live database is not configured.";
  }

  if (!trend) {
    return `${detail.theme.label} is normalized as a reusable market narrative, but it does not have a current trend row yet.`;
  }

  return `${detail.theme.label} currently has ${trend.evidenceCount} evidence items across ${independentDocumentCount(
    trend
  )} documents and ${trend.entityBreadth} affected entities, making it worth checking whether the narrative is broadening or fading.`;
}

function independentDocumentCount(trend: TrendSummary) {
  return trend.documentBreadth > 0 ? trend.documentBreadth : trend.evidenceCount;
}
