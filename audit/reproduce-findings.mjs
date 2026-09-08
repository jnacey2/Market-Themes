// The original audit's failing behaviors are now maintained as regression tests.
// Run from the repository root; these files do not use real model APIs or a database.
import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--import", "tsx", "--test",
  "packages/db/src/narrative-metrics.test.ts",
  "packages/analysis/src/narrative-classification.test.ts",
  "packages/ingest/src/substack.test.ts",
  "packages/ingest/src/public-fetch.test.ts",
  "workers/src/jobs/claude-extract-backfill.test.ts"], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
