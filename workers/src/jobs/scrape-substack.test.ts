import assert from "node:assert/strict";
import test from "node:test";
import { parseSubstackScrapeArgs, scrapeSubstackPublications } from "./scrape-substack";

test("parses scrape-by-URL CLI flags including --config and --all", () => {
  const parsed = parseSubstackScrapeArgs([
    "--url",
    "https://moontower.substack.com",
    "--config",
    "config/substacks.yaml",
    "--limit",
    "4",
    "--no-persist"
  ]);
  assert.deepEqual(parsed.urls, ["https://moontower.substack.com"]);
  assert.equal(parsed.yaml, "config/substacks.yaml");
  assert.equal(parsed.limit, 4);
  assert.equal(parsed.persist, false);
  assert.equal(parseSubstackScrapeArgs(["--all"]).all, true);
  assert.deepEqual(parseSubstackScrapeArgs(["https://www.pinebrookcap.com"]).urls, [
    "https://www.pinebrookcap.com"
  ]);
});

test("scrapes a publication by URL without requiring a registered feed", async () => {
  const summaries = await scrapeSubstackPublications(
    {
      urls: ["https://example.substack.com"],
      all: false,
      limit: 2,
      persist: false
    },
    {
      env: {},
      skipNetworkValidation: true,
      requestDelayMs: 0,
      sleep: async () => undefined,
      now: () => Date.parse("2026-08-28T12:00:00.000Z"),
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/api/v1/archive")) {
          return Response.json([
            {
              id: 1,
              title: "Public note",
              slug: "public-note",
              post_date: "2026-08-27T12:00:00.000Z",
              audience: "everyone"
            }
          ]);
        }
        return Response.json({
          id: 1,
          title: "Public note",
          slug: "public-note",
          post_date: "2026-08-27T12:00:00.000Z",
          audience: "everyone",
          body_html: "<p>Public evidence about market conditions and corporate behavior.</p>",
          wordcount: 10
        });
      }) as typeof fetch
    }
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].name, "example");
  assert.equal(summaries[0].fetched, 1);
  assert.equal(summaries[0].full, 1);
  assert.equal(summaries[0].preview, 0);
  assert.equal(summaries[0].registered, false);
  assert.equal(summaries[0].persisted, false);
});
