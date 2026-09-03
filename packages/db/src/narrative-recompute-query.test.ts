import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveCompatibleClassificationPromptVersions } from "./narratives";

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

test("trend observations accept compatible prompt versions but prefer the current one", () => {
  const observationQuery = narratives.slice(
    narratives.indexOf("with latest_observations as (\n         select distinct on (narrative_definition_id, document_id) *\n         from narrative_observations\n         where prompt_version = any($3::text[])"),
    narratives.indexOf("[startDate, asOfDate, observationVersions, promptVersion]")
  );
  assert.ok(observationQuery.length > 0, "recompute query passes the compatible version list");
  assert.match(
    observationQuery,
    /distinct on \(narrative_definition_id, document_id\)[\s\S]*\(prompt_version = \$4\) desc, observed_at desc/
  );
});

test("compatible prompt versions always lead with the current version and dedupe", () => {
  assert.deepEqual(
    resolveCompatibleClassificationPromptVersions("narrative_classification_v7", undefined),
    ["narrative_classification_v7"]
  );
  assert.deepEqual(resolveCompatibleClassificationPromptVersions("v7", ""), ["v7"]);
  assert.deepEqual(
    resolveCompatibleClassificationPromptVersions("v7", " v6 , v7, v5,v6 "),
    ["v7", "v6", "v5"]
  );
});
