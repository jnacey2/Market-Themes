import assert from "node:assert/strict";
import test from "node:test";
import {
  isAuthorized,
  isSafeMutationRequest,
  publicErrorMessage,
  rejectUnsafeMutation
} from "./ops-auth";

test("rejectUnsafeMutation returns a 403 only for unsafe requests", async () => {
  const safe = new Request("https://themes.example/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://themes.example" }
  });
  assert.equal(rejectUnsafeMutation(safe), null);

  const unsafe = new Request("https://themes.example/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" }
  });
  const response = rejectUnsafeMutation(unsafe);
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Cross-origin/);
});

test("publicErrorMessage hides infrastructure details but keeps validation text", () => {
  assert.equal(
    publicErrorMessage(new Error("connect ECONNREFUSED 10.0.0.5:5432")),
    "Request failed."
  );
  assert.equal(
    publicErrorMessage(new Error("password authentication failed for user"), "Nope."),
    "Nope."
  );
  assert.equal(
    publicErrorMessage(new Error("A retraction reason is required.")),
    "A retraction reason is required."
  );
  assert.equal(publicErrorMessage(new Error("")), "Request failed.");
  assert.ok(publicErrorMessage(new Error("x".repeat(500))).length <= 300);
});

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
      new Request("http://0.0.0.0:3100/api/review", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3100",
          origin: "http://127.0.0.1:3100"
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
