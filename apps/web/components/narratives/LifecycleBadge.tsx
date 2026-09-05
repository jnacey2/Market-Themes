import type { NarrativeLifecycleState } from "@market-themes/db";
import { isThinEvidence } from "@market-themes/db";
import { METRIC_GLOSSARY } from "../../lib/metric-glossary";

export const LIFECYCLE_LABELS: Record<NarrativeLifecycleState, string> = {
  unmeasured: "Unmeasured",
  dormant: "Dormant",
  emerging: "Emerging",
  rising: "Rising",
  peaking: "Peaking",
  steady: "Steady",
  fading: "Fading"
};

export const LIFECYCLE_DESCRIPTIONS: Record<NarrativeLifecycleState, string> = {
  unmeasured: "Classification coverage for this window is incomplete, so movement is suppressed.",
  dormant: "Fully classified with no approved matches in consecutive windows.",
  emerging: "Measured, but the historical baseline is still thin; treat the reading as early.",
  rising:
    "Reviewed density is climbing beyond normal noise versus the prior window, with at least three unique stories from two publisher groups.",
  peaking:
    "Reviewed density is within 15% of its 90-day high and no longer accelerating, with at least three unique stories from two publisher groups.",
  steady: "Reviewed density is inside its normal range, or the week has too little independent evidence to call a move.",
  fading: "Reviewed density has fallen below half of its 90-day peak or declined in consecutive windows."
};

export function LifecycleBadge({
  state,
  compact = false
}: {
  state: NarrativeLifecycleState;
  compact?: boolean;
}) {
  return (
    <span
      className={`lifecycle-badge lifecycle-${state}${compact ? " compact" : ""}`}
      title={LIFECYCLE_DESCRIPTIONS[state]}
    >
      {LIFECYCLE_LABELS[state]}
    </span>
  );
}

/**
 * Plain-language peak context. A week with no approved coverage says so instead
 * of rendering "0% of peak", which reads as missing data.
 */
export function peakSummary(input: {
  lifecycleState: NarrativeLifecycleState;
  percentOfPeak: number;
  daysSincePeak: number | null;
  density?: number;
}) {
  if (input.lifecycleState === "unmeasured" || input.daysSincePeak === null) return null;
  if (input.density !== undefined && input.density <= 0) {
    return input.daysSincePeak > 0
      ? `No approved coverage this week · peak ${input.daysSincePeak}d ago`
      : "No approved coverage this week";
  }
  if (input.daysSincePeak === 0) return "At 90-day peak";
  return `${Math.round(input.percentOfPeak)}% of peak · peak ${input.daysSincePeak}d ago`;
}

export function hasThinEvidence(input: {
  lifecycleState: NarrativeLifecycleState;
  storyBreadth: number;
  publisherOwnerBreadth: number;
  density?: number;
}) {
  if (input.lifecycleState === "unmeasured" || input.lifecycleState === "dormant") return false;
  if (input.density !== undefined && input.density <= 0) return false;
  return isThinEvidence(input);
}

export function ThinEvidencePill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`pill thin-evidence-pill${compact ? " compact" : ""}`}
      title={METRIC_GLOSSARY.thinEvidence.description}
    >
      thin evidence
    </span>
  );
}
