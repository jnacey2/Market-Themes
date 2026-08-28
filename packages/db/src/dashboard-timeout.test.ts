import assert from "node:assert/strict";
import test from "node:test";
import {
  closeDatabaseClient,
  DASHBOARD_QUERY_TIMEOUT_MS,
  getLiveDashboardStatus
} from "./persistence";
import { getOperationsStatus, listConnectorCheckpoints } from "./operations";

test("closing a timed-out client does not throw", async () => {
  await closeDatabaseClient({
    async end() {
      throw new Error("Query read timeout");
    }
  });
});

test("dashboard ranking queries fail faster than generic DB reads", () => {
  assert.ok(DASHBOARD_QUERY_TIMEOUT_MS <= 5_000);
  assert.ok(DASHBOARD_QUERY_TIMEOUT_MS < 20_000);
});

test("dashboard and ops reads stay empty without DATABASE_URL", async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const dashboard = await getLiveDashboardStatus();
    assert.equal(dashboard.databaseConfigured, false);
    assert.equal(dashboard.degraded, false);
    assert.deepEqual(dashboard.confirmedSevenDayThemes, []);
    assert.deepEqual(await listConnectorCheckpoints(), []);
    assert.equal((await getOperationsStatus()).databaseConfigured, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
