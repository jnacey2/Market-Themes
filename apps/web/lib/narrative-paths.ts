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

/** `narrative:def:<slug>:v<version>` → `<slug>`, or null when the id has another shape. */
export function slugFromNarrativeDefinitionId(value: string) {
  const match = /^narrative:def:(.+):v\d+$/.exec(value);
  return match?.[1] ?? null;
}

/**
 * Resolve a legacy narrative URL to its slug route without a database lookup,
 * so the middleware can answer with a real 308 instead of a streamed
 * client-side redirect. Returns null for paths that are not legacy narrative
 * links (theme ids under /themes/ keep rendering the theme page).
 */
export function legacyNarrativeRedirect(pathname: string): string | null {
  const storyboard = /^\/storyboards\/([^/]+)\/?$/.exec(pathname);
  if (storyboard) {
    return narrativePath(safeDecode(storyboard[1]));
  }
  const theme = /^\/themes\/([^/]+)\/?$/.exec(pathname);
  if (theme) {
    const id = safeDecode(theme[1]);
    if (!isNarrativeDefinitionId(id)) return null;
    const slug = slugFromNarrativeDefinitionId(id);
    return slug ? narrativeDataPath(slug) : null;
  }
  return null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
