import type { NarrativeLifecycleState } from "@market-themes/db";

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
  rising: "Reviewed density is climbing beyond normal noise versus the prior window.",
  peaking: "Reviewed density is within 15% of its 90-day high and no longer accelerating.",
  steady: "Reviewed density is inside its normal range.",
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

export function peakSummary(input: {
  lifecycleState: NarrativeLifecycleState;
  percentOfPeak: number;
  daysSincePeak: number | null;
}) {
  if (input.lifecycleState === "unmeasured" || input.daysSincePeak === null) return null;
  if (input.daysSincePeak === 0) return "At 90-day peak";
  return `${Math.round(input.percentOfPeak)}% of peak · ${input.daysSincePeak}d since peak`;
}
