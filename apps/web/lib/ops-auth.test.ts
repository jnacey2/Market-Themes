import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorized } from "./ops-auth";

test("accepts matching basic credentials", () => {
  const authorization = `Basic ${btoa("operator:correct horse battery staple")}`;
  assert.equal(isAuthorized(authorization, "operator", "correct horse battery staple"), true);
});

test("rejects absent, malformed, and incorrect credentials", () => {
  assert.equal(isAuthorized(null, "operator", "secret"), false);
  assert.equal(isAuthorized("Bearer secret", "operator", "secret"), false);
  assert.equal(isAuthorized(`Basic ${btoa("operator:wrong")}`, "operator", "secret"), false);
});
