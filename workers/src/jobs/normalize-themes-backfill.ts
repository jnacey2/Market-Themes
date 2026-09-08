import {
  normalizeThemeGroups,
  themeNormalizationPromptVersion
} from "@market-themes/analysis";
import {
  persistThemeNormalizationMappings,
  selectThemeGroupsForNormalization
} from "@market-themes/db";

const model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001";
const promptVersion =
  process.env.THEME_NORMALIZATION_PROMPT_VERSION ?? themeNormalizationPromptVersion;
const batchSize = Number(process.env.THEME_NORMALIZATION_BATCH_SIZE ?? 25);
const maxBatches = Number(process.env.THEME_NORMALIZATION_MAX_BATCHES ?? 100);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for theme normalization.");
}

let totalSelected = 0;
let totalMappings = 0;
let totalStored = 0;
let totalApplied = 0;

for (let batchIndex = 1; batchIndex <= maxBatches; batchIndex += 1) {
  const groups = await selectThemeGroupsForNormalization({
    promptVersion,
    limit: batchSize
  });

  totalSelected += groups.length;
  console.log(
    `[normalize-themes-backfill] batch=${batchIndex}/${maxBatches} selected=${groups.length} model=${model} promptVersion=${promptVersion}`
  );

  if (groups.length === 0) {
    break;
  }

  const mappings = await normalizeThemeGroups(groups, {
    model,
    promptVersion
  });
  const result = await persistThemeNormalizationMappings(mappings);
  totalMappings += mappings.length;
  totalStored += result.mappingsStored;
  totalApplied += result.mappingsApplied;

  const autoApplied = mappings.filter((mapping) => mapping.status === "auto_applied").length;
  const needsReview = mappings.filter((mapping) => mapping.status === "needs_review").length;

  console.log(
    `[normalize-themes-backfill] batch=${batchIndex} mappings=${mappings.length} autoApplied=${autoApplied} needsReview=${needsReview} stored=${result.mappingsStored} signalsUpdated=${result.mappingsApplied}`
  );
}

console.log(
  `[normalize-themes-backfill] selected=${totalSelected} mappings=${totalMappings} stored=${totalStored} signalsUpdated=${totalApplied}`
);
