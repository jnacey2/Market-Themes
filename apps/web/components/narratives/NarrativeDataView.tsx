import Link from "next/link";
import type { NarrativeTrendSummary } from "@market-themes/db";
import {
  hasThinEvidence,
  LifecycleBadge,
  peakSummary,
  ThinEvidencePill
} from "./LifecycleBadge";
import { HowToReadLink, MetricTerm } from "./MetricTerm";
import { NarrativeExplorer } from "./NarrativeExplorer";
import { METRIC_GLOSSARY } from "../../lib/metric-glossary";
import { activeSpanDays, countMeasuredDays } from "../../lib/narrative-history";
import { narrativePath } from "../../lib/narrative-paths";

export function NarrativeDataView({ narrative }: { narrative: NarrativeTrendSummary }) {
  const measured =
    narrative.coverageStatus === "measured" ||
    narrative.coverageStatus === "measured_zero";
  const measuredDays = countMeasuredDays(narrative.history);
  const activeDays = activeSpanDays(narrative.history);
  return (
    <div className="shell wide-shell">
      <nav className="context-nav" aria-label="Narrative views">
        <span>Data view</span>
        <Link href={narrativePath(narrative.slug)}>Open live storyboard</Link>
        <HowToReadLink />
      </nav>

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
            <LifecycleBadge state={narrative.lifecycleState} />
            {narrative.status === "probationary" ? (
              <span className="pill" title={METRIC_GLOSSARY.probationary.description}>
                probationary
              </span>
            ) : null}
            {hasThinEvidence(narrative) ? <ThinEvidencePill /> : null}
            {narrative.parentName ? (
              <span className="pill">
                {narrative.parentName} · {narrative.dimension}
              </span>
            ) : null}
            <span className="pill" title={METRIC_GLOSSARY.percentile.description}>
              {narrative.coverageStatus === "no_corpus"
                ? "No recent corpus"
                : narrative.coverageStatus === "backfill_pending"
                  ? "Classification pending"
                  : narrative.coverageStatus === "measured_zero"
                    ? "No approved coverage this week"
                    : narrative.lowHistory
                      ? `${narrative.percentileRank}th percentile (provisional)`
                      : `${narrative.percentileRank}th percentile`}
            </span>
            {measured ? (
              <>
                <span className="pill" title={METRIC_GLOSSARY.zScore.description}>
                  z {narrative.zScore.toFixed(1)}
                  {narrative.lowHistory ? " (provisional)" : ""}
                </span>
                <span className="pill" title={METRIC_GLOSSARY.attentionZScore.description}>
                  attention z {narrative.attentionZScore.toFixed(1)}
                </span>
              </>
            ) : null}
            {peakSummary(narrative) ? (
              <span className="pill" title={METRIC_GLOSSARY.peak.description}>
                {peakSummary(narrative)}
              </span>
            ) : null}
            <span className="pill" title={METRIC_GLOSSARY.publisherGroups.description}>
              {narrative.publisherOwnerBreadth} publisher groups
            </span>
            <span className="pill" title={METRIC_GLOSSARY.uniqueStories.description}>
              {narrative.storyBreadth} unique stories
            </span>
            {narrative.eventExpiresAt ? (
              <span className="pill">
                event expires {formatNarrativeDate(narrative.eventExpiresAt)}
              </span>
            ) : null}
          </div>
          <div className="button-row">
            <Link className="button" href={narrativePath(narrative.slug)}>
              Open live storyboard
            </Link>
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Current signal</p>
          <div className="metric-row">
            <Metric
              label={<MetricTerm term="density">Density</MetricTerm>}
              value={measured ? narrative.density.toFixed(1) : "—"}
            />
            <Metric
              label={<MetricTerm term="change" short />}
              value={measured ? signedMetric(narrative.change) : "—"}
            />
            <Metric
              label={<MetricTerm term="attentionDensity" />}
              value={measured ? narrative.attentionDensity.toFixed(1) : "—"}
            />
            <Metric
              label={<MetricTerm term="coverage">Coverage</MetricTerm>}
              value={`${narrative.classificationCoveragePercent}%`}
            />
          </div>
          <p>
            {narrative.matchedDocuments} approved documents represent{" "}
            {narrative.storyBreadth} unique stories from{" "}
            {narrative.publisherOwnerBreadth} publisher groups;{" "}
            {narrative.attentionMatchedDocuments} documents matched the classifier
            before review. Coverage: {narrative.eligibleDocuments} of{" "}
            {narrative.corpusDocuments} documents with readable text in this
            seven-day window have been classified ({coverageLabel(narrative.coverageStatus)}).
            {narrative.peakDate
              ? ` 90-day peak density ${narrative.peakDensity.toFixed(1)} on ${narrative.peakDate} (UTC).`
              : ""}
          </p>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Density vs historical baseline</p>
        {activeDays < 30 ? (
          <p className="lane-empty">
            {activeDays === 0
              ? `No approved or pending evidence yet across ${measuredDays} measured ${measuredDays === 1 ? "day" : "days"}.`
              : `Evidence spans the last ${activeDays} ${activeDays === 1 ? "day" : "days"} of ${measuredDays} measured; the chart opens on the shortest range that shows it.`}
          </p>
        ) : null}
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

function coverageLabel(state: NarrativeTrendSummary["coverageStatus"]) {
  switch (state) {
    case "measured":
      return "measured";
    case "measured_zero":
      return "measured, no approved matches";
    case "backfill_pending":
      return "classification still pending";
    case "no_corpus":
      return "no readable corpus";
    default:
      return state;
  }
}

function signedMetric(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatNarrativeDate(value: string) {
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value)
  )} UTC`;
}

function Metric({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
