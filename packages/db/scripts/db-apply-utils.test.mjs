import assert from "node:assert/strict";
import test from "node:test";
import {
  collectErrorCodes,
  connectWithRetry,
  connectionHost,
  isTransientNetworkError,
  isUnresolvedHostError,
  parseApplySchemaArgs,
  resolveDatabaseUrls,
  shouldUseSsl
} from "./db-apply-utils.mjs";

test("classifies Render pre-deploy DNS failures as unresolved and retryable", () => {
  const error = Object.assign(new Error("getaddrinfo ENOTFOUND dpg-d7tpo5km0tmc73d1qfe0-a"), {
    code: "ENOTFOUND"
  });

  assert.equal(isUnresolvedHostError(error), true);
  assert.equal(isTransientNetworkError(error), true);
  assert.deepEqual(collectErrorCodes(error), ["ENOTFOUND"]);
});

test("follows nested getaddrinfo causes", () => {
  const error = new Error("connect failed");
  error.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN dpg-example-a"), {
    code: "EAI_AGAIN"
  });

  assert.equal(isUnresolvedHostError(error), true);
  assert.equal(isTransientNetworkError(error), true);
});

test("does not treat SQL errors as DNS failures", () => {
  const error = Object.assign(new Error("relation schema_migrations does not exist"), {
    code: "42P01"
  });

  assert.equal(isUnresolvedHostError(error), false);
  assert.equal(isTransientNetworkError(error), false);
});

test("uses SSL only for public Render hosts or explicit sslmode", () => {
  assert.equal(
    shouldUseSsl("postgres://user:pass@dpg-d7tpo5km0tmc73d1qfe0-a/market_themes"),
    false
  );
  assert.equal(
    shouldUseSsl(
      "postgres://user:pass@dpg-d7tpo5km0tmc73d1qfe0-a.oregon-postgres.render.com/market_themes"
    ),
    true
  );
  assert.equal(
    shouldUseSsl("postgres://user:pass@localhost:5432/market_themes?sslmode=require"),
    true
  );
});

test("connectionHost never includes credentials", () => {
  assert.equal(
    connectionHost("postgres://user:super-secret@dpg-d7tpo5km0tmc73d1qfe0-a:5432/market_themes"),
    "dpg-d7tpo5km0tmc73d1qfe0-a"
  );
});

test("resolveDatabaseUrls prefers unique DATABASE_URL then optional external fallback", () => {
  assert.deepEqual(
    resolveDatabaseUrls({
      DATABASE_URL: "postgres://internal/db",
      DATABASE_URL_EXTERNAL: "postgres://external/db"
    }),
    ["postgres://internal/db", "postgres://external/db"]
  );
  assert.deepEqual(
    resolveDatabaseUrls({
      DATABASE_URL: "postgres://same/db",
      DATABASE_URL_EXTERNAL: "postgres://same/db"
    }),
    ["postgres://same/db"]
  );
  assert.deepEqual(resolveDatabaseUrls({}), []);
});

test("pre-deploy flag is opt-in", () => {
  assert.deepEqual(parseApplySchemaArgs([]), { allowUnresolvedHost: false });
  assert.deepEqual(parseApplySchemaArgs(["--allow-unresolved-host"]), {
    allowUnresolvedHost: true
  });
});

test("connectWithRetry recreates the client after transient DNS failures", async () => {
  const ended = [];
  let connectCalls = 0;

  const client = await connectWithRetry({
    connectionString: "postgres://user:secret@dpg-example-a/db",
    maxAttempts: 3,
    initialDelayMs: 1,
    sleep: async () => undefined,
    createClient() {
      return {
        async connect() {
          connectCalls += 1;
          if (connectCalls < 3) {
            throw Object.assign(new Error("getaddrinfo ENOTFOUND dpg-example-a"), {
              code: "ENOTFOUND"
            });
          }
        },
        async end() {
          ended.push("end");
        }
      };
    }
  });

  assert.equal(connectCalls, 3);
  assert.deepEqual(ended, ["end", "end"]);
  await client.end();
});

test("connectWithRetry does not retry SQL failures", async () => {
  let connectCalls = 0;

  await assert.rejects(
    () =>
      connectWithRetry({
        connectionString: "postgres://user:secret@localhost/db",
        maxAttempts: 4,
        createClient() {
          return {
            async connect() {
              connectCalls += 1;
              throw Object.assign(new Error("password authentication failed"), {
                code: "28P01"
              });
            },
            async end() {
              return undefined;
            }
          };
        }
      }),
    /password authentication failed/
  );

  assert.equal(connectCalls, 1);
});
