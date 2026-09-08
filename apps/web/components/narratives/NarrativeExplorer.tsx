"use client";

import { useEffect, useState } from "react";
import type {
  NarrativeTrendSummary,
  NarrativeEvidencePage,
  ToneDirection
} from "@market-themes/db";
import {
  CHART_HORIZONS as HORIZONS,
  defaultChartHorizon,
  type ChartHorizon
} from "../../lib/narrative-history";

export function NarrativeExplorer({
  narrative
}: {
  narrative: NarrativeTrendSummary;
}) {
  const [horizon, setHorizon] = useState<ChartHorizon>(() =>
    defaultChartHorizon(narrative.history)
  );
  const [source, setSource] = useState("all");
  const [tone, setTone] = useState<ToneDirection | "all">("all");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const points = narrative.history.slice(-horizon);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<NarrativeEvidencePage | null>(null);
  const [error, setError] = useState("");
  const sourceClasses = [
    "newspaper",
    "filing",
    "transcript",
    "manual",
    "press_release",
    "government",
    "central_bank"
  ];
  const active =
    points.find((point) => point.date === activeDate) ?? points.at(-1);
  const query = new URLSearchParams({
    id: narrative.id,
    date: active?.date ?? "",
    window: narrative.trendWindow,
    source,
    tone,
    page: String(page)
  }).toString();
  useEffect(() => {
    if (!active?.date) return;
    const controller = new AbortController();
    setResult(null);
    setError("");
    fetch(`/api/narrative-evidence?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error ?? "Evidence unavailable.");
        if (!controller.signal.aborted) setResult(payload);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [query, active?.date]);
  const evidence = result?.items ?? [];
  const maximum = Math.max(
    ...points.flatMap((point) => [
      point.density,
      point.baselineMean,
      point.attentionDensity
    ]),
    1
  );
  const line = toPolyline(
    points.map((point) =>
      ["measured", "measured_zero"].includes(point.coverageState)
        ? point.density
        : NaN
    ),
    maximum
  );
  const baseline = toPolyline(
    points.map((point) => (!point.lowHistory ? point.baselineMean : NaN)),
    maximum
  );
  const attention = toPolyline(
    points.map((point) => point.attentionDensity),
    maximum
  );
  const measured =
    active?.coverageState === "measured" ||
    active?.coverageState === "measured_zero";

  return (
    <>
      <div className="narrative-controls" aria-label="Narrative chart filters">
        <div className="segmented">
          {HORIZONS.map((value) => (
            <button
              className={horizon === value ? "active" : ""}
              key={value}
              onClick={() => {
                setHorizon(value);
                setPage(0);
              }}
              type="button"
            >
              {value} days of history
            </button>
          ))}
        </div>
        <p>
          Evidence filters · {narrative.trendWindow} rolling measurement across
          all sources
        </p>
        <label>
          Source
          <select
            aria-label="Source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All sources</option>
            {sourceClasses.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tone
          <select
            aria-label="Tone"
            value={tone}
            onChange={(event) => {
              setTone(event.target.value as ToneDirection | "all");
              setPage(0);
            }}
          >
            <option value="all">All tones</option>
            <option value="risk">Risk-led</option>
            <option value="bullish">Bullish-led</option>
          </select>
        </label>
      </div>

      <div className="timeline-wrap">
        <svg
          className="narrative-timeline"
          viewBox="0 0 800 280"
          role="img"
          aria-label={`${narrative.name} density and baseline over ${horizon} days`}
        >
          <path className="attention-line" d={attention} />
          <path className="baseline-line" d={baseline} />
          <path className="density-line" d={line} />
          {points.map((point, index) => {
            const [x, y] = coordinate(
              index,
              points.length,
              point.density,
              maximum
            );
            if (!["measured", "measured_zero"].includes(point.coverageState))
              return null;
            return (
              <circle
                className={
                  point.date === active?.date
                    ? "timeline-point active"
                    : "timeline-point"
                }
                key={point.date}
                cx={x}
                cy={y}
                r={point.date === active?.date ? 6 : 3}

                onMouseEnter={() => {
                  setActiveDate(point.date);
                  setPage(0);
                }}
              >
                <title>
                  {`${point.date}: reviewed density ${point.density.toFixed(1)}, raw attention ${point.attentionDensity.toFixed(1)}, baseline ${point.baselineMean.toFixed(1)}, z ${point.zScore.toFixed(1)}, ${point.lifecycleState}`}
                </title>
              </circle>
            );
          })}
          <text className="chart-axis" x={4} y={28}>
            {maximum.toFixed(0)}%
          </text>
          <text className="chart-axis" x={4} y={250}>
            0%
          </text>
          <text className="chart-axis" x={24} y={275}>
            {points[0]?.date}
          </text>
          <text className="chart-axis" x={776} y={275} textAnchor="end">
            {points.at(-1)?.date}
          </text>
        </svg>
        {points.length > 0 && (
          <label>
            Evidence date (UTC)
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={Math.max(
                0,
                points.findIndex((point) => point.date === active?.date)
              )}
              onChange={(event) => {
                setActiveDate(points[Number(event.target.value)].date);
                setPage(0);
              }}
            />
          </label>
        )}
        <div className="chart-legend" aria-hidden="true">
          <span>
            <i className="legend-density" /> Reviewed density
          </span>
          <span>
            <i className="legend-attention" /> Raw attention (pending +
            approved)
          </span>
          <span>
            <i className="legend-baseline" /> Baseline
          </span>
        </div>
        <div className="chart-readout" aria-live="polite">
          <strong>{active ? `${active.date} UTC` : "No observations"}</strong>
          <span>
            Density {measured ? `${active?.density.toFixed(1)}%` : "—"}
          </span>
          <span>Attention {active?.attentionDensity.toFixed(1) ?? "0.0"}%</span>
          <span>Baseline {active?.baselineMean.toFixed(1) ?? "0.0"}</span>
          <span>
            Coverage {active?.classifiedDocuments ?? 0}/
            {active?.corpusEligibleDocuments ?? 0} (
            {active?.classificationCoveragePercent.toFixed(1) ?? 0}%)
          </span>
          <span>
            Z-score {measured ? (active?.zScore.toFixed(1) ?? "0.0") : "—"}
            {measured && narrative.lowHistory ? " (provisional)" : ""}
          </span>
          <span>Change {measured ? signed(active?.change ?? 0) : "—"}</span>
          <span>State {active?.lifecycleState ?? "unmeasured"}</span>
        </div>
      </div>

      <div className="grid two evidence-results">
        {error ? (
          <div role="alert">{error}</div>
        ) : !result && active ? (
          <p>Loading evidence…</p>
        ) : evidence.length === 0 ? (
          <div className="evidence-card">
            <p>No evidence matches these filters.</p>
          </div>
        ) : (
          evidence.map((item) => (
            <article className="evidence-card" key={item.id}>
              <span className="label">
                {item.publisher} · {formatPublished(item.publishedAt)}
              </span>
              <h3>{item.title}</h3>
              <blockquote>{item.evidenceSnippet}</blockquote>
              <p className="label">
                Reviewed evidence match · classifier score{" "}
                {item.matchScore.toFixed(0)}
              </p>
              <a
                className="pill"
                href={item.url}
                rel="noreferrer"
                target="_blank"
              >
                Open source
              </a>
            </article>
          ))
        )}
      </div>
      <div className="button-row">
        {page > 0 && (
          <button type="button" onClick={() => setPage(page - 1)}>
            Previous evidence
          </button>
        )}
        <span>Page {page + 1}</span>
        {result?.hasMore && (
          <button type="button" onClick={() => setPage(page + 1)}>
            Next evidence
          </button>
        )}
      </div>
    </>
  );
}

function toPolyline(values: number[], maximum: number) {
  let connected = false;
  return values
    .map((value, index) => {
      if (!Number.isFinite(value)) {
        connected = false;
        return "";
      }
      const segment = `${connected ? "L" : "M"}${coordinate(index, values.length, value, maximum).join(",")}`;
      connected = true;
      return segment;
    })
    .join(" ");
}

function coordinate(index: number, length: number, value: number, maximum: number) {
  const x = length <= 1 ? 24 : 24 + (index / (length - 1)) * 752;
  const y = 250 - (value / maximum) * 220;
  return [x, y];
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatPublished(value: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(new Date(value))} UTC`;
}
