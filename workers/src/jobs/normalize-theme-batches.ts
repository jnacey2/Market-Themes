import {
  normalizeThemeGroups,
  themeNormalizationPromptVersion
} from "@market-themes/analysis";
import {
  persistThemeNormalizationMappings,
  selectThemeGroupsForNormalization
} from "@market-themes/db";

export async function normalizeThemeBatches(options: {
  maxBatches?: number;
  batchSize?: number;
} = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required for theme normalization.");
  }

  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
  const promptVersion =
    process.env.THEME_NORMALIZATION_PROMPT_VERSION ?? themeNormalizationPromptVersion;
  const batchSize = options.batchSize ?? Number(process.env.THEME_NORMALIZATION_BATCH_SIZE ?? 25);
  const maxBatches = options.maxBatches ?? Number(process.env.THEME_NORMALIZATION_MAX_BATCHES ?? 20);
  let mappingsStored = 0;
  let signalsUpdated = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const groups = await selectThemeGroupsForNormalization({ promptVersion, limit: batchSize });

    if (groups.length === 0) {
      break;
    }

    const mappings = await normalizeThemeGroups(groups, { model, promptVersion });
    const result = await persistThemeNormalizationMappings(mappings);
    mappingsStored += result.mappingsStored;
    signalsUpdated += result.mappingsApplied;
  }

  return { mappingsStored, signalsUpdated };
}
