import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorized, isSafeMutationRequest } from "./ops-auth";

test("accepts matching basic credentials", () => {
  const authorization = `Basic ${btoa("operator:correct horse battery staple")}`;
  assert.equal(isAuthorized(authorization, "operator", "correct horse battery staple"), true);
});

test("rejects absent, malformed, and incorrect credentials", () => {
  assert.equal(isAuthorized(null, "operator", "secret"), false);
  assert.equal(isAuthorized("Bearer secret", "operator", "secret"), false);
  assert.equal(isAuthorized(`Basic ${btoa("operator:wrong")}`, "operator", "secret"), false);
});

test("accepts same-origin JSON mutations and rejects cross-site requests", () => {
  assert.equal(
    isSafeMutationRequest(
      new Request("https://themes.example/api/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://themes.example"
        }
      })
    ),
    true
  );
  assert.equal(
    isSafeMutationRequest(
      new Request("https://themes.example/api/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      })
    ),
    false
  );
  assert.equal(
    isSafeMutationRequest(
      new Request("https://themes.example/api/review", {
        method: "POST",
        headers: { "content-type": "text/plain" }
      })
    ),
    false
  );
});
