"use client";

import { useEffect, useState } from "react";
import type {
  NarrativeEvidencePage,
  NarrativeTrendPoint,
  NarrativeTrendSummary
} from "@market-themes/db";

export function NarrativeExplorer({
  narrative
}: {
  narrative: NarrativeTrendSummary;
}) {
  const [horizon, setHorizon] = useState(90);
  const [source, setSource] = useState("all");
  const [tone, setTone] = useState("all");
  const [activeDate, setActiveDate] = useState(narrative.latestDate ?? "");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<NarrativeEvidencePage | null>(null);
  const [error, setError] = useState("");
  const points = narrative.history.slice(-horizon);
  const active =
    points.find((point) => point.date === activeDate) ?? points.at(-1);
  const date = active?.date;
  const query = new URLSearchParams({
    id: narrative.id,
    date: date ?? "",
    window: narrative.trendWindow,
    source,
    tone,
    page: String(page)
  }).toString();
  useEffect(() => {
    if (!date) return;
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
  }, [date, query]);
  const maximum = Math.max(
    10,
    ...points.filter((p) => p.coverageComplete).map((p) => p.density),
    ...points.filter((p) => !p.lowHistory).map((p) => p.baselineMean)
  );
  const x = (index: number) =>
    48 + (index * 728) / Math.max(1, points.length - 1);
  const y = (value: number) => 240 - (value / maximum) * 210;
  function path(
    value: (point: NarrativeTrendPoint) => number,
    available: (point: NarrativeTrendPoint) => boolean
  ) {
    let connected = false;
    return points
      .map((point, index) => {
        if (!available(point)) {
          connected = false;
          return "";
        }
        const command = `${connected ? "L" : "M"}${x(index)},${y(value(point))}`;
        connected = true;
        return command;
      })
      .join(" ");
  }
  const ready = active?.coverageComplete && !narrative.measurementPending;
  return (
    <>
      <div className="narrative-controls">
        <label>
          History shown
          <select
            value={horizon}
            onChange={(event) => {
              setHorizon(Number(event.target.value));
              setPage(0);
            }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <span>
          {narrative.trendWindow === "7d" ? "7-day" : "30-day"} rolling
          measurement · completed UTC days
        </span>
      </div>
      {points.length ? (
        <>
          <svg
            className="narrative-timeline"
            viewBox="0 0 800 280"
            role="img"
            aria-label={`${narrative.name}: density in percent. Gaps indicate incomplete coverage.`}
          >
            {[0, maximum / 2, maximum].map((value) => (
              <text key={value} className="chart-axis" x={4} y={y(value)}>
                {value.toFixed(0)}%
              </text>
            ))}
            <text className="chart-axis" x={48} y={270}>
              {points[0].date}
            </text>
            <text className="chart-axis" x={776} y={270} textAnchor="end">
              {points.at(-1)?.date}
            </text>
            <path
              className="baseline-line"
              d={path(
                (p) => p.baselineMean,
                (p) => !p.lowHistory
              )}
            />
            <path
              className="density-line"
              d={path(
                (p) => p.density,
                (p) => Boolean(p.coverageComplete)
              )}
            />
            {points.map((point, index) =>
              point.coverageComplete ? (
                <circle
                  key={point.date}
                  className={
                    date === point.date
                      ? "timeline-point active"
                      : "timeline-point"
                  }
                  cx={x(index)}
                  cy={y(point.density)}
                  r={date === point.date ? 6 : 3}
                  onClick={() => {
                    setActiveDate(point.date);
                    setPage(0);
                  }}
                >
                  <title>
                    {point.date}: {point.density.toFixed(1)}%
                  </title>
                </circle>
              ) : null
            )}
          </svg>
          <p className="chart-legend">
            <span>Blue: reviewed density</span>
            <span>Dashed: historical baseline</span>
            <span>Gap: incomplete coverage</span>
          </p>
          <label>
            Inspect date: {date}
            <input
              className="date-slider"
              type="range"
              min={0}
              max={points.length - 1}
              value={Math.max(
                0,
                points.findIndex((p) => p.date === date)
              )}
              aria-valuetext={date}
              onChange={(event) => {
                setActiveDate(points[Number(event.target.value)].date);
                setPage(0);
              }}
            />
          </label>
          <div className="chart-readout" aria-live="polite">
            <span>Density {ready ? `${active.density.toFixed(1)}%` : "—"}</span>
            <span>
              Z-score{" "}
              {ready && active.zScoreAvailable ? active.zScore.toFixed(1) : "—"}
            </span>
            <span>
              Change{" "}
              {ready && active.comparisonReady
                ? `${active.change > 0 ? "+" : ""}${active.change.toFixed(1)} pp`
                : "—"}
            </span>
          </div>
        </>
      ) : (
        <p>No measurement history yet.</p>
      )}
      <div className="narrative-controls">
        <label>
          Evidence source
          <select
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All source classes</option>
            {[
              "filing",
              "transcript",
              "press_release",
              "newspaper",
              "government",
              "central_bank",
              "manual"
            ].map((value) => (
              <option value={value} key={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Evidence tone
          <select
            value={tone}
            onChange={(event) => {
              setTone(event.target.value);
              setPage(0);
            }}
          >
            <option value="all">All tones</option>
            {["risk", "bullish", "mixed", "neutral"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Reviewed evidence in the {narrative.trendWindow === "7d" ? "7" : "30"}{" "}
        days ending {date ?? "—"}. Source and tone filter these citations; the
        chart retains all source classes.
      </p>
      <div
        className="grid two evidence-results"
        aria-live="polite"
        aria-busy={!result && !error && Boolean(date)}
      >
        {error ? (
          <p className="error-text">{error}</p>
        ) : !result ? (
          <p>{date ? "Loading evidence…" : "No dated evidence yet."}</p>
        ) : !result.items.length ? (
          <p>No reviewed evidence matches these filters.</p>
        ) : (
          result.items.map((item) => (
            <article className="evidence-card" key={item.id}>
              <span className="label">
                {item.publisher} · {item.publishedAt.slice(0, 10)} ·{" "}
                {item.stance}
              </span>
              <h3>{item.title}</h3>
              <blockquote>{item.evidenceSnippet}</blockquote>
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
        <button
          className="button"
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="button"
          disabled={!result?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
