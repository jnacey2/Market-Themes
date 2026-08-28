"use client";

import { useMemo, useState } from "react";
import type { NarrativeTrendSummary, ToneDirection } from "@market-themes/db";

const HORIZONS = [7, 30, 90] as const;

export function NarrativeExplorer({ narrative }: { narrative: NarrativeTrendSummary }) {
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(90);
  const [source, setSource] = useState("all");
  const [tone, setTone] = useState<ToneDirection | "all">("all");
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const points = narrative.history.slice(-horizon);
  const sourceClasses = [...new Set(narrative.evidence.map((item) => item.sourceClass))];
  const evidence = useMemo(
    () =>
      narrative.evidence.filter(
        (item) =>
          (source === "all" || item.sourceClass === source) &&
          (tone === "all" || item.stance === tone)
      ),
    [narrative, source, tone]
  );
  const maximum = Math.max(...points.flatMap((point) => [point.density, point.baselineMean]), 1);
  const line = toPolyline(points.map((point) => point.density), maximum);
  const baseline = toPolyline(points.map((point) => point.baselineMean), maximum);
  const active = points.find((point) => point.date === activeDate) ?? points.at(-1);

  return (
    <>
      <div className="narrative-controls" aria-label="Narrative chart filters">
        <div className="segmented">
          {HORIZONS.map((value) => (
            <button
              className={horizon === value ? "active" : ""}
              key={value}
              onClick={() => setHorizon(value)}
              type="button"
            >
              {value}d
            </button>
          ))}
        </div>
        <label>
          Source
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">All sources</option>
            {sourceClasses.map((value) => (
              <option key={value} value={value}>{value.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label>
          Tone
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value as ToneDirection | "all")}
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
          <path className="baseline-line" d={`M ${baseline.join(" L ")}`} />
          <path className="density-line" d={`M ${line.join(" L ")}`} />
          {points.map((point, index) => {
            const [x, y] = coordinate(index, points.length, point.density, maximum);
            return (
              <circle
                className={point.date === active?.date ? "timeline-point active" : "timeline-point"}
                key={point.date}
                cx={x}
                cy={y}
                r={point.date === active?.date ? 6 : 3}
                tabIndex={0}
                onFocus={() => setActiveDate(point.date)}
                onMouseEnter={() => setActiveDate(point.date)}
              >
                <title>
                  {point.date}: density {point.density.toFixed(1)}, baseline{" "}
                  {point.baselineMean.toFixed(1)}, z {point.zScore.toFixed(1)}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="chart-readout" aria-live="polite">
          <strong>{active?.date ?? "No observations"}</strong>
          <span>Density {active?.density.toFixed(1) ?? "0.0"}</span>
          <span>Baseline {active?.baselineMean.toFixed(1) ?? "0.0"}</span>
          <span>Z-score {narrative.lowHistory ? "—" : active?.zScore.toFixed(1) ?? "0.0"}</span>
          <span>Change {narrative.lowHistory ? "—" : signed(active?.change ?? 0)}</span>
        </div>
      </div>

      <div className="grid two evidence-results">
        {evidence.length === 0 ? (
          <div className="evidence-card"><p>No evidence matches these filters.</p></div>
        ) : evidence.map((item) => (
          <article className="evidence-card" key={item.id}>
            <span className="label">
              {item.publisher} · {new Date(item.publishedAt).toLocaleDateString()}
            </span>
            <h3>{item.title}</h3>
            <blockquote>{item.evidenceSnippet}</blockquote>
            <p><span className="synthesis-label">Model synthesis</span> {item.interpretation}</p>
            <a className="pill" href={item.url} rel="noreferrer" target="_blank">Open source</a>
          </article>
        ))}
      </div>
    </>
  );
}

function toPolyline(values: number[], maximum: number) {
  return values.map((value, index) => coordinate(index, values.length, value, maximum).join(","));
}

function coordinate(index: number, length: number, value: number, maximum: number) {
  const x = length <= 1 ? 24 : 24 + (index / (length - 1)) * 752;
  const y = 250 - (value / maximum) * 220;
  return [x, y];
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
