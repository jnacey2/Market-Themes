import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectTranscriptSections,
  readStoredTranscriptSections
} from "./transcript-sections";

function remarks(paragraphs: number) {
  const lines: string[] = [
    "Operator: Good afternoon and welcome to the second quarter earnings call. Today's presentation contains forward-looking statements."
  ];
  for (let index = 0; index < paragraphs; index += 1) {
    lines.push(
      `Chief Executive Officer: Revenue grew double digits this quarter as demand for our platform remained strong across every region. We continue to invest in capacity while holding operating expense growth below revenue growth, and we remain confident in our full-year outlook. Paragraph ${index}.`
    );
  }
  return lines.join("\n\n");
}

function questions(paragraphs: number) {
  const lines: string[] = [];
  for (let index = 0; index < paragraphs; index += 1) {
    lines.push(
      `Analyst ${index}: Thanks for taking the question. Can you talk about pricing dynamics and whether the elasticity you saw last quarter has changed?`,
      `Chief Financial Officer: Sure. We have seen pricing hold up better than expected and we are not seeing meaningful trade-down in the enterprise segment.`
    );
  }
  return lines.join("\n\n");
}

test("locates the Q&A boundary from a standard operator cue", () => {
  const prepared = remarks(12);
  const cue =
    "Operator: Thank you. We will now begin the question-and-answer session. To ask a question, please press star one.";
  const text = `${prepared}\n\n${cue}\n\n${questions(8)}`;

  const result = detectTranscriptSections(text);

  assert.equal(result.boundaryMethod, "operator_cue");
  assert.equal(result.qaStartOffset, text.indexOf(cue));
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].label, "prepared_remarks");
  assert.equal(result.sections[0].start, 0);
  assert.equal(result.sections[0].end, result.qaStartOffset);
  assert.equal(result.sections[1].label, "qa");
  assert.equal(result.sections[1].end, text.length);
});

test("recognizes management handing the call to questions without an operator prefix", () => {
  const prepared = remarks(12);
  const cue = "With that, we are happy to take your questions.";
  const text = `${prepared}\n\n${cue}\n\n${questions(8)}`;

  const result = detectTranscriptSections(text);

  assert.equal(result.boundaryMethod, "operator_cue");
  assert.equal(result.qaStartOffset, text.indexOf(cue));
});

test("prefers a vendor heading when present", () => {
  const prepared = remarks(12);
  const heading = "Questions and Answers";
  const text = `${prepared}\n\n${heading}\n\nOperator: Our first question comes from Jane Doe with Example Capital.\n\n${questions(6)}`;

  const result = detectTranscriptSections(text);

  assert.equal(result.boundaryMethod, "heading");
  assert.equal(result.qaStartOffset, text.indexOf(heading));
});

test("falls back to the first operator hand-off to an analyst", () => {
  const prepared = remarks(12);
  const handoff = "Operator: Your next question comes from the line of John Smith with Example Securities. Please go ahead.";
  const text = `${prepared}\n\n${handoff}\n\n${questions(6)}`;

  const result = detectTranscriptSections(text);

  assert.equal(result.boundaryMethod, "first_analyst_question");
  assert.equal(result.qaStartOffset, text.indexOf(handoff));
});

test("ignores cue-like phrases in the opening safe-harbor paragraph", () => {
  const opening =
    "Operator: Welcome. Later we will open the call for questions. Before we begin, note that today's remarks include forward-looking statements.";
  const cue = "Operator: We will now open the line for questions.";
  const text = `${opening}\n\n${remarks(14)}\n\n${cue}\n\n${questions(8)}`;

  const result = detectTranscriptSections(text);

  assert.equal(result.qaStartOffset, text.indexOf(cue));
  assert.ok((result.qaStartOffset ?? 0) > text.length * 0.08);
});

test("returns a single prepared-remarks span when no boundary is found", () => {
  const text = remarks(20);

  const result = detectTranscriptSections(text);

  assert.equal(result.qaStartOffset, null);
  assert.equal(result.boundaryMethod, "none");
  assert.deepEqual(result.sections, [
    { label: "prepared_remarks", start: 0, end: text.length }
  ]);
});

test("does not treat a Q&A cue in the final few percent of the text as a boundary", () => {
  const text = `${remarks(40)}\n\nOperator: We will now begin the question-and-answer session.\n\nOperator: There are no questions. This concludes today's call.`;

  const result = detectTranscriptSections(text);

  assert.equal(result.qaStartOffset, null);
});

test("readStoredTranscriptSections validates stored offsets against text length", () => {
  const valid = readStoredTranscriptSections(
    {
      transcriptSections: {
        qaStartOffset: 100,
        boundaryMethod: "operator_cue",
        sections: [
          { label: "prepared_remarks", start: 0, end: 100 },
          { label: "qa", start: 100, end: 250 }
        ]
      }
    },
    250
  );

  assert.ok(valid);
  assert.equal(valid.qaStartOffset, 100);
  assert.equal(valid.sections.length, 2);

  const stale = readStoredTranscriptSections(
    {
      transcriptSections: {
        sections: [
          { label: "prepared_remarks", start: 0, end: 100 },
          { label: "qa", start: 100, end: 500 }
        ]
      }
    },
    250
  );
  assert.equal(stale, null);

  assert.equal(readStoredTranscriptSections({}, 250), null);
  assert.equal(readStoredTranscriptSections(undefined, 250), null);
});
