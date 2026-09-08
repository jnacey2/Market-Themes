import type { PublicationFeedInput } from "@market-themes/db";
import { resolvePublisherOwner } from "./publisher-owners";

export const NEWSPAPER_FEED_TERMS =
  "Public RSS headline and summary only; snippet retention; no paywall or authentication bypass.";

export type NewspaperFeedGroupId =
  | "nyt"
  | "wsj"
  | "wapo"
  | "bloomberg"
  | "ft"
  | "industry-dive"
  | "trade-press";

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
  { id: "ft", label: "Financial Times", publisherOwner: "financial-times" },
  { id: "industry-dive", label: "Industry Dive (sector trade press)", publisherOwner: "industry-dive" },
  { id: "trade-press", label: "Sector trade press", publisherOwner: "" }
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
  preset("ft-companies", "ft", "FT Companies", "https://www.ft.com/companies?format=rss", "https://www.ft.com/"),
  // Sector trade press: early, specific coverage that precedes national business desks.
  preset("utility-dive", "industry-dive", "Utility Dive", "https://www.utilitydive.com/feeds/news/", "https://www.utilitydive.com/"),
  preset("banking-dive", "industry-dive", "Banking Dive", "https://www.bankingdive.com/feeds/news/", "https://www.bankingdive.com/"),
  preset("supply-chain-dive", "industry-dive", "Supply Chain Dive", "https://www.supplychaindive.com/feeds/news/", "https://www.supplychaindive.com/"),
  preset("retail-dive", "industry-dive", "Retail Dive", "https://www.retaildive.com/feeds/news/", "https://www.retaildive.com/"),
  preset("healthcare-dive", "industry-dive", "Healthcare Dive", "https://www.healthcaredive.com/feeds/news/", "https://www.healthcaredive.com/"),
  preset("cfo-dive", "industry-dive", "CFO Dive", "https://www.cfodive.com/feeds/news/", "https://www.cfodive.com/"),
  preset("construction-dive", "industry-dive", "Construction Dive", "https://www.constructiondive.com/feeds/news/", "https://www.constructiondive.com/"),
  preset("payments-dive", "industry-dive", "Payments Dive", "https://www.paymentsdive.com/feeds/news/", "https://www.paymentsdive.com/"),
  preset("freightwaves", "trade-press", "FreightWaves", "https://www.freightwaves.com/news/feed", "https://www.freightwaves.com/"),
  preset("fierce-pharma", "trade-press", "Fierce Pharma", "https://www.fiercepharma.com/rss/xml", "https://www.fiercepharma.com/"),
  preset("fierce-biotech", "trade-press", "Fierce Biotech", "https://www.fiercebiotech.com/rss/xml", "https://www.fiercebiotech.com/"),
  preset("oilprice", "trade-press", "OilPrice.com", "https://oilprice.com/rss/main", "https://oilprice.com/"),
  preset("semiconductor-engineering", "trade-press", "Semiconductor Engineering", "https://semiengineering.com/feed/", "https://semiengineering.com/"),
  preset("the-register", "trade-press", "The Register", "https://www.theregister.com/headlines.atom", "https://www.theregister.com/"),
  preset("american-banker", "trade-press", "American Banker", "https://www.americanbanker.com/feed", "https://www.americanbanker.com/"),
  preset("mining-com", "trade-press", "Mining.com", "https://www.mining.com/feed/", "https://www.mining.com/")
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
  const owner =
    NEWSPAPER_FEED_GROUPS.find((item) => item.id === group)?.publisherOwner || undefined;
  const hostSlug = new URL(homepageUrl).hostname
    .replace(/^www\./, "")
    .split(".")[0]
    .toLowerCase();
  return {
    id,
    group,
    name,
    url,
    homepageUrl,
    publisherOwner: owner ?? resolvePublisherOwner({ url, name, fallback: hostSlug })
  };
}
