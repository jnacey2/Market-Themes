import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublisherOwner } from "./publisher-owners";

test("maps newspaper domains and site names to shared owners", () => {
  assert.equal(
    resolvePublisherOwner({ url: "https://www.wsj.com/articles/example" }),
    "dow-jones"
  );
  assert.equal(
    resolvePublisherOwner({ url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" }),
    "dow-jones"
  );
  assert.equal(resolvePublisherOwner({ site: "MarketWatch" }), "dow-jones");
  assert.equal(
    resolvePublisherOwner({ url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml" }),
    "nyt"
  );
  assert.equal(resolvePublisherOwner({ site: "New York Times" }), "nyt");
  assert.equal(
    resolvePublisherOwner({ url: "https://www.washingtonpost.com/business/2026/08/28/example/" }),
    "washington-post"
  );
  assert.equal(
    resolvePublisherOwner({ url: "https://feeds.bloomberg.com/markets/news.rss" }),
    "bloomberg"
  );
  assert.equal(resolvePublisherOwner({ url: "https://www.ft.com/content/abc" }), "financial-times");
  assert.equal(resolvePublisherOwner({ site: "Reuters" }), "reuters");
});

test("does not treat lookalike hostnames as the same publisher", () => {
  assert.equal(
    resolvePublisherOwner({
      url: "https://wsj.com.evil.example/articles/example",
      fallback: "unknown-wire"
    }),
    "unknown-wire"
  );
  assert.equal(
    resolvePublisherOwner({ site: "WSJ Daily Digest Newsletter", fallback: "newsletter" }),
    "dow-jones"
  );
});

test("falls back to a slug when no newspaper owner matches", () => {
  assert.equal(
    resolvePublisherOwner({ site: "Seeking Alpha", url: "https://seekingalpha.com/article/1" }),
    "seeking-alpha"
  );
}
