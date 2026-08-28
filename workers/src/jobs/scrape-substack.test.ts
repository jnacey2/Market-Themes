import assert from "node:assert/strict";
import test from "node:test";
import { parseSubstackScrapeArgs, scrapeSubstackPublications } from "./scrape-substack";

test("parses scrape-by-URL and YAML CLI flags", () => {
  const parsed = parseSubstackScrapeArgs([
    "--url",
    "https://moontower.substack.com",
    "--limit",
    "1",
    "--no-persist"
  ]);
  assert.deepEqual(parsed.urls, ["https://moontower.substack.com"]);
  assert.equal(parsed.limit, 1);
  assert.equal(parsed.persist, false);
  assert.equal(parseSubstackScrapeArgs(["--all", "--yaml", "config/substacks.yaml"]).all, true);
});

test("scrapes a publication by URL without a database", async () => {
  const requested: string[] = [];
  const encoded = Buffer.from(
    JSON.stringify({
      cookies: [{ name: "substack.sid", value: "abc", domain: ".substack.com" }],
      origins: []
    })
  ).toString("base64");
  const summaries = await scrapeSubstackPublications(
    {
      urls: ["https://moontower.substack.com"],
      all: false,
      limit: 1,
      persist: true
    },
    {
      env: { SUBSTACK_STORAGE_STATE_B64: encoded },
      skipNetworkValidation: true,
      requestDelayMs: 0,
      sleep: async () => undefined,
      now: () => Date.parse("2026-08-28T12:00:00.000Z"),
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("/api/v1/archive")) {
          return Response.json([
            {
              id: 1,
              title: "A paid note",
              slug: "paid-note",
              post_date: "2026-08-27T12:00:00.000Z",
              audience: "only_paid"
            }
          ]);
        }
        return Response.json({
          id: 1,
          title: "A paid note",
          slug: "paid-note",
          post_date: "2026-08-27T12:00:00.000Z",
          audience: "only_paid",
          wordcount: 20,
          body_html: `<p>${"Subscriber evidence about market conditions and corporate behavior. ".repeat(20)}</p>`
        });
      }) as typeof fetch
    }
  );

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].name, "moontower");
  assert.equal(summaries[0].registered, false);
  assert.equal(summaries[0].persisted, false);
  assert.equal(summaries[0].full, 1);
  assert.equal(summaries[0].posts[0].content, "full");
  assert.equal(
    requested.some((url) => url.includes("https://moontower.substack.com/api/v1/archive")),
    true
  );
  assert.equal(
    requested.some((url) => url.includes("https://moontower.substack.com/api/v1/posts/paid-note")),
    true
  );
});
