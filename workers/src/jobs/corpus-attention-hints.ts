import type { CorpusAttentionHint } from "@market-themes/analysis";
import { getAttentionBurstWatchlist } from "@market-themes/db";

/**
 * Uncovered corpus bursts (terms several publishers started covering that no tracked
 * narrative mentions) are passed to the discovery prompt as optional hints. Failures here
 * must never block discovery, so the lookup degrades to "no hints".
 */
export async function loadCorpusAttentionHints(
  label: string,
  limit = 25
): Promise<CorpusAttentionHint[]> {
  try {
    const watchlist = await getAttentionBurstWatchlist({ limit, uncoveredOnly: true });
    return watchlist.bursts.map((burst) => ({
      term: burst.term,
      stories: burst.currentStories,
      publisherOwners: burst.currentOwners,
      novel: burst.novel
    }));
  } catch (error) {
    console.warn(
      `[${label}] attention hints unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}
