const namedEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—"
};

/** Resolve presentation differences to a contiguous, exact source substring.
 * Never case-fold, paraphrase, stitch fragments, or accept title-only evidence.
 */
export function resolveSourceQuotation(source: string, quotation: string): string | null {
  const quote = quotation.trim();
  if (!quote) return null;
  if (source.includes(quote)) return quote;
  const normalizedSource = normalizeWithOffsets(source);
  const normalizedQuote = normalizeWithOffsets(quote).text.trim();
  if (!normalizedQuote) return null;
  const start = normalizedSource.text.indexOf(normalizedQuote);
  if (start < 0) return null;
  const original = source.slice(
    normalizedSource.starts[start],
    normalizedSource.ends[start + normalizedQuote.length - 1]
  );
  return normalizeWithOffsets(original).text.trim() === normalizedQuote ? original : null;
}

function normalizeWithOffsets(value: string) {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const tokens = /&#(?:x[0-9a-f]+|[0-9]+);|&[a-z]+;|[\s\S]/giu;
  for (const match of value.matchAll(tokens)) {
    const raw = match[0];
    let decoded = raw;
    if (raw.startsWith("&#")) {
      const hex = raw[2].toLowerCase() === "x";
      const code = Number.parseInt(raw.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        decoded = String.fromCodePoint(code);
      }
    } else if (raw.startsWith("&")) {
      const name = raw.slice(1, -1);
      decoded = Object.hasOwn(namedEntities, name) ? namedEntities[name] : raw;
    }
    decoded = decoded.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    for (const character of decoded) {
      const normalized = /\s/u.test(character) ? " " : character;
      if (normalized === " " && text.endsWith(" ")) {
        ends[ends.length - 1] = match.index + raw.length;
        continue;
      }
      text += normalized;
      // Offsets follow UTF-16 indices, as do indexOf and slice.
      for (let i = 0; i < normalized.length; i++) {
        starts.push(match.index);
        ends.push(match.index + raw.length);
      }
    }
  }
  return { text, starts, ends };
}
