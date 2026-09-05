/**
 * Narrative URLs route on the definition slug so links are readable and
 * shareable. The older id-based routes (/themes/narrative:def:...:v1 and
 * /storyboards/<slug>) redirect here.
 */
export function narrativePath(slug: string) {
  return `/narratives/${encodeURIComponent(slug)}`;
}

export function narrativeDataPath(slug: string) {
  return `${narrativePath(slug)}/data`;
}

export const NARRATIVE_DEFINITION_ID_PREFIX = "narrative:def:";

export function isNarrativeDefinitionId(value: string) {
  return value.startsWith(NARRATIVE_DEFINITION_ID_PREFIX);
}
