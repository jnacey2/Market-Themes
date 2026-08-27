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
  await client.query(schema);
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
    await client.query("begin");

    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log(`Applied migration ${name}.`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }

  console.log("Database schema and migrations applied successfully.");
} finally {
  await client.end();
}
