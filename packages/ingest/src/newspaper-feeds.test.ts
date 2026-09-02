import assert from "node:assert/strict";
import test from "node:test";
import {
  NEWSPAPER_FEED_GROUPS,
  NEWSPAPER_FEED_PRESETS,
  NEWSPAPER_FEED_TERMS,
  newspaperPresetToFeedInput
} from "./newspaper-feeds";

test("newspaper presets are unique HTTPS feeds with stable owners", () => {
  const urls = NEWSPAPER_FEED_PRESETS.map((preset) => preset.url);
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(NEWSPAPER_FEED_PRESETS.length >= 16);

  for (const preset of NEWSPAPER_FEED_PRESETS) {
    assert.match(preset.url, /^https:\/\//);
    assert.match(preset.homepageUrl, /^https:\/\//);
    const group = NEWSPAPER_FEED_GROUPS.find((item) => item.id === preset.group);
    assert.ok(group);
    if (group.publisherOwner) {
      assert.equal(preset.publisherOwner, group.publisherOwner);
    } else {
      // mixed-owner groups (sector trade press) resolve each outlet's owner from its URL
      assert.ok(preset.publisherOwner.length > 0);
      assert.notEqual(preset.publisherOwner, preset.group);
    }
  }
});

test("trade press presets resolve to distinct publisher owners", () => {
  const tradePress = NEWSPAPER_FEED_PRESETS.filter((preset) => preset.group === "trade-press");
  assert.ok(tradePress.length >= 5);
  assert.equal(new Set(tradePress.map((preset) => preset.publisherOwner)).size, tradePress.length);
});

test("preset payloads stay snippet-only and unauthenticated", () => {
  const input = newspaperPresetToFeedInput(NEWSPAPER_FEED_PRESETS[0]);
  assert.equal(input.platform, "rss");
  assert.equal(input.retentionPolicy, "snippet");
  assert.equal(input.termsNotes, NEWSPAPER_FEED_TERMS);
  assert.deepEqual(input.tags, ["rss", "newspaper", "preset"]);
  assert.match(input.termsNotes, /snippet/i);
  assert.match(input.termsNotes, /no paywall/i);
});
