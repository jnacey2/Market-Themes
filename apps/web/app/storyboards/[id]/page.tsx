import Link from "next/link";
import { notFound } from "next/navigation";
import { getNarrativeDetailStatus } from "@market-themes/db";
import { NarrativeExplorer } from "../../../components/narratives/NarrativeExplorer";

export const dynamic = "force-dynamic";

export default async function StoryboardPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const narrative = await getNarrativeDetailStatus(decodeURIComponent(id));

  if (!narrative) {
    notFound();
  }

  const hasCoverage = narrative.eligibleDocuments > 0;
  const direction = narrative.change > 0 ? "rising" : narrative.change < 0 ? "fading" : "steady";
  const breadth =
    narrative.publisherOwnerBreadth >= 3
      ? "across several publisher groups"
      : "with limited publisher-group breadth";
  const whyUnusual = !hasCoverage
    ? "No eligible documents were classified in the latest window, so movement and unusualness are not measured."
    : narrative.lowHistory
    ? "The series does not yet have enough history for a reliable unusualness judgment."
    : `The current reading is in the ${narrative.percentileRank}th percentile of its own history with a z-score of ${narrative.zScore.toFixed(1)}.`;

  return (
    <div className="shell wide-shell">
      <nav className="nav">
        <Link className="brand" href="/">Market Themes</Link>
        <div className="nav-links">
          <Link href="/trends">Narrative Currents</Link>
          <Link href={`/themes/${encodeURIComponent(narrative.id)}`}>Data view</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Live Storyboard · {narrative.category}</p>
          <h1>{narrative.name}</h1>
          <p className="lede">
            {hasCoverage && !narrative.lowHistory
              ? `This narrative is ${direction} ${breadth}. Current normalized density is ${narrative.density.toFixed(1)}, a ${signed(narrative.change)} change from the prior seven-day window.`
              : hasCoverage
                ? `This narrative has current evidence ${breadth}, but its historical baseline is not mature enough to interpret percentile, z-score, or movement.`
                : "This narrative has no eligible recent-source coverage. Ingest and classify current documents before interpreting its movement."}
          </p>
          <p className="synthesis-disclosure">
            System synthesis derived from measured observations. Evidence and model
            interpretations are separated below.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Why this is unusual</p>
          <p>{whyUnusual}</p>
          <div className="metric-row">
            <Metric
              label="Z-score"
              value={hasCoverage && !narrative.lowHistory ? narrative.zScore.toFixed(1) : "—"}
            />
            <Metric
              label="Percentile"
              value={hasCoverage && !narrative.lowHistory ? String(narrative.percentileRank) : "—"}
            />
            <Metric label="Publisher groups" value={String(narrative.publisherOwnerBreadth)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Narrative movement and evidence</p>
        <NarrativeExplorer narrative={narrative} />
      </section>

      <section className="section panel">
        <p className="eyebrow">What to investigate next</p>
        <div className="grid three">
          {followUps(narrative.name, narrative.change, narrative.publisherOwnerBreadth).map(
            (question) => <div className="copilot-box" key={question}>{question}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function followUps(name: string, change: number, owners: number) {
  return [
    `Which entities are driving the latest ${name} observations?`,
    change >= 0
      ? "Is the acceleration broadening across source classes or concentrated in one channel?"
      : "Is the decline a genuine fade or a temporary lull in source coverage?",
    owners < 3
      ? "What independent evidence would confirm this early signal?"
      : "Do independent publishers share the same framing and tone?"
  ];
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
