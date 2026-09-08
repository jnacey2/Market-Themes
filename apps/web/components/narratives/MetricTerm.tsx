import Link from "next/link";
import { METRIC_GLOSSARY, type MetricKey } from "../../lib/metric-glossary";

/**
 * A metric label with its one-sentence definition as a tooltip. Use it wherever
 * a bare "z" or "attention" would otherwise be shown.
 */
export function MetricTerm({
  term,
  children,
  short = false
}: {
  term: MetricKey;
  children?: React.ReactNode;
  short?: boolean;
}) {
  const entry = METRIC_GLOSSARY[term];
  return (
    <abbr className="metric-term" title={entry.description}>
      {children ?? (short ? entry.short : entry.label)}
    </abbr>
  );
}

export function HowToReadLink({ children = "How to read these numbers" }: { children?: React.ReactNode }) {
  return (
    <Link className="how-to-read-link" href="/how-to-read">
      {children}
    </Link>
  );
}
