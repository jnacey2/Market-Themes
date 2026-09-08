import assert from "node:assert/strict";
import test from "node:test";
import {
  isPublicAddress,
  publicHttpsUrl,
  resolvePublicUrl
} from "./public-fetch";

test("blocks private, translated, documentation and expanded IPv6 targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.1.1",
    "192.168.1.2",
    "::1",
    "::ffff:127.0.0.1",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
    "fc00::1",
    "fe80::1",
    "2002:7f00:1::"
  ])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(isPublicAddress(address), true, address);
  for (const url of [
    "https://2130706433/feed",
    "https://user:pass@example.com",
    "https://example.com:8080",
    "http://example.com",
    "https://[::ffff:127.0.0.1]/"
  ])
    assert.throws(() => publicHttpsUrl(url));
});
test("rejects mixed public/private DNS answers before making a connection", async () => {
  const resolver = (async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "10.0.0.1", family: 4 }
  ]) as unknown as Parameters<typeof resolvePublicUrl>[1];
  await assert.rejects(
    resolvePublicUrl("https://example.com", resolver),
    /private/
  );
});

test("DNS resolution shares the request deadline", async () => {
  const controller = new AbortController();
  const resolver = (() =>
    new Promise(() => undefined)) as unknown as Parameters<
    typeof resolvePublicUrl
  >[1];
  const timer = setTimeout(
    () => controller.abort(new Error("DNS deadline")),
    5
  );
  try {
    await assert.rejects(
      resolvePublicUrl("https://example.com", resolver, controller.signal),
      /DNS deadline/
    );
  } finally {
    clearTimeout(timer);
  }
});
