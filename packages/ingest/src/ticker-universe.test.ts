import assert from "node:assert/strict";
import test from "node:test";
import { SEC_TARGET_TICKERS } from "./sec-targets";
import {
  parseConstituents,
  parseUniverseIds,
  resolveTargetTickers
} from "./ticker-universe";

test("universe ids accept aliases and fall back to seed", () => {
  assert.deepEqual(parseUniverseIds(undefined), ["seed"]);
  assert.deepEqual(parseUniverseIds("sp500, Nasdaq-100"), ["sp500", "nasdaq100"]);
  assert.deepEqual(parseUniverseIds("bogus"), ["seed"]);
});

test("constituent payloads are normalized to SEC-style symbols", () => {
  assert.deepEqual(
    parseConstituents([{ symbol: "brk.b" }, { symbol: "AAPL" }, { symbol: "AAPL" }, { name: "x" }]),
    ["AAPL", "BRK-B"]
  );
});

test("explicit tickers win and seed is used without a universe", async () => {
  const previous = { ...process.env };
  delete process.env.SEC_TARGET_TICKERS;
  delete process.env.TARGET_UNIVERSE;
  try {
    assert.deepEqual(await resolveTargetTickers({ explicit: ["msft", "AAPL"] }), ["AAPL", "MSFT"]);
    assert.deepEqual(await resolveTargetTickers(), [...SEC_TARGET_TICKERS]);
  } finally {
    process.env = previous;
  }
});

test("index constituents are fetched once per process and merged with the seed on failure", async () => {
  const previous = { ...process.env };
  delete process.env.SEC_TARGET_TICKERS;
  try {
    let calls = 0;
    const fetchImpl = (async (input: URL | RequestInfo) => {
      calls += 1;
      const url = String(input);
      if (url.includes("sp500-constituent")) {
        return new Response(
          JSON.stringify(Array.from({ length: 25 }, (_, index) => ({ symbol: `S${index}` }))),
          { status: 200 }
        );
      }
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    const cache = new Map();
    const first = await resolveTargetTickers({
      universe: "sp500,nasdaq100",
      apiKey: "test-key",
      fetchImpl,
      cache
    });
    assert.ok(first.includes("S0"));
    assert.ok(first.includes("AAPL"), "failed universe falls back to the seed list");
    assert.equal(calls, 2);
    await resolveTargetTickers({ universe: "sp500", apiKey: "test-key", fetchImpl, cache });
    assert.equal(calls, 2, "successful universe is cached");
  } finally {
    process.env = previous;
  }
});
