import type { NarrativeTrendPoint } from "@market-themes/db";

export function NarrativeSparkline({
  points,
  label
}: {
  points: NarrativeTrendPoint[];
  label: string;
}) {
  if (points.length < 2) {
    return <div className="sparkline-empty">Awaiting history</div>;
  }

  const values = points.map((point) => point.density);
  const maximum = Math.max(...values, 1);
  const coordinates = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 100;
    const y = 34 - (point.density / maximum) * 30;
    return `${x},${y}`;
  });

  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 36"
      role="img"
      aria-label={`${label} 90-day narrative density`}
      preserveAspectRatio="none"
    >
      <polyline points={coordinates.join(" ")} fill="none" vectorEffect="non-scaling-stroke" />
      <circle
        cx="100"
        cy={coordinates.at(-1)?.split(",")[1]}
        r="2.2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
