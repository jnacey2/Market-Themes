import type { NarrativeTrendPoint } from "@market-themes/db";

export function NarrativeSparkline({
  points,
  label
}: {
  points: NarrativeTrendPoint[];
  label: string;
}) {
  if (
    !points.some((point) =>
      ["measured", "measured_zero"].includes(point.coverageState)
    )
  )
    return <div className="sparkline-empty">Awaiting complete coverage</div>;
  const maximum = Math.max(
    ...points
      .filter((p) => ["measured", "measured_zero"].includes(p.coverageState))
      .map((p) => p.density),
    1
  );
  let connected = false;
  const path = points
    .map((point, index) => {
      if (!["measured", "measured_zero"].includes(point.coverageState)) {
        connected = false;
        return "";
      }
      const command = `${connected ? "L" : "M"}${(index / Math.max(1, points.length - 1)) * 100},${34 - (point.density / maximum) * 30}`;
      connected = true;
      return command;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 36"
      role="img"
      aria-label={`${label}: ${points.length}-day density history. Gaps indicate incomplete coverage.`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--accent-strong)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
