import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { inferPublicationNameFromUrl, normalizePublicationFeedInput } from "./publication-feed";
import {
  feedFromSubstackUrl,
  findRepoRoot,
  loadSubstackPublications,
  matchSubstackPreset,
  parseSubstackPublicationsYaml,
  SUBSTACK_FEED_TERMS,
  SUBSTACK_PUBLICATION_PRESETS,
  substackPresetToFeedInput
} from "./substack-publications";

test("Investment Process Substack presets are unique HTTPS homepages without credentials", () => {
  const names = SUBSTACK_PUBLICATION_PRESETS.map((preset) => preset.name);
  const urls = SUBSTACK_PUBLICATION_PRESETS.map((preset) => preset.baseUrl);
  assert.equal(SUBSTACK_PUBLICATION_PRESETS.length, 8);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(urls).size, urls.length);
  for (const preset of SUBSTACK_PUBLICATION_PRESETS) {
    assert.match(preset.baseUrl, /^https:\/\//);
    assert.equal(preset.baseUrl.endsWith("/"), false);
    assert.doesNotMatch(JSON.stringify(preset), /sid|cookie|storage.state|cf_clearance/i);
  }
  const expected = [
    ["pinebrook", "https://www.pinebrookcap.com"],
    ["lordfed", "https://www.lordfed.co.uk"],
    ["taekim", "https://taekim.substack.com"],
    ["jimpaulsen", "https://paulsenperspectives.substack.com"],
    ["fidenza", "https://www.fidenzamacro.com"],
    ["moontower", "https://moontower.substack.com"],
    ["dannydayan", "https://dannydayan.substack.com"],
    ["dampedspring", "https://dampedspring101.substack.com"]
  ];
  assert.deepEqual(
    SUBSTACK_PUBLICATION_PRESETS.map((preset) => [preset.name, preset.baseUrl]),
    expected
  );
});

test("checked-in YAML seed matches the TypeScript preset list", () => {
  const yamlPath = path.join(findRepoRoot(), "config", "substacks.yaml");
  const fromFile = parseSubstackPublicationsYaml(readFileSync(yamlPath, "utf8"));
  assert.deepEqual(
    fromFile.map((item) => [item.name, item.baseUrl]),
    SUBSTACK_PUBLICATION_PRESETS.map((preset) => [preset.name, preset.baseUrl])
  );
  assert.doesNotMatch(readFileSync(yamlPath, "utf8"), /sid|cf_clearance|connect\.sid/i);
});

test("infers publication names from Substack and custom-domain hostnames", () => {
  assert.equal(inferPublicationNameFromUrl("https://moontower.substack.com"), "moontower");
  assert.equal(inferPublicationNameFromUrl("https://www.pinebrookcap.com/"), "pinebrookcap");
  assert.equal(inferPublicationNameFromUrl("https://dampedspring101.substack.com/p/note"), "dampedspring101");
  const inferred = normalizePublicationFeedInput({
    url: "https://moontower.substack.com",
    platform: "substack",
    termsNotes: SUBSTACK_FEED_TERMS
  });
  assert.equal(inferred.name, "moontower");
  assert.equal(inferred.homepageUrl, "https://moontower.substack.com/");
});

test("resolves a URL to the named preset when it matches", () => {
  const feed = feedFromSubstackUrl("https://www.pinebrookcap.com/");
  assert.equal(feed.name, "pinebrook");
  assert.equal(feed.homepageUrl, "https://www.pinebrookcap.com/");
  assert.equal(feed.platform, "substack");
  assert.equal(matchSubstackPreset("https://moontower.substack.com/archive")?.name, "moontower");
});

test("loads publications from inline YAML or JSON env overrides", () => {
  const yaml = loadSubstackPublications({
    SUBSTACK_PUBLICATIONS_YAML: "- name: example\n  base_url: https://example.substack.com\n"
  });
  assert.deepEqual(yaml, [{ name: "example", baseUrl: "https://example.substack.com" }]);

  const json = loadSubstackPublications({
    SUBSTACK_PUBLICATIONS_YAML: JSON.stringify([
      { name: "other", base_url: "https://other.substack.com/" }
    ])
  });
  assert.deepEqual(json, [{ name: "other", baseUrl: "https://other.substack.com" }]);
});

test("preset payloads stay cookie-free and subscriber-oriented", () => {
  const input = substackPresetToFeedInput(SUBSTACK_PUBLICATION_PRESETS[0]);
  assert.equal(input.platform, "substack");
  assert.equal(input.retentionPolicy, "full_text");
  assert.equal(input.termsNotes, SUBSTACK_FEED_TERMS);
  assert.deepEqual(input.tags, ["substack", "preset"]);
  assert.doesNotMatch(JSON.stringify(input), /sid|cookie|storage.state/i);
});
