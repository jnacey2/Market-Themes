import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyNarrativeRedirect,
  narrativeDataPath,
  narrativePath,
  slugFromNarrativeDefinitionId
} from "./narrative-paths";

test("narrative routes are slug based", () => {
  assert.equal(narrativePath("oil-shock"), "/narratives/oil-shock");
  assert.equal(narrativeDataPath("oil shock"), "/narratives/oil%20shock/data");
});

test("definition ids yield their slug", () => {
  assert.equal(
    slugFromNarrativeDefinitionId("narrative:def:us-labor-market-surprise-resilience-fed-policy-timing:v1"),
    "us-labor-market-surprise-resilience-fed-policy-timing"
  );
  assert.equal(slugFromNarrativeDefinitionId("narrative:def:oil-shock:v12"), "oil-shock");
  assert.equal(slugFromNarrativeDefinitionId("theme:oil-shock"), null);
  assert.equal(slugFromNarrativeDefinitionId("narrative:def:oil-shock"), null);
});

test("legacy narrative links redirect to slug routes without a lookup", () => {
  assert.equal(
    legacyNarrativeRedirect("/storyboards/us-labor-market"),
    "/narratives/us-labor-market"
  );
  assert.equal(
    legacyNarrativeRedirect("/themes/narrative%3Adef%3Aus-labor-market%3Av1"),
    "/narratives/us-labor-market/data"
  );
  assert.equal(
    legacyNarrativeRedirect("/themes/narrative:def:us-labor-market:v1/"),
    "/narratives/us-labor-market/data"
  );
  // Theme ids keep rendering the theme detail page.
  assert.equal(legacyNarrativeRedirect("/themes/theme-123"), null);
  assert.equal(legacyNarrativeRedirect("/themes/narrative%3Adef%3Amalformed"), null);
  assert.equal(legacyNarrativeRedirect("/trends"), null);
  assert.equal(legacyNarrativeRedirect("/storyboards/"), null);
});
