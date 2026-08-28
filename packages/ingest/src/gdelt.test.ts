import assert from "node:assert/strict";
import test from "node:test";
import { buildGdeltQuery, DEFAULT_GDELT_DOMAINS, parseGdeltDomains } from "./gdelt";

test("GDELT domain parsing keeps defaults unless explicitly cleared", () => {
  assert.deepEqual(parseGdeltDomains(undefined), DEFAULT_GDELT_DOMAINS);
  assert.deepEqual(parseGdeltDomains(""), []);
  assert.deepEqual(parseGdeltDomains("wsj.com, NYTimes.com, wsj.com"), [
    "wsj.com",
    "nytimes.com"
  ]);
});

test("GDELT queries append a domain allowlist", () => {
  assert.equal(
    buildGdeltQuery({ query: "inflation sourcelang:english", domains: ["wsj.com", "ft.com"] }),
    "inflation sourcelang:english (domain:wsj.com OR domain:ft.com)"
  );
  assert.equal(
    buildGdeltQuery({ query: "inflation sourcelang:english", domains: [] }),
    "inflation sourcelang:english"
  );
  assert.match(buildGdeltQuery(), /domain:nytimes.com/);
}
