import assert from "node:assert/strict";
import test from "node:test";
import { resolveSourceQuotation } from "./source-quotation";

test("quotation formatting resolves back to the exact original source bytes", () => {
  for (const [source, quote, expected] of [
    ["Taiwan’s exports surged.", "Taiwan's exports surged.", "Taiwan’s exports surged."],
    ["He favors “picks and shovels” investments.", '"picks and shovels"', "“picks and shovels”"],
    ["Google's investment &#x2014; its largest &#8212; grew.", "investment — its largest — grew", "investment &#x2014; its largest &#8212; grew"],
    ["Demand\n\t is\u00a0rising quickly.", "Demand is rising quickly", "Demand\n\t is\u00a0rising quickly"],
    ["The firm’s R&amp;D demand rose.", "firm's R&D demand", "firm’s R&amp;D demand"],
    ["💡 Demand’s rising.", "💡 Demand's rising.", "💡 Demand’s rising."],
    ["Demand is rising.", "Demand is rising", "Demand is rising"]
  ]) {
    const result = resolveSourceQuotation(source, quote);
    assert.equal(result, expected);
    assert.ok(source.includes(result!));
  }
});

test("formatting recovery never accepts paraphrases, stitched or reordered quotes, or missing evidence", () => {
  const source = "Oil rose and inflation worries grew. Demand’s slowing.";
  for (const quote of [
    "Oil rose...inflation worries grew", "inflation worries grew. Oil rose",
    "Oil fell", "Demand's accelerating", "demand's slowing", "", "   ",
    "A headline absent from the body"
  ]) assert.equal(resolveSourceQuotation(source, quote), null);
  assert.doesNotThrow(() => resolveSourceQuotation("&constructor; Demand’s slowing.", "Demand's slowing"));
});
