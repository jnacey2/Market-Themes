import {
  createPublicationFeedConnector,
  defaultConnectors,
  resolveSubstackSession
} from "@market-themes/ingest";
import {
  listPublicationFeeds,
  listSubstackCachedPosts,
  persistDocuments,
  recordConnectorCheckpoint,
  recordPublicationFeedPoll
} from "@market-themes/db";
import { pathToFileURL } from "node:url";

export async function pollSources() {
  let fetched = 0;
  let inserted = 0;
  let failed = 0;
  const publicationFeeds = await listPublicationFeeds({ enabledOnly: true });
  const publicationFeedById = new Map(publicationFeeds.map((feed) => [feed.id, feed]));
  const staticIds = new Set(defaultConnectors.map((connector) => connector.id));
  const substackSession = resolveSubstackSession();
  const refresh = process.env.SUBSTACK_REFRESH === "true";
  const substackFeeds = publicationFeeds.filter((feed) => feed.platform === "substack");
  if (substackFeeds.length > 0 && !substackSession) {
    console.warn(
      "[poll-sources] No valid Substack subscriber session. Paid posts will be stored as previews. Capture one with `npm run substack:capture-session` and set SUBSTACK_STORAGE_STATE_B64."
    );
  } else if (substackSession) {
    console.log(
      `[poll-sources] Substack subscriber session loaded for ${substackFeeds.length} publication(s).`
    );
  }
  const connectors = [
    ...defaultConnectors,
    ...(await Promise.all(
      publicationFeeds
        .filter((feed) => !staticIds.has(feed.id))
        .map(async (feed) =>
          createPublicationFeedConnector(
            feed,
            feed.platform === "substack"
              ? {
                  session: substackSession,
                  cachedPosts: await listSubstackCachedPosts(feed.id),
                  since: feed.lastPublishedAt,
                  refresh,
                  upgradePreviews: Boolean(substackSession)
                }
              : {}
          )
        )
    ))
  ];

  for (const connector of connectors) {
    try {
      const documents = await connector.poll();
      fetched += documents.length;

      if (documents.length === 0) {
        console.log(`[poll-sources] ${connector.id} returned 0 documents`);
        await recordConnectorCheckpoint({ connectorId: connector.id, success: true });
        if (publicationFeedById.has(connector.id)) {
          await recordPublicationFeedPoll(connector.id, { success: true });
        }
        continue;
      }

      const result = await persistDocuments(documents);
      inserted += result.insertedDocuments;
      await recordConnectorCheckpoint({
        connectorId: connector.id,
        success: true,
        documentsFetched: documents.length,
        documentsInserted: result.insertedDocuments,
        lastDocumentAt: newestDocumentDate(documents)
      });
      if (publicationFeedById.has(connector.id)) {
        await recordPublicationFeedPoll(connector.id, {
          success: true,
          lastPublishedAt: newestDocumentDate(documents)
        });
      }
      const full = documents.filter((document) => document.metadata?.content === "full").length;
      const previews = documents.filter((document) => document.metadata?.content === "preview").length;
      console.log(
        `[poll-sources] ${connector.id} fetched=${documents.length} inserted=${result.insertedDocuments} skipped=${result.skippedDocuments} chunks=${result.insertedChunks}${
          publicationFeedById.get(connector.id)?.platform === "substack"
            ? ` full=${full} preview=${previews}`
            : ""
        }`
      );
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[poll-sources] ${connector.id} failed: ${message}`);
      await recordConnectorCheckpoint({
        connectorId: connector.id,
        success: false,
        error: message
      });
      if (publicationFeedById.has(connector.id)) {
        await recordPublicationFeedPoll(connector.id, {
          success: false,
          error: message
        });
      }
    }
  }

  return { fetched, inserted, failed };
}

function newestDocumentDate(documents: Array<{ publishedAt: string }>) {
  return documents.reduce<string | null>(
    (latest, document) =>
      !latest || document.publishedAt > latest ? document.publishedAt : latest,
    null
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await pollSources();
}
