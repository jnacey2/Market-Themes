import { createHash } from "node:crypto";
import pg from "pg";
import type {
  IngestionStatus,
  PersistableDocument,
  PersistDocumentsResult,
  SourceClass
} from "./types";

const { Client } = pg;

type DbClient = pg.Client;

const DEFAULT_CHUNK_SIZE = 8_000;
const DEFAULT_CHUNK_OVERLAP = 500;

export function createDatabaseClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  return new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("render.com")
      ? { rejectUnauthorized: false }
      : undefined
  });
}

export async function persistDocuments(
  documents: PersistableDocument[],
  databaseUrl = process.env.DATABASE_URL
): Promise<PersistDocumentsResult> {
  if (documents.length === 0) {
    return {
      insertedDocuments: 0,
      skippedDocuments: 0,
      insertedChunks: 0
    };
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    let insertedDocuments = 0;
    let skippedDocuments = 0;
    let insertedChunks = 0;

    for (const document of documents) {
      await upsertSource(client, document);
      const contentHash = document.contentHash ?? hashContent(document.body);

      const insertResult = await client.query<{ id: string }>(
        `insert into documents (
          id,
          source_id,
          source_class,
          title,
          publisher,
          url,
          published_at,
          tickers,
          summary,
          retrieval_method,
          metadata,
          content_hash
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (content_hash) do nothing
        returning id`,
        [
          document.id,
          document.sourceId,
          document.sourceClass,
          document.title,
          document.publisher,
          document.url,
          document.publishedAt,
          document.tickers,
          document.summary,
          document.retrievalMethod,
          JSON.stringify(document.metadata ?? {}),
          contentHash
        ]
      );

      if (insertResult.rowCount === 0) {
        skippedDocuments += 1;
        continue;
      }

      insertedDocuments += 1;
      const chunks = chunkText(document.body);

      for (const [index, content] of chunks.entries()) {
        await client.query(
          `insert into document_chunks (
            id,
            document_id,
            chunk_index,
            content
          ) values ($1, $2, $3, $4)
          on conflict (document_id, chunk_index) do nothing`,
          [`${document.id}:chunk:${index}`, document.id, index, content]
        );
        insertedChunks += 1;
      }
    }

    return {
      insertedDocuments,
      skippedDocuments,
      insertedChunks
    };
  } finally {
    await client.end();
  }
}

export async function getIngestionStatus(
  databaseUrl = process.env.DATABASE_URL
): Promise<IngestionStatus> {
  if (!databaseUrl) {
    return emptyStatus(false);
  }

  const client = createDatabaseClient(databaseUrl);
  await client.connect();

  try {
    const totals = await client.query<{
      total_documents: string;
      sec_documents: string;
      latest_sec_document_at: string | null;
      latest_created_at: string | null;
    }>(
      `select
        count(*)::text as total_documents,
        count(*) filter (where source_id = 'sec-filings')::text as sec_documents,
        max(published_at) filter (where source_id = 'sec-filings')::text as latest_sec_document_at,
        max(created_at)::text as latest_created_at
      from documents`
    );

    const sourceCounts = await client.query<{
      source_class: SourceClass;
      count: string;
    }>(
      `select source_class, count(*)::text as count
       from documents
       group by source_class
       order by source_class`
    );

    const row = totals.rows[0];

    return {
      databaseConfigured: true,
      totalDocuments: Number(row?.total_documents ?? 0),
      secDocuments: Number(row?.sec_documents ?? 0),
      latestSecDocumentAt: row?.latest_sec_document_at ?? null,
      latestCreatedAt: row?.latest_created_at ?? null,
      sourceCounts: sourceCounts.rows.map((countRow) => ({
        sourceClass: countRow.source_class,
        count: Number(countRow.count)
      }))
    };
  } catch {
    return emptyStatus(true);
  } finally {
    await client.end();
  }
}

export function hashContent(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function emptyStatus(databaseConfigured: boolean): IngestionStatus {
  return {
    databaseConfigured,
    totalDocuments: 0,
    secDocuments: 0,
    latestSecDocumentAt: null,
    latestCreatedAt: null,
    sourceCounts: []
  };
}

async function upsertSource(client: DbClient, document: PersistableDocument) {
  await client.query(
    `insert into sources (
      id,
      name,
      source_class,
      access_method,
      terms_notes,
      enabled
    ) values ($1, $2, $3, $4, $5, true)
    on conflict (id) do update set
      name = excluded.name,
      source_class = excluded.source_class,
      access_method = excluded.access_method,
      terms_notes = excluded.terms_notes,
      enabled = true`,
    [
      document.sourceId,
      sourceName(document.sourceId),
      document.sourceClass,
      document.retrievalMethod,
      document.sourceId === "sec-filings"
        ? "Official SEC endpoints and filing document downloads."
        : null
    ]
  );
}

function sourceName(sourceId: string) {
  if (sourceId === "sec-filings") {
    return "SEC Filings";
  }

  return sourceId;
}

function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP
) {
  const normalized = text.replace(/\s+\n/g, "\n").trim();

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const end = Math.min(cursor + chunkSize, normalized.length);
    chunks.push(normalized.slice(cursor, end));

    if (end === normalized.length) {
      break;
    }

    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}
