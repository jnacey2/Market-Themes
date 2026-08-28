import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import {
  connectWithRetry,
  connectionHost,
  isTransientNetworkError,
  isUnresolvedHostError,
  parseApplySchemaArgs,
  resolveDatabaseUrls,
  shouldUseSsl
} from "./db-apply-utils.mjs";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../src/schema.sql");
const migrationsPath = join(__dirname, "../migrations");

function createApplyClient(connectionString) {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined
  });
}

async function applySchema(connectionString) {
  const client = await connectWithRetry({
    connectionString,
    createClient: createApplyClient,
    onRetry: ({ attempt, maxAttempts, delayMs, host, error }) => {
      console.warn(
        `Could not reach Postgres at ${host} (${error.code ?? error.message}); retrying ${attempt}/${maxAttempts} in ${delayMs}ms.`
      );
    }
  });

  try {
    await client.query(
      "select pg_advisory_lock(hashtext('market_themes_schema_migrations'))"
    );

    const baseSchema = await client.query(
      "select to_regclass('public.sources') as sources_table"
    );
    if (!baseSchema.rows[0]?.sources_table) {
      console.log("Applying base schema to a new database.");
      await client.query(readFileSync(schemaPath, "utf8"));
    } else {
      console.log("Base schema already exists; skipping schema replay.");
    }

    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = await client.query("select name from schema_migrations");
    const appliedNames = new Set(applied.rows.map((row) => row.name));
    const migrations = readdirSync(migrationsPath)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of migrations) {
      if (appliedNames.has(name)) {
        continue;
      }

      const sql = readFileSync(join(migrationsPath, name), "utf8");
      await applyMigration(client, name, sql);
    }

    console.log(
      `Database schema and migrations applied successfully via ${connectionHost(connectionString)}.`
    );
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext('market_themes_schema_migrations'))")
      .catch(() => undefined);
    await client.end();
  }
}

async function applyMigration(client, name, sql, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await client.query("begin");

    try {
      await client.query("set local lock_timeout = '30s'");
      await client.query("set local statement_timeout = '10min'");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`Applied migration ${name}.`);
      return;
    } catch (error) {
      await client.query("rollback");
      const retryable = error?.code === "40P01" || error?.code === "55P03";
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = attempt * 1_000;
      console.warn(
        `Migration ${name} hit a transient database lock; retrying in ${delayMs}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function main({
  env = process.env,
  argv = process.argv.slice(2)
} = {}) {
  const { allowUnresolvedHost } = parseApplySchemaArgs(argv);
  const databaseUrls = resolveDatabaseUrls(env);

  if (databaseUrls.length === 0) {
    console.error("DATABASE_URL is required.");
    process.exitCode = 1;
    return;
  }

  let lastError;
  for (const databaseUrl of databaseUrls) {
    try {
      await applySchema(databaseUrl);
      return;
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error)) {
        throw error;
      }
      console.warn(
        `Schema apply failed via ${connectionHost(databaseUrl)}: ${error.message}`
      );
    }
  }

  if (allowUnresolvedHost && isUnresolvedHostError(lastError)) {
    console.warn(
      "Pre-deploy could not resolve the Postgres hostname (internal Render DNS is often unavailable on the pre-deploy instance). The web start command will apply schema on the private network."
    );
    return;
  }

  throw lastError;
}

const executedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedAsScript) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
