import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  isNavigationItemActive,
  NAVIGATION_GROUPS,
  PROTECTED_PATHS
} from "./navigation";

const items = NAVIGATION_GROUPS.flatMap((group) => group.items);

test("global navigation exposes every top-level destination exactly once", () => {
  const hrefs = items.map((item) => item.href);
  assert.deepEqual(hrefs, [
    "/",
    "/trends",
    "/changes",
    "/narrative-candidates",
    "/narrative-review",
    "/sources",
    "/analysis",
    "/theme-mappings",
    "/ingestion"
  ]);
  assert.equal(new Set(hrefs).size, hrefs.length);
});

test("dynamic narrative pages keep Narrative Currents active", () => {
  const currents = items.find((item) => item.href === "/trends");
  assert(currents);
  assert.equal(isNavigationItemActive("/trends", currents), true);
  assert.equal(isNavigationItemActive("/themes/narrative-id", currents), true);
  assert.equal(isNavigationItemActive("/storyboards/narrative-id", currents), true);
  assert.equal(isNavigationItemActive("/ingestion", currents), false);
});

test("every operations navigation destination is protected", () => {
  for (const item of items.filter((entry) => entry.protected)) {
    assert.equal(PROTECTED_PATHS.includes(item.href), true, item.href);
  }
  assert.equal(PROTECTED_PATHS.includes("/api/backfill"), true);
  assert.equal(PROTECTED_PATHS.includes("/api/narrative-candidates"), true);
});

test("every protected path is present in the statically analyzed proxy matcher", () => {
  const proxySource = readFileSync(
    fileURLToPath(new URL("../proxy.ts", import.meta.url)),
    "utf8"
  );
  for (const path of PROTECTED_PATHS) {
    assert.equal(
      proxySource.includes(`"${path}/:path*"`),
      true,
      `Proxy matcher is missing ${path}`
    );
  }
});
