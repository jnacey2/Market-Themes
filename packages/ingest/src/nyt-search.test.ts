import assert from "node:assert/strict";
import test from "node:test";
import { createNytSearchConnector, fetchNytSearchArticles } from "./nyt-search";

test("NYT Article Search stays idle without an API key", async () => {
  const previous = process.env.NYT_API_KEY;
  delete process.env.NYT_API_KEY;
  try {
    const documents = await createNytSearchConnector().poll();
    assert.deepEqual(documents, []);
  } finally {
    if (previous === undefined) delete process.env.NYT_API_KEY;
    else process.env.NYT_API_KEY = previous;
  }
});

test("NYT Article Search maps abstracts to snippet documents", async () => {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    requested.push(input.toString());
    return Response.json({
      response: {
        docs: [
          {
            web_url: "https://www.nytimes.com/2026/08/28/business/rates.html?utm_source=api",
            headline: { main: "Rates stay restrictive" },
            abstract: "The Federal Reserve held policy steady while inflation cooled only gradually.",
            pub_date: "2026-08-28T12:00:00+0000",
            source: "The New York Times"
          }
        ]
      }
    });
  }) as typeof fetch;

  const documents = await fetchNytSearchArticles({
    apiKey: "test-key",
    fetchImpl,
    lookbackHours: 24
  });

  assert.equal(documents.length, 1);
  assert.equal(documents[0].publisherOwner, "nyt");
  assert.equal(documents[0].retentionPolicy, "snippet");
  assert.equal(documents[0].retrievalMethod, "api");
  assert.equal(
    documents[0].canonicalUrl,
    "https://www.nytimes.com/2026/08/28/business/rates.html"
  );
  assert.match(requested[0], /api-key=test-key/);
  assert.match(requested[0], /begin_date=/);
});
