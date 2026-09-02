import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseSsl } from "./persistence";

const RENDER = "postgres://u:p@dpg-abc.oregon-postgres.render.com/db";
const LOCAL = "postgres://postgres:postgres@localhost:5432/db";

test("keeps the historical host defaults when no mode is configured", () => {
  assert.deepEqual(resolveDatabaseSsl(RENDER, {}), { rejectUnauthorized: false });
  assert.equal(resolveDatabaseSsl(LOCAL, {}), undefined);
});

test("honours an explicit DB_SSL_MODE", () => {
  assert.equal(resolveDatabaseSsl(RENDER, { DB_SSL_MODE: "disable" }), undefined);
  assert.deepEqual(resolveDatabaseSsl(LOCAL, { DB_SSL_MODE: "no-verify" }), {
    rejectUnauthorized: false
  });
  assert.deepEqual(resolveDatabaseSsl(RENDER, { DB_SSL_MODE: "verify-full" }), {
    rejectUnauthorized: true
  });
});

test("attaches an inline CA bundle for verified connections", () => {
  const ca = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
  assert.deepEqual(
    resolveDatabaseSsl(RENDER, { DB_SSL_MODE: "verify-full", DB_SSL_CA: ca }),
    { rejectUnauthorized: true, ca }
  );
  assert.deepEqual(
    resolveDatabaseSsl(`${LOCAL}?sslmode=verify-full`, { DB_SSL_CA: ca }),
    { rejectUnauthorized: true, ca }
  );
});

test("falls back to the host default on an unknown mode", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => void warnings.push(message);
  try {
    assert.deepEqual(resolveDatabaseSsl(RENDER, { DB_SSL_MODE: "sometimes" }), {
      rejectUnauthorized: false
    });
  } finally {
    console.warn = original;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unknown DB_SSL_MODE/);
});
