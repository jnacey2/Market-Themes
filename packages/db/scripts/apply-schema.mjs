import { readFileSync } from "node:fs";
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

const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined
});

try {
  await client.connect();
  await client.query(schema);
  console.log("Database schema applied successfully.");
} finally {
  await client.end();
}
