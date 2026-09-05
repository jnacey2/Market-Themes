import assert from "node:assert/strict";
import test from "node:test";
import { authNotConfiguredHtml, authRequiredHtml } from "./auth-wall";

test("the auth wall is a complete branded document, not bare text", () => {
  const html = authRequiredHtml("/ingestion");
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Market Themes/);
  assert.match(html, /Operator sign-in required/);
  assert.match(html, /<code>\/ingestion<\/code>/);
  assert.match(html, /href="\/trends"/);
  assert.match(html, /HTTP 401/);
});

test("the requested path is escaped before it is echoed", () => {
  const html = authRequiredHtml('/ingestion"><script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("the unconfigured wall names the missing variables", () => {
  const html = authNotConfiguredHtml();
  assert.match(html, /OPS_USERNAME/);
  assert.match(html, /OPS_PASSWORD/);
  assert.match(html, /HTTP 503/);
});
