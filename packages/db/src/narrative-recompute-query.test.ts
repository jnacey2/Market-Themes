import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  observationVersionSql,
  resolveCompatibleClassificationPromptVersions
} from "./narratives";

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

test("observation version SQL stays index-ordered for a single version", () => {
  const single = observationVersionSql(["v7"], "$3", "$4");
  assert.equal(single.order, "observed_at desc, prompt_version desc");
  assert.match(single.predicate, /prompt_version = \$4/);
  assert.match(single.predicate, /any\(\$3::text\[\]\)/, "array parameter stays referenced");

  const multi = observationVersionSql(["v7", "v6"], "$3", "$4");
  assert.match(multi.predicate, /^prompt_version = any\(\$3::text\[\]\)$/);
  assert.match(multi.order, /^\(prompt_version = \$4\) desc, observed_at desc/);

  const recompute = narratives.slice(
    narratives.indexOf("const recomputeVersionSql = observationVersionSql"),
    narratives.indexOf("[startDate, asOfDate, observationVersions, promptVersion]")
  );
  assert.match(recompute, /\$\{recomputeVersionSql\.predicate\}/);
  assert.match(recompute, /order by narrative_definition_id, document_id, \$\{recomputeVersionSql\.order\}/);
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

test("board evidence filters approved rows first when a single prompt version is in use", () => {
  const board = narratives.slice(
    narratives.indexOf("const latestObservationsCte ="),
    narratives.indexOf("evidence_with_story as (", narratives.indexOf("const latestObservationsCte ="))
  );
  assert.match(board, /evidenceVersions\.length === 1/);
  assert.match(board, /and matched\s+and review_status = 'approved'/, "fast path filters on the partial review-queue index");
  assert.match(board, /select distinct on \(narrative_definition_id, document_id\) \*/, "multi-version path still resolves the latest row first");
});
