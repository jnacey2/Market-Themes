import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getThemeDetailStatus,
  getNarrativeDetailStatus,
  type NarrativeTrendSummary,
  type ThemeDetailStatus,
  type ThemeTrendPoint,
  type TrendSummary
} from "@market-themes/db";
import { NarrativeExplorer } from "../../../components/narratives/NarrativeExplorer";

export const dynamic = "force-dynamic";

type ThemePageProps = {
  params: Promise<{
    themeId: string;
  }>;
};

export default async function ThemeDetailPage({ params }: ThemePageProps) {
  const { themeId } = await params;
  const narrative = await getNarrativeDetailStatus(decodeURIComponent(themeId));

  if (narrative) {
    return <NarrativeDetailPage narrative={narrative} />;
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

function NarrativeDetailPage({ narrative }: { narrative: NarrativeTrendSummary }) {
  return (
    <div className="shell wide-shell">
      <section className="hero narrative-detail-hero">
        <div>
          <p className="eyebrow">
            {narrative.category} · {narrative.kind ?? "structural"} · Version{" "}
            {narrative.version}
          </p>
          <h1>{narrative.name}</h1>
          {narrative.eventLabel ? <p className="label">{narrative.eventLabel}</p> : null}
          <p className="lede">{narrative.proposition}</p>
          <div className="pill-row">
            {narrative.parentName ? (
              <span className="pill">
                {narrative.parentName} · {narrative.dimension}
              </span>
            ) : null}
            <span className="pill">
              {narrative.coverageStatus === "no_corpus"
                ? "No recent corpus"
                : narrative.coverageStatus === "backfill_pending"
                  ? "Classification pending"
                  : narrative.coverageStatus === "measured_zero"
                    ? "Measured zero"
                    : narrative.eligibleDocuments > 0 && !narrative.lowHistory
                ? `${narrative.percentileRank}th percentile`
                : narrative.eligibleDocuments > 0
                  ? "Building baseline"
                  : "No recent coverage"}
            </span>
            {narrative.coverageStatus === "measured" &&
            !narrative.lowHistory ? (
              <span className="pill">z {narrative.zScore.toFixed(1)}</span>
            ) : null}
            <span className="pill">{narrative.publisherOwnerBreadth} publisher groups</span>
            <span className="pill">{narrative.storyBreadth} unique stories</span>
            {narrative.eventExpiresAt ? (
              <span className="pill">
                event expires {formatNarrativeDate(narrative.eventExpiresAt)}
              </span>
            ) : null}
          </div>
          <div className="button-row">
            <Link className="button" href={`/storyboards/${encodeURIComponent(narrative.slug)}`}>
              Open live storyboard
            </Link>
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Current signal</p>
          <div className="metric-row">
            <Metric
              label="Density"
              value={
                narrative.coverageStatus === "measured" ||
                narrative.coverageStatus === "measured_zero"
                  ? narrative.density.toFixed(1)
                  : "—"
              }
            />
            <Metric
              label="7d change"
              value={
                narrative.coverageStatus === "measured" &&
                !narrative.lowHistory
                  ? signedMetric(narrative.change)
                  : "—"
              }
            />
            <Metric
              label="Coverage"
              value={`${narrative.classificationCoveragePercent}%`}
            />
          </div>
          <p>
            {narrative.matchedDocuments} matched documents represent{" "}
            {narrative.storyBreadth} unique stories from{" "}
            {narrative.publisherOwnerBreadth} publisher groups.{" "}
            {narrative.eligibleDocuments} of {narrative.corpusDocuments} readable
            documents are classified; coverage is {narrative.coverageStatus}.
          </p>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Density vs historical baseline</p>
        <NarrativeExplorer narrative={narrative} />
      </section>

      <section className="section grid two">
        <div className="panel">
          <p className="eyebrow">Included framing</p>
          <p>{narrative.inclusionGuidance}</p>
        </div>
        <div className="panel">
          <p className="eyebrow">Excluded framing</p>
          <p>{narrative.exclusionGuidance}</p>
        </div>
      </section>
    </div>
  );
}

function signedMetric(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatNarrativeDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value)
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
