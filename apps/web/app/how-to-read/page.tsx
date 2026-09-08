import Link from "next/link";
import type { NarrativeLifecycleState } from "@market-themes/db";
import {
  LifecycleBadge,
  LIFECYCLE_DESCRIPTIONS
} from "../../components/narratives/LifecycleBadge";
import { METRIC_GLOSSARY, METRIC_ORDER } from "../../lib/metric-glossary";

const LIFECYCLE_ORDER: NarrativeLifecycleState[] = [
  "rising",
  "peaking",
  "steady",
  "fading",
  "emerging",
  "dormant",
  "unmeasured"
];

export default function HowToReadPage() {
  return (
    <div className="shell">
      <nav className="context-nav" aria-label="Narrative views">
        <span>How to read the board</span>
        <Link href="/trends">Open Narrative Currents</Link>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Methodology</p>
          <h1>How to read these numbers.</h1>
          <p className="lede">
            Every narrative is a stable, written-down market proposition. Each day we
            measure how much of the readable corpus supports it, compare that with the
            narrative&apos;s own history, and label the result. Nothing here is a
            forecast or a recommendation; it is a measurement of attention.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">In one paragraph</p>
          <p>
            Documents come in from filings, transcripts, official releases and news. A
            classifier reads each one against every tracked narrative; reviewers
            approve or reject the matches. <strong>Reviewed density</strong> is the share
            of the week&apos;s documents that were approved as evidence. The{" "}
            <strong>z-score</strong> says how unusual this week is versus the
            narrative&apos;s past weeks. <strong>Unique stories</strong> and{" "}
            <strong>publisher groups</strong> say how many independent voices are behind
            it. The lifecycle badge summarises all three.
          </p>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Lifecycle states</p>
        <div className="glossary-grid">
          {LIFECYCLE_ORDER.map((state) => (
            <div className="panel glossary-entry" key={state}>
              <LifecycleBadge state={state} />
              <p>{LIFECYCLE_DESCRIPTIONS[state]}</p>
            </div>
          ))}
        </div>
        <div className="panel" style={{ marginTop: 18 }}>
          <p>
            Rising and peaking are only awarded when the week has at least three unique
            stories from at least two publisher groups. A single story is at its own
            90-day peak by construction, so thinner weeks are shown as steady (or
            emerging while the history is short) and carry a &ldquo;thin evidence&rdquo;
            tag.
          </p>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Metrics</p>
        <div className="glossary-grid">
          {METRIC_ORDER.map((key) => (
            <div className="panel glossary-entry" key={key}>
              <h3>{METRIC_GLOSSARY[key].label}</h3>
              <p>{METRIC_GLOSSARY[key].description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Dates and coverage</p>
        <div className="panel">
          <p>
            Measurement dates are UTC day buckets; the &ldquo;latest measurement&rdquo;
            is the most recent day for which the seven-day window has been recomputed.
            A narrative is only <em>measured</em> once the classifier has covered at
            least 98% of that window&apos;s readable documents; until then it is shown as
            unmeasured and no movement is reported, because a zero produced by missing
            classification is not a zero produced by absent coverage.
          </p>
        </div>
      </section>
    </div>
  );
}
