import { pathToFileURL } from "node:url";
import { createPublicationFeed, findPublicationFeedByFeedUrl } from "@market-themes/db";
import { NEWSPAPER_FEED_PRESETS, newspaperPresetToFeedInput } from "@market-themes/ingest";

// Run explicitly once per environment. Existing feeds, including disabled ones,
// retain the operator's settings. Polling uses the normal registered-feed path.
export const BROADER_NEWS_PRESET_IDS = [
  "utility-dive", "banking-dive", "supply-chain-dive", "healthcare-dive",
  "freightwaves", "semiconductor-engineering", "the-register"
];

export async function broadenSources() {
  for (const id of BROADER_NEWS_PRESET_IDS) {
    const preset = NEWSPAPER_FEED_PRESETS.find(feed => feed.id === id);
    if (!preset) throw new Error(`Unknown newspaper preset: ${id}`);
    if (await findPublicationFeedByFeedUrl(preset.url)) {
      console.log(`[broaden-sources] already registered: ${preset.name}`);
      continue;
    }
    await createPublicationFeed({ ...newspaperPresetToFeedInput(preset), maxPostsPerPoll: 20 });
    console.log(`[broaden-sources] registered: ${preset.name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await broadenSources();
}
