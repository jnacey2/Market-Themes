/**
 * Earnings-call transcript sectioning.
 *
 * Earnings calls have two very different evidentiary regimes: scripted
 * prepared remarks (management's chosen framing) and the Q&A session (where
 * analysts probe and management answers off-script). Extraction prompts and
 * downstream review benefit from knowing which regime a snippet came from, so
 * we locate the boundary once and expose it both as document metadata and as
 * labeled prompt sections.
 */

export type TranscriptSectionLabel = "prepared_remarks" | "qa";

export type TranscriptSectionSpan = {
  label: TranscriptSectionLabel;
  start: number;
  end: number;
};

export type TranscriptSectioning = {
  /** Character offset at which the Q&A session begins, or null when not found. */
  qaStartOffset: number | null;
  /** How the boundary was located, for diagnostics. */
  boundaryMethod: "operator_cue" | "heading" | "first_analyst_question" | "none";
  sections: TranscriptSectionSpan[];
};

/**
 * Operator / host cues that open the Q&A session. Matched against the start
 * of a line (after an optional speaker prefix such as "Operator:").
 */
const OPERATOR_CUE_PATTERNS: RegExp[] = [
  /(?:^|\n)(?:operator\s*:\s*)?[^\n]{0,160}?\b(?:we will|we'll|we would|we'd|let's|let us|i will|i'll)\s+(?:now\s+)?(?:begin|start|open|move|go|conduct|proceed|take)\b[^\n]{0,80}?\b(?:question|q\s*&\s*a|q\s+and\s+a)/i,
  /(?:^|\n)(?:operator\s*:\s*)?[^\n]{0,160}?\b(?:the floor is (?:now )?open|now open the (?:call|line|lines|floor))\b[^\n]{0,80}?\b(?:question|q\s*&\s*a)/i,
  /(?:^|\n)(?:operator\s*:\s*)?[^\n]{0,120}?\b(?:our first question|the first question|first question)\b[^\n]{0,80}?\b(?:comes?|is)\s+from\b/i,
  /(?:^|\n)(?:operator\s*:\s*)?[^\n]{0,160}?\b(?:ready|happy|glad|pleased)\s+to\s+(?:take|answer|open(?: it up)?(?: for)?)\s+(?:your\s+|any\s+)?questions/i,
  /(?:^|\n)(?:operator\s*:\s*)?[^\n]{0,120}?\bopen(?:ing)?\s+(?:it\s+|the\s+(?:call|line|lines)\s+)?up\s+(?:for|to)\s+(?:your\s+)?questions/i
];

/** Standalone headings that transcript vendors sometimes insert. */
const HEADING_PATTERNS: RegExp[] = [
  /(?:^|\n)\s*\[?\s*(?:q\s*&\s*a|q\s+and\s+a|question[- ]and[- ]answer(?: session)?|questions and answers)\s*\]?\s*:?\s*(?=\n|$)/i
];

/** Fallback: an operator handing the line to a named analyst. */
const FIRST_ANALYST_PATTERN =
  /(?:^|\n)operator\s*:\s*[^\n]{0,200}?\b(?:comes? from|is from|from the line of)\b[^\n]{0,120}?\b(?:with|of|at|from)\b/i;

/**
 * Minimum share of the transcript that must precede the Q&A boundary. Calls
 * usually spend at least the first tenth on safe-harbor language and remarks;
 * a match earlier than that is almost always a stray phrase in the opening.
 */
const MIN_PREPARED_SHARE = 0.08;

/** Minimum share that must follow the boundary for it to be meaningful. */
const MIN_QA_SHARE = 0.05;

export function detectTranscriptSections(text: string): TranscriptSectioning {
  const length = text.length;
  const fullSpan: TranscriptSectionSpan[] = [
    { label: "prepared_remarks", start: 0, end: length }
  ];

  if (length < 400) {
    return { qaStartOffset: null, boundaryMethod: "none", sections: fullSpan };
  }

  const lowerBound = Math.floor(length * MIN_PREPARED_SHARE);
  const upperBound = Math.ceil(length * (1 - MIN_QA_SHARE));

  const candidates: Array<{ offset: number; method: TranscriptSectioning["boundaryMethod"] }> =
    [];

  for (const pattern of HEADING_PATTERNS) {
    const offset = firstLineStart(text, pattern, lowerBound, upperBound);
    if (offset !== null) {
      candidates.push({ offset, method: "heading" });
    }
  }

  for (const pattern of OPERATOR_CUE_PATTERNS) {
    const offset = firstLineStart(text, pattern, lowerBound, upperBound);
    if (offset !== null) {
      candidates.push({ offset, method: "operator_cue" });
    }
  }

  if (candidates.length === 0) {
    const offset = firstLineStart(text, FIRST_ANALYST_PATTERN, lowerBound, upperBound);
    if (offset !== null) {
      candidates.push({ offset, method: "first_analyst_question" });
    }
  }

  if (candidates.length === 0) {
    return { qaStartOffset: null, boundaryMethod: "none", sections: fullSpan };
  }

  // Headings and operator cues are both strong; take the earliest plausible one.
  candidates.sort((left, right) => left.offset - right.offset);
  const chosen = candidates[0];

  return {
    qaStartOffset: chosen.offset,
    boundaryMethod: chosen.method,
    sections: [
      { label: "prepared_remarks", start: 0, end: chosen.offset },
      { label: "qa", start: chosen.offset, end: length }
    ]
  };
}

/**
 * Reads sectioning that an ingest connector stored on the document, if it is
 * well formed and consistent with the current text length.
 */
export function readStoredTranscriptSections(
  metadata: Record<string, unknown> | undefined,
  textLength: number
): TranscriptSectioning | null {
  const raw = metadata?.transcriptSections;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Partial<TranscriptSectioning>;
  if (!Array.isArray(record.sections) || record.sections.length === 0) {
    return null;
  }

  const sections: TranscriptSectionSpan[] = [];
  for (const span of record.sections) {
    if (
      !span ||
      typeof span !== "object" ||
      (span.label !== "prepared_remarks" && span.label !== "qa") ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start < 0 ||
      span.end > textLength ||
      span.end <= span.start
    ) {
      return null;
    }
    sections.push({ label: span.label, start: span.start, end: span.end });
  }

  const qa = sections.find((span) => span.label === "qa");
  return {
    qaStartOffset: qa ? qa.start : null,
    boundaryMethod:
      record.boundaryMethod === "operator_cue" ||
      record.boundaryMethod === "heading" ||
      record.boundaryMethod === "first_analyst_question"
        ? record.boundaryMethod
        : "none",
    sections
  };
}

export function transcriptSectionDisplayLabel(label: TranscriptSectionLabel) {
  return label === "qa" ? "Q&A" : "Prepared remarks";
}

function firstLineStart(
  text: string,
  pattern: RegExp,
  lowerBound: number,
  upperBound: number
): number | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const scanner = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;

  while ((match = scanner.exec(text)) !== null) {
    // Matches are anchored to a line start (or the very beginning); report the
    // offset of the first non-blank character rather than any leading newlines.
    const leadingBlank = match[0].length - match[0].trimStart().length;
    const lineStart = match.index + leadingBlank;

    if (lineStart >= lowerBound && lineStart <= upperBound) {
      return lineStart;
    }

    if (lineStart > upperBound) {
      return null;
    }

    if (match[0].length === 0) {
      scanner.lastIndex += 1;
    }
  }

  return null;
}
