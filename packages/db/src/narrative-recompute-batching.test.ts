import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  countNarrativeClassificationBacklog,
  createDatabaseClient,
  getActiveNarrativeDefinitions,
  persistDocuments,
  selectDocumentsForNarrativeClassification,
  recomputeNarrativeTrends
} from "./index";

test(
  "batched recomputation retains version precedence and evidence checks across batch boundaries",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const suffix = randomUUID();
    const sourceId = `batch-recompute:${suffix}`;
    const current = `${sourceId}:current`;
    const legacy = `${sourceId}:legacy`;
    const definition = (await getActiveNarrativeDefinitions())[0];
    assert(definition);
    const quote = "The source reports investment in infrastructure.";
    const priorVersions =
      process.env.NARRATIVE_CLASSIFICATION_COMPATIBLE_PROMPT_VERSIONS;
    const client = createDatabaseClient();
    await client.connect();
    try {
      await persistDocuments(
        Array.from({ length: 252 }, (_, index) => ({
          id: `${sourceId}:${String(index).padStart(3, "0")}`,
          sourceId,
          sourceClass: "manual" as const,
          title: `Batch boundary ${index}`,
          publisher: sourceId,
          publisherOwner: sourceId,
          url: `https://example.com/${sourceId}/${index}`,
          publishedAt: "2026-08-27T12:00:00Z",
          tickers: [],
          summary: "Batch fixture",
          body: `${quote} Unique fixture ${suffix} ${index}`,
          retrievalMethod: "manual",
          retentionPolicy: "full_text" as const
        }))
      );
      await client.query(
        `insert into narrative_observations
      (id,narrative_definition_id,document_id,matched,match_score,stance,risk_tone,bullish_tone,evidence_snippet,model,prompt_version,review_status)
      select 'observation:' || id,$1,id,true,95,'bullish',0,90,$2,'fixture',$3,'approved'
      from documents where source_id=$4`,
        [definition.id, quote, legacy, sourceId]
      );
      await client.query(
        `insert into narrative_observations
      (id,narrative_definition_id,document_id,matched,match_score,stance,risk_tone,bullish_tone,evidence_snippet,model,prompt_version,review_status,observed_at)
      select 'current:' || id,$1,id,false,0,'neutral',0,0,'','fixture',$2,'pending','2026-08-01'
      from documents where id=any($3::text[])`,
        [definition.id, current, [`${sourceId}:000`, `${sourceId}:251`]]
      );
      await client.query(
        `update narrative_observations set evidence_snippet='Absent source quotation' where document_id=$1`,
        [`${sourceId}:001`]
      );
      await client.query(
        `update narrative_observations set review_status='pending' where document_id=$1`,
        [`${sourceId}:002`]
      );
      process.env.NARRATIVE_CLASSIFICATION_COMPATIBLE_PROMPT_VERSIONS = legacy;
      await recomputeNarrativeTrends({
        asOfDate: "2026-08-27",
        lookbackDays: 1,
        windows: ["7d"],
        promptVersion: current
      });
      const result = await client.query(
        `select eligible_documents,matched_documents,attention_matched_documents from narrative_trends where narrative_definition_id=$1 and prompt_version=$2`,
        [definition.id, current]
      );
      assert.deepEqual(result.rows, [
        {
          eligible_documents: 252,
          matched_documents: 248,
          attention_matched_documents: 250
        }
      ]);
    } finally {
      if (priorVersions === undefined)
        delete process.env.NARRATIVE_CLASSIFICATION_COMPATIBLE_PROMPT_VERSIONS;
      else
        process.env.NARRATIVE_CLASSIFICATION_COMPATIBLE_PROMPT_VERSIONS =
          priorVersions;
      await client.query(
        "delete from narrative_trends where prompt_version=$1",
        [current]
      );
      await client.query("delete from documents where source_id=$1", [
        sourceId
      ]);
      await client.query("delete from sources where id=$1", [sourceId]);
      await client.end();
    }
  }
);

test(
  "classification selection preserves retry boundaries, active batches, and promotion seeds",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const sourceId = `eligibility:${randomUUID()}`;
    const model = sourceId;
    const promptVersion = sourceId;
    const client = createDatabaseClient();
    await client.connect();
    const before = await countNarrativeClassificationBacklog({
      model,
      promptVersion,
      maxAttempts: 2
    });
    try {
      await persistDocuments(
        Array.from({ length: 7 }, (_, i) => ({
          id: `${sourceId}:${i}`,
          sourceId,
          sourceClass: "manual" as const,
          title: `Eligibility ${i}`,
          publisher: sourceId,
          url: `https://example.com/${sourceId}/${i}`,
          publishedAt: new Date().toISOString(),
          tickers: [],
          summary: "Eligibility fixture",
          body: `Source ${sourceId} unique document ${i}`,
          retrievalMethod: "manual",
          retentionPolicy: "full_text" as const
        }))
      );
      for (const [name, workload, version, status] of [
        ["current", "narrative_classification", promptVersion, "completed"],
        [
          "other",
          "narrative_classification",
          `${promptVersion}:old`,
          "completed"
        ],
        ["discovery", "narrative_discovery", promptVersion, "completed"],
        ["active", "narrative_classification", promptVersion, "in_progress"]
      ]) {
        await client.query(
          `insert into anthropic_message_batches (id,workload,model,prompt_version,status,request_count) values ($1,$2,$3,$4,$5,2)`,
          [`${sourceId}:${name}`, workload, model, version, status]
        );
      }
      for (const [i, batch, statuses] of [
        [0, "current", ["errored", "errored"]],
        [1, "other", ["errored", "errored"]],
        [2, "discovery", ["errored", "errored"]],
        [3, "current", ["errored", "completed"]],
        [4, "active", ["submitted"]]
      ] as const) {
        for (const [n, status] of statuses.entries()) {
          await client.query(
            `insert into anthropic_message_batch_items (id,batch_id,custom_id,document_id,status) values ($1,$2,$1,$3,$4)`,
            [
              `${sourceId}:item:${i}:${n}`,
              `${sourceId}:${batch}`,
              `${sourceId}:${i}`,
              status
            ]
          );
        }
      }
      await client.query(
        `insert into narrative_observations
      (id,narrative_definition_id,document_id,matched,match_score,stance,model,prompt_version,metadata)
      select $1 || nd.id || d.id,nd.id,d.id,false,0,'neutral',$2,$3,
        case when d.id=$4 then '{"promotionSeed":true}'::jsonb else '{}'::jsonb end
      from narrative_definitions nd cross join documents d
      where nd.status in ('active','probationary') and d.id=any($5::text[])`,
        [
          sourceId,
          model,
          promptVersion,
          `${sourceId}:5`,
          [`${sourceId}:5`, `${sourceId}:6`]
        ]
      );
      const selected = await selectDocumentsForNarrativeClassification({
        model,
        promptVersion,
        limit: 1000,
        maxAttempts: 2
      });
      const backlog = await countNarrativeClassificationBacklog({
        model,
        promptVersion,
        maxAttempts: 2
      });
      assert.equal(backlog.total, before.total + 4);
      const limited = await selectDocumentsForNarrativeClassification({
        model,
        promptVersion,
        limit: 2,
        maxAttempts: 2
      });
      assert.deepEqual(
        limited.map((d) => d.id),
        selected.slice(0, 2).map((d) => d.id)
      );
      assert.deepEqual(
        selected
          .filter((d) => d.sourceId === sourceId)
          .map((d) => d.id)
          .sort(),
        [1, 2, 3, 5].map((i) => `${sourceId}:${i}`)
      );
    } finally {
      await client.query(
        "delete from anthropic_message_batches where model=$1",
        [model]
      );
      await client.query("delete from documents where source_id=$1", [
        sourceId
      ]);
      await client.query("delete from sources where id=$1", [sourceId]);
      await client.end();
    }
  }
);
