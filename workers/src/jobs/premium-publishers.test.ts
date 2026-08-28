import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedPublisherUrl,
  parsePremiumPublisherIds,
  premiumPublisherProfiles
} from "../premium-publishers";

test("parses a deduplicated premium publisher allowlist", () => {
  assert.deepEqual(parsePremiumPublisherIds("wsj,nyt,wsj"), ["wsj", "nyt"]);
  assert.throws(() => parsePremiumPublisherIds("wsj,unknown"), /Unknown premium publisher/);
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
});
