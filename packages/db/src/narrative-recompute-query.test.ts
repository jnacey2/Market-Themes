import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const narratives = readFileSync(
  fileURLToPath(new URL("narratives.ts", import.meta.url)),
  "utf8"
);
const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/019_narrative_recompute_indexes.sql", import.meta.url)
  ),
  "utf8"
);

test("uses an indexed timestamp range without reading corpus document bodies", () => {
  const corpusQuery = narratives.slice(
    narratives.indexOf("const corpus = await client.query"),
    narratives.indexOf("const corpusDocuments =")
  );

  assert.match(corpusQuery, /d\.published_at >= \$1::date/);
  assert.match(
    corpusQuery,
    /d\.published_at < \$2::date \+ interval '1 day'/
  );
  assert.match(corpusQuery, /exists \([\s\S]*from document_texts dt/);
  assert.doesNotMatch(corpusQuery, /published_at::date between/);
  assert.doesNotMatch(corpusQuery, /btrim\(dt\.content\)/);
});

test("adds indexes for corpus dates and prompt-version observation scans", () => {
  assert.match(migration, /documents \(published_at, id\)/);
  assert.match(
    migration,
    /narrative_observations \(\s*prompt_version,\s*narrative_definition_id,\s*document_id/
  );
});
