import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Prints the complete schema: the base schema followed by every migration in
// the order apply-schema.mjs runs them, so the output can be piped straight
// into psql to reproduce production.
const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../src/schema.sql");
const migrationsPath = join(__dirname, "../migrations");

const parts = [
  `-- packages/db/src/schema.sql\n${readFileSync(schemaPath, "utf8").trimEnd()}\n`
];

for (const name of readdirSync(migrationsPath)
  .filter((file) => file.endsWith(".sql"))
  .sort()) {
  parts.push(
    `\n-- packages/db/migrations/${name}\n${readFileSync(join(migrationsPath, name), "utf8").trimEnd()}\n`
  );
}

process.stdout.write(parts.join(""));
