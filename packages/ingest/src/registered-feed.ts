import type { PublicationFeed } from "@market-themes/db";
import type { SourceConnector } from "./connectors";
import {
  assertPublicNetworkUrl,
  publicationLookbackHours
} from "./publication-feed";
import { createRssConnector } from "./rss";
import { createSubstackConnector } from "./substack";

export function createPublicationFeedConnector(feed: PublicationFeed): SourceConnector {
  if (feed.platform === "substack") {
    return createSubstackConnector(feed);
  }

  const rss = createRssConnector({
    id: feed.id,
    name: feed.name,
    url: feed.feedUrl,
    sourceClass: "newspaper",
    publisherOwner: feed.publisherOwner,
    retentionPolicy: feed.retentionPolicy,
    lookbackHours: publicationLookbackHours(feed),
    termsNotes: feed.termsNotes
  });

  return {
    ...rss,
    async poll() {
      await assertPublicNetworkUrl(feed.feedUrl);
      return rss.poll();
    }
  };
}
