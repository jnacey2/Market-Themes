import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceSpan,
  isPersistent,
  markValidationAsNotPersistent,
  NarrativeCandidateNotPersistentError,
  resolveCandidatePersistencePolicy,
  structuralAttachmentThreshold
} from "./narrative-candidates";
import type { CandidatePromotionValidation } from "./types";

test("persistence policy defaults to a one-week span and half-share attachment", () => {
  assert.deepEqual(resolveCandidatePersistencePolicy({}), {
    minimumSpanDays: 7,
    attachMinimumShare: 0.5,
    attachMinimumDocuments: 2
  });
  const custom = resolveCandidatePersistencePolicy({
    NARRATIVE_AUTO_PROMOTE_MIN_SPAN_DAYS: "0",
    NARRATIVE_AUTO_PROMOTE_ATTACH_MIN_SHARE: "1.5"
  });
  assert.equal(custom.minimumSpanDays, 0);
  assert.equal(custom.attachMinimumShare, 1);
});

test("evidence span measures the spread of publication dates", () => {
  assert.deepEqual(evidenceSpan([]), { spanDays: 0, distinctWeeks: 0 });
  const burst = evidenceSpan([
    "2026-09-01T09:00:00Z",
    "2026-09-01T15:00:00Z",
    "2026-09-02T08:00:00Z"
  ]);
  assert.ok(burst.spanDays < 1);
  const recurring = evidenceSpan([
    "2026-08-20T09:00:00Z",
    "2026-08-27T09:00:00Z",
    "2026-09-03T09:00:00Z"
  ]);
  assert.equal(recurring.spanDays, 14);
  assert.equal(recurring.distinctWeeks, 3);
});

test("a one-day burst is not persistent unless attached to a structural theme", () => {
  const policy = resolveCandidatePersistencePolicy({});
  assert.equal(isPersistent({ spanDays: 0.5, attachedTo: null }, policy), false);
  assert.equal(isPersistent({ spanDays: 7, attachedTo: null }, policy), true);
  assert.equal(
    isPersistent(
      {
        spanDays: 0.5,
        attachedTo: { definitionId: "narrative:def:energy-demand-growth:v1", name: "Energy Demand Growth", shared: 3 }
      },
      policy
    ),
    true
  );
  assert.equal(
    isPersistent({ spanDays: 0, attachedTo: null }, { minimumSpanDays: 0 }),
    true,
    "a zero minimum disables the gate"
  );
});

test("attachment needs at least half the documents and never fewer than two", () => {
  const policy = resolveCandidatePersistencePolicy({});
  assert.equal(structuralAttachmentThreshold(3, policy), 2);
  assert.equal(structuralAttachmentThreshold(4, policy), 2);
  assert.equal(structuralAttachmentThreshold(5, policy), 3);
  assert.equal(structuralAttachmentThreshold(1, policy), 2);
});

test("deferred candidates are marked ineligible with the persistence reason", () => {
  const validation: CandidatePromotionValidation = {
    candidateId: "candidate:1",
    status: "eligible",
    candidateKind: "event",
    eventLabel: "Test event",
    summaryReason: "ok",
    reasons: ["ok"],
    supportedEvidenceIds: ["e1"],
    breadth: {
      storyBreadth: 3,
      eventBreadth: 1,
      primaryEntityBreadth: 1,
      publisherOwnerBreadth: 3,
      sourceClassBreadth: 1
    },
    evidence: [],
    promptVersion: "v",
    model: "m",
    evaluatedAt: "2026-09-01T00:00:00.000Z"
  };
  const error = new NarrativeCandidateNotPersistentError("spans 0.4 days", {
    spanDays: 0.4,
    distinctWeeks: 1,
    attachedTo: null
  });
  const marked = markValidationAsNotPersistent(validation, error, new Date("2026-09-05T00:00:00Z"));
  assert.equal(marked.status, "ineligible");
  assert.match(marked.summaryReason, /Deferred until the evidence persists/);
  assert.equal(marked.evaluatedAt, "2026-09-05T00:00:00.000Z");
  assert.equal(marked.reasons.length, 2);
});
