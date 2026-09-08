import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAttentionBursts,
  extractBurstTerms,
  titleNgrams,
  type BurstCorpusDocument
} from "./attention-bursts";

test("title n-grams drop stopwords, numbers, and publisher boilerplate", () => {
  const grams = titleNgrams("Bloomberg: Private credit redemptions surge 40% as the Fed holds");
  assert.ok(grams.includes("private credit"));
  assert.ok(grams.includes("credit redemptions"));
  assert.ok(grams.includes("private credit redemptions"));
  assert.ok(!grams.some((gram) => gram.includes("bloomberg")));
  assert.ok(!grams.some((gram) => /\b40%\b/.test(gram)));
});

test("entities and theme labels are normalized and generic entities are dropped", () => {
  const terms = extractBurstTerms({
    documentId: "d",
    date: "2026-09-01",
    title: "Quarterly update",
    storyFingerprint: "d",
    publisherOwner: "o",
    entities: ["The Company", "Blue Owl Capital", "investors"],
    themeLabels: ["Private Credit Redemption Pressure"]
  });
  const byTerm = Object.fromEntries(terms.map((entry) => [entry.term, entry.kind]));
  assert.equal(byTerm["blue owl capital"], "entity");
  assert.equal(byTerm["private credit redemption pressure"], "theme_label");
  assert.equal(byTerm["the company"], undefined);
  assert.equal(byTerm["investors"], undefined);
});

test("a term mentioned by several independent publishers this week with no history is a novel burst", () => {
  const documents: BurstCorpusDocument[] = [];
  // Background chatter over 12 weeks about "rate cuts" from two owners, steady 2 stories/week.
  for (let week = 1; week <= 12; week += 1) {
    for (let story = 0; story < 2; story += 1) {
      documents.push(doc(`bg-${week}-${story}`, shift("2026-09-01", -7 * week), "Fed rate cuts debate continues", `owner-${story}`));
    }
  }
  // Current week: same chatter plus a new term from four different owners.
  for (let story = 0; story < 2; story += 1) {
    documents.push(doc(`cur-bg-${story}`, "2026-08-30", "Fed rate cuts debate continues", `owner-${story}`));
  }
  for (let story = 0; story < 4; story += 1) {
    documents.push(doc(`cur-new-${story}`, "2026-08-31", "Tariff refunds flood importers after court ruling", `press-${story}`));
  }

  const bursts = detectAttentionBursts(documents, "2026-09-01");
  const tariff = bursts.find((burst) => burst.term === "tariff refunds flood");
  assert.ok(tariff, `expected tariff burst, got ${bursts.map((burst) => burst.term).join(", ")}`);
  assert.equal(tariff.novel, true);
  assert.equal(tariff.currentStories, 4);
  assert.equal(tariff.currentOwners, 4);
  assert.ok(!bursts.some((burst) => burst.term === "rate cuts"), "steady chatter is not a burst");
  // nested bigrams with the identical sample are collapsed into the trigram
  assert.ok(!bursts.some((burst) => burst.term === "tariff refunds"));
});

test("a sharp rise against an established baseline produces a positive z-score burst", () => {
  const documents: BurstCorpusDocument[] = [];
  for (let week = 1; week <= 12; week += 1) {
    documents.push(doc(`bg-${week}`, shift("2026-09-01", -7 * week), "Regional bank deposit outflows", "owner-a"));
  }
  for (let story = 0; story < 9; story += 1) {
    documents.push(doc(`cur-${story}`, "2026-08-29", "Regional bank deposit outflows accelerate", `owner-${story % 3}`));
  }
  const bursts = detectAttentionBursts(documents, "2026-09-01");
  const burst = bursts.find((entry) => entry.term === "regional bank deposit");
  assert.ok(burst);
  assert.equal(burst.novel, false);
  assert.ok(burst.zScore >= 2, `z ${burst.zScore}`);
  assert.equal(burst.baselineWindows, 12);
});

test("syndicated copies count once and single-owner chatter is ignored", () => {
  const documents: BurstCorpusDocument[] = [];
  for (let copy = 0; copy < 6; copy += 1) {
    documents.push({
      ...doc(`copy-${copy}`, "2026-08-31", "Wire story about lithium prices collapsing", `outlet-${copy}`),
      storyFingerprint: "same-wire-story"
    });
  }
  for (let story = 0; story < 5; story += 1) {
    documents.push(doc(`solo-${story}`, "2026-08-31", "Blog series on uranium enrichment capacity", "single-owner"));
  }
  const bursts = detectAttentionBursts(documents, "2026-09-01");
  assert.equal(bursts.length, 0);
});

function doc(id: string, date: string, title: string, owner: string): BurstCorpusDocument {
  return {
    documentId: id,
    date,
    title,
    storyFingerprint: id,
    publisherOwner: owner
  };
}

function shift(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
