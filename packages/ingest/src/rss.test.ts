import assert from "node:assert/strict";
import test from "node:test";
import { createRssConnector, detectWireOrigin } from "./rss";

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>NYT Business</title>
    <item>
      <title>Inflation cools, but not enough</title>
      <link>https://www.nytimes.com/2026/08/28/business/inflation.html?utm_source=rss</link>
      <pubDate>Fri, 28 Aug 2026 12:00:00 GMT</pubDate>
      <description>A short lede about prices and policy.</description>
      <content:encoded><![CDATA[<p>Full article body that should not be stored in snippet mode.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

test("RSS snippet retention keeps the lede and maps publisher owners", async () => {
  const fetchImpl = (async () =>
    new Response(FEED_XML, { headers: { "Content-Type": "application/rss+xml" } })) as typeof fetch;

  const documents = await createRssConnector({
    id: "nyt-business",
    name: "NYT Business",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
    sourceClass: "newspaper",
    publisherOwner: "nyt",
    retentionPolicy: "snippet",
    lookbackHours: 24 * 365,
    fetchImpl
  }).poll();

  assert.equal(documents.length, 1);
  assert.equal(documents[0].publisherOwner, "nyt");
  assert.equal(documents[0].retentionPolicy, "snippet");
  assert.equal(documents[0].body, "A short lede about prices and policy.");
  assert.doesNotMatch(documents[0].body, /Full article body/);
  assert.equal(
    documents[0].canonicalUrl,
    "https://www.nytimes.com/2026/08/28/business/inflation.html"
  );
});

test("attributes syndicated RSS copy to its wire origin", () => {
  assert.equal(
    detectWireOrigin(
      "NEW YORK (Reuters) - Oil prices rose as traders reassessed supply risk."
    ),
    "reuters"
  );
  assert.equal(
    detectWireOrigin("The Associated Press reported that yields moved higher."),
    "associated-press"
  );
  assert.equal(
    detectWireOrigin("The publisher's own market analysis."),
    null
  );
});
