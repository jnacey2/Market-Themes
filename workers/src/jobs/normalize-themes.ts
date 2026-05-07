import {
  normalizeThemeGroups,
  themeNormalizationPromptVersion
} from "@market-themes/analysis";
import {
  persistThemeNormalizationMappings,
  selectThemeGroupsForNormalization
} from "@market-themes/db";

const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929";
const promptVersion =
  process.env.THEME_NORMALIZATION_PROMPT_VERSION ?? themeNormalizationPromptVersion;
const batchSize = Number(process.env.THEME_NORMALIZATION_BATCH_SIZE ?? 25);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required for theme normalization.");
}

const groups = await selectThemeGroupsForNormalization({
  promptVersion,
  limit: batchSize
});

console.log(
  `[normalize-themes] selected=${groups.length} model=${model} promptVersion=${promptVersion}`
);

if (groups.length === 0) {
  console.log("[normalize-themes] no unnormalized theme groups found");
} else {
  const mappings = await normalizeThemeGroups(groups, {
    model,
    promptVersion
  });
  const result = await persistThemeNormalizationMappings(mappings);
  const autoApplied = mappings.filter((mapping) => mapping.status === "auto_applied").length;
  const needsReview = mappings.filter((mapping) => mapping.status === "needs_review").length;

  console.log(
    `[normalize-themes] mappings=${mappings.length} autoApplied=${autoApplied} needsReview=${needsReview} stored=${result.mappingsStored} signalsUpdated=${result.mappingsApplied}`
  );
}
