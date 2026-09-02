import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getNarrativeDetailStatus,
  type NarrativeLifecycleState
} from "@market-themes/db";
import {
  LIFECYCLE_LABELS,
  LifecycleBadge,
  peakSummary
} from "../../../components/narratives/LifecycleBadge";
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

  const classificationComplete =
    narrative.coverageStatus === "measured" ||
    narrative.coverageStatus === "measured_zero";
  const hasSignal =
    narrative.coverageStatus === "measured" &&
    narrative.matchedDocuments > 0;
  const direction = LIFECYCLE_LABELS[narrative.lifecycleState].toLowerCase();
  const followUpQuestions = followUps(
    narrative.name,
    narrative.change,
    narrative.storyBreadth,
    narrative.lifecycleState
  );
  const breadth =
    narrative.storyBreadth >= 3
      ? "across several unique stories"
      : "with limited unique-story breadth";
  const peak = peakSummary(narrative);
  const whyUnusual = !classificationComplete
    ? `Classification coverage is ${narrative.classificationCoveragePercent}%, so movement and unusualness remain suppressed.`
    : narrative.coverageStatus === "measured_zero"
      ? `The current corpus is fully classified and contains no approved matches${
          narrative.zScore < 0 ? ` (z ${narrative.zScore.toFixed(1)} versus its own history)` : ""
        }.${narrative.attentionMatchedDocuments > 0 ? ` ${narrative.attentionMatchedDocuments} classifier matches await review.` : ""}`
      : narrative.lowHistory
        ? `Only ${narrative.baselineWindows} comparison windows exist, so the z-score of ${narrative.zScore.toFixed(1)} is provisional. Raw attention z is ${narrative.attentionZScore.toFixed(1)}.`
        : `The current reading is in the ${narrative.percentileRank}th percentile of its own history with a z-score of ${narrative.zScore.toFixed(1)}; raw attention (including pending matches) scores ${narrative.attentionZScore.toFixed(1)}.${peak ? ` ${peak}.` : ""}`;

  return (
    <div className="shell wide-shell">
      <nav className="context-nav" aria-label="Narrative views">
        <span>Live storyboard</span>
        <Link href={`/themes/${encodeURIComponent(narrative.id)}`}>Open data view</Link>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">
            Live Storyboard · {narrative.category} ·{" "}
            {narrative.kind ?? "structural"}
          </p>
          <h1>{narrative.name}</h1>
          {narrative.eventLabel ? <p className="label">{narrative.eventLabel}</p> : null}
          <div className="pill-row">
            <LifecycleBadge state={narrative.lifecycleState} />
            {narrative.status === "probationary" ? (
              <span className="pill">probationary</span>
            ) : null}
            {peak ? <span className="pill">{peak}</span> : null}
          </div>
          <p className="lede">
            {hasSignal && !narrative.lowHistory
              ? `This narrative is ${direction} ${breadth}. Current normalized density is ${narrative.density.toFixed(1)}, a ${signed(narrative.change)} change from the prior seven-day window.`
              : hasSignal
                ? `This narrative is ${direction} ${breadth}. Its baseline is still thin (${narrative.baselineWindows} comparison windows), so percentile and z-score are provisional.`
                : !classificationComplete
                  ? `This narrative is not fully measured: ${narrative.eligibleDocuments} of ${narrative.corpusDocuments} readable documents are classified.`
                  : narrative.lifecycleState === "fading"
                    ? `Approved evidence has dropped to zero from a ${narrative.peakDensity.toFixed(1)} peak${narrative.peakDate ? ` on ${narrative.peakDate}` : ""}.`
                    : "The current measured corpus has no approved matches."}
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
              label={narrative.lowHistory ? "Z-score (provisional)" : "Z-score"}
              value={classificationComplete ? narrative.zScore.toFixed(1) : "—"}
            />
            <Metric
              label="Attention z"
              value={classificationComplete ? narrative.attentionZScore.toFixed(1) : "—"}
            />
            <Metric
              label="Percentile"
              value={classificationComplete ? String(narrative.percentileRank) : "—"}
            />
            <Metric label="Unique stories" value={String(narrative.storyBreadth)} />
            <Metric
              label="% of 90d peak"
              value={classificationComplete ? `${Math.round(narrative.percentOfPeak)}%` : "—"}
            />
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
          {followUpQuestions.map((question) => (
            <div className="copilot-box" key={question}>{question}</div>
          ))}
        </div>
      </section>
    </div>
  );
}

function followUps(
  name: string,
  change: number,
  stories: number,
  state: NarrativeLifecycleState
) {
  return [
    `Which entities are driving the latest ${name} observations?`,
    state === "fading"
      ? "Is the decline a genuine fade, a resolved event, or a temporary lull in source coverage?"
      : state === "peaking"
        ? "Has the framing shifted from discovery to consensus, and who is still adding new information?"
        : change >= 0
          ? "Is the acceleration broadening across source classes or concentrated in one channel?"
          : "Is the decline a genuine fade or a temporary lull in source coverage?",
    stories < 3
      ? "What independent evidence would confirm this early signal?"
      : "Do the unique stories share the same framing and tone?"
  ];
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
