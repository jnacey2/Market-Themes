import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeStorageState,
  isAllowedPublisherUrl,
  parsePremiumPublisherIds,
  premiumPublisherProfiles
} from "../premium-publishers";

test("premium publisher owners use shared slugs", () => {
  assert.equal(premiumPublisherProfiles.wsj.publisherOwner, "dow-jones");
  assert.equal(premiumPublisherProfiles.nyt.publisherOwner, "nyt");
  assert.equal(premiumPublisherProfiles.wapo.publisherOwner, "washington-post");
  assert.equal(premiumPublisherProfiles.ft.publisherOwner, "financial-times");
  assert.equal(premiumPublisherProfiles.bloomberg.publisherOwner, "bloomberg");
});

test("parses a deduplicated premium publisher allowlist", () => {
  assert.deepEqual(parsePremiumPublisherIds("wsj,nyt,wsj"), ["wsj", "nyt"]);
  assert.throws(() => parsePremiumPublisherIds("wsj,unknown"), /Unknown premium publisher/);
});

test("decodes only Playwright-shaped storage state secrets", () => {
  const state = { cookies: [], origins: [] };
  assert.deepEqual(
    decodeStorageState(Buffer.from(JSON.stringify(state)).toString("base64")),
    state
  );
  assert.throws(() => decodeStorageState("not-json"), /not valid/);
  assert.throws(
    () =>
      decodeStorageState(
        Buffer.from(JSON.stringify({ cookies: [] })).toString("base64")
      ),
    /not valid/
  );
});

test("rejects credentialed, insecure, and lookalike article URLs", () => {
  const profile = premiumPublisherProfiles.wsj;
  assert.equal(
    isAllowedPublisherUrl("https://www.wsj.com/finance/example", profile),
    true
  );
  assert.equal(
    isAllowedPublisherUrl("https://wsj.com.evil.example/finance/example", profile),
    false
  );
  assert.equal(
    isAllowedPublisherUrl("http://www.wsj.com/finance/example", profile),
    false
  );
  assert.equal(
    isAllowedPublisherUrl("https://user:secret@www.wsj.com/finance/example", profile),
    false
  );
  assert.equal(
    isAllowedPublisherUrl("https://www.wsj.com/client/login", profile),
    false
  );
  assert.equal(
    isAllowedPublisherUrl(
      "https://www.ft.com/content/d15851dc-9177-4bfe-9039-8d9994a2e4b3",
      premiumPublisherProfiles.ft
    ),
    true
  );
});
