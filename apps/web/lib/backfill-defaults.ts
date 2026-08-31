export const CONTROLLED_BACKFILL_DEFAULTS = {
  batchSize: 10,
  maxBatches: 10,
  concurrency: 2,
  documentTimeoutMs: 600_000,
  staleAfterMinutes: 90,
  lookbackDays: 30
} as const;

export function controlledBackfillOptions(body: Record<string, unknown>) {
  return {
    batchSize: boundedPositiveInteger(
      body.batchSize,
      CONTROLLED_BACKFILL_DEFAULTS.batchSize,
      25
    ),
    maxBatches: boundedPositiveInteger(
      body.maxBatches,
      CONTROLLED_BACKFILL_DEFAULTS.maxBatches,
      40
    ),
    concurrency: boundedPositiveInteger(
      body.concurrency,
      CONTROLLED_BACKFILL_DEFAULTS.concurrency,
      4
    ),
    documentTimeoutMs: boundedPositiveInteger(
      body.documentTimeoutMs,
      CONTROLLED_BACKFILL_DEFAULTS.documentTimeoutMs,
      600_000
    ),
    staleAfterMinutes: boundedPositiveInteger(
      body.staleAfterMinutes,
      CONTROLLED_BACKFILL_DEFAULTS.staleAfterMinutes,
      240
    ),
    lookbackDays: boundedPositiveInteger(
      body.lookbackDays,
      CONTROLLED_BACKFILL_DEFAULTS.lookbackDays,
      365
    )
  };
}

function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number
) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), maximum)
    : fallback;
}
