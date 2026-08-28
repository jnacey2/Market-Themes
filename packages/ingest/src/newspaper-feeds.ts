import type { PublicationFeedInput } from "@market-themes/db";
import { resolvePublisherOwner } from "./publisher-owners";

export const NEWSPAPER_FEED_TERMS =
  "Public RSS headline and summary only; snippet retention; no paywall or authentication bypass.";

export type NewspaperFeedGroupId = "nyt" | "wsj" | "wapo" | "bloomberg" | "ft";

export type NewspaperFeedPreset = {
  id: string;
  group: NewspaperFeedGroupId;
  name: string;
  url: string;
  homepageUrl: string;
  publisherOwner: string;
};

export const NEWSPAPER_FEED_GROUPS: Array<{
  id: NewspaperFeedGroupId;
  label: string;
  publisherOwner: string;
}> = [
  { id: "nyt", label: "The New York Times", publisherOwner: "nyt" },
  { id: "wsj", label: "The Wall Street Journal", publisherOwner: "dow-jones" },
  { id: "wapo", label: "The Washington Post", publisherOwner: "washington-post" },
  { id: "bloomberg", label: "Bloomberg", publisherOwner: "bloomberg" },
  { id: "ft", label: "Financial Times", publisherOwner: "financial-times" }
];

export const NEWSPAPER_FEED_PRESETS: NewspaperFeedPreset[] = [
  preset("nyt-home", "nyt", "NYT Home Page", "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", "https://www.nytimes.com/"),
  preset("nyt-business", "nyt", "NYT Business", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "https://www.nytimes.com/"),
  preset("nyt-economy", "nyt", "NYT Economy", "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml", "https://www.nytimes.com/"),
  preset("nyt-dealbook", "nyt", "NYT DealBook", "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml", "https://www.nytimes.com/"),
  preset("nyt-technology", "nyt", "NYT Technology", "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "https://www.nytimes.com/"),
  preset("nyt-world", "nyt", "NYT World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "https://www.nytimes.com/"),
  preset("wsj-markets", "wsj", "WSJ Markets", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "https://www.wsj.com/"),
  preset("wsj-business", "wsj", "WSJ U.S. Business", "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness", "https://www.wsj.com/"),
  preset("wsj-world", "wsj", "WSJ World News", "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", "https://www.wsj.com/"),
  preset(
    "wapo-business",
    "wapo",
    "Washington Post Business",
    "https://feeds.washingtonpost.com/rss/business",
    "https://www.washingtonpost.com/"
  ),
  preset(
    "wapo-national",
    "wapo",
    "Washington Post National",
    "https://feeds.washingtonpost.com/rss/national",
    "https://www.washingtonpost.com/"
  ),
  preset(
    "wapo-world",
    "wapo",
    "Washington Post World",
    "https://feeds.washingtonpost.com/rss/world",
    "https://www.washingtonpost.com/"
  ),
  preset(
    "wapo-politics",
    "wapo",
    "Washington Post Politics",
    "https://feeds.washingtonpost.com/rss/politics",
    "https://www.washingtonpost.com/"
  ),
  preset(
    "bloomberg-markets",
    "bloomberg",
    "Bloomberg Markets",
    "https://feeds.bloomberg.com/markets/news.rss",
    "https://www.bloomberg.com/"
  ),
  preset(
    "bloomberg-economics",
    "bloomberg",
    "Bloomberg Economics",
    "https://feeds.bloomberg.com/economics/news.rss",
    "https://www.bloomberg.com/"
  ),
  preset(
    "bloomberg-politics",
    "bloomberg",
    "Bloomberg Politics",
    "https://feeds.bloomberg.com/politics/news.rss",
    "https://www.bloomberg.com/"
  ),
  preset(
    "bloomberg-technology",
    "bloomberg",
    "Bloomberg Technology",
    "https://feeds.bloomberg.com/technology/news.rss",
    "https://www.bloomberg.com/"
  ),
  preset("ft-markets", "ft", "FT Markets", "https://www.ft.com/markets?format=rss", "https://www.ft.com/"),
  preset(
    "ft-global-economy",
    "ft",
    "FT Global Economy",
    "https://www.ft.com/global-economy?format=rss",
    "https://www.ft.com/"
  ),
  preset("ft-companies", "ft", "FT Companies", "https://www.ft.com/companies?format=rss", "https://www.ft.com/")
];

export function newspaperPresetToFeedInput(preset: NewspaperFeedPreset): PublicationFeedInput & {
  url: string;
} {
  return {
    name: preset.name,
    url: preset.url,
    homepageUrl: preset.homepageUrl,
    feedUrl: preset.url,
    platform: "rss",
    publisherOwner: preset.publisherOwner,
    retentionPolicy: "snippet",
    backfillDays: 7,
    maxPostsPerPoll: 50,
    rateLimitMs: 500,
    tags: ["rss", "newspaper", "preset"],
    termsNotes: NEWSPAPER_FEED_TERMS
  };
}

function preset(
  id: string,
  group: NewspaperFeedGroupId,
  name: string,
  url: string,
  homepageUrl: string
): NewspaperFeedPreset {
  const owner = NEWSPAPER_FEED_GROUPS.find((item) => item.id === group)?.publisherOwner;
  return {
    id,
    group,
    name,
    url,
    homepageUrl,
    publisherOwner: owner ?? resolvePublisherOwner({ url, name, fallback: group })
  };
}
