import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../src/schema.sql");
const schema = readFileSync(schemaPath, "utf8");
const migrationsPath = join(__dirname, "../migrations");

const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined
});

try {
  await client.connect();
  await client.query("select pg_advisory_lock(hashtext('market_themes_schema_migrations'))");

  const baseSchema = await client.query(
    "select to_regclass('public.sources') as sources_table"
  );
  if (!baseSchema.rows[0]?.sources_table) {
    console.log("Applying base schema to a new database.");
    await client.query(schema);
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

  console.log("Database schema and migrations applied successfully.");
} finally {
  await client
    .query("select pg_advisory_unlock(hashtext('market_themes_schema_migrations'))")
    .catch(() => undefined);
  await client.end();
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
