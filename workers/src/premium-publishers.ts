export type PremiumPublisherId = "wsj" | "nyt" | "wapo" | "ft" | "bloomberg";

export type PremiumPublisherProfile = {
  id: PremiumPublisherId;
  name: string;
  publisherOwner: string;
  loginUrl: string;
  sessionEnvKey: string;
  feedUrls: string[];
  allowedHosts: string[];
  articlePathPatterns: RegExp[];
  bodySelectors: string[];
};

export type EncodedBrowserStorageState = {
  cookies: unknown[];
  origins: unknown[];
};

export const premiumPublisherProfiles: Record<
  PremiumPublisherId,
  PremiumPublisherProfile
> = {
  wsj: {
    id: "wsj",
    name: "The Wall Street Journal",
    publisherOwner: "Dow Jones",
    loginUrl: "https://accounts.wsj.com/login",
    sessionEnvKey: "WSJ_STORAGE_STATE_B64",
    feedUrls: [
      "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
      "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness"
    ],
    allowedHosts: ["wsj.com"],
    articlePathPatterns: [
      /^\/articles\//,
      /^\/(business|finance|economy|markets|tech)\//
    ],
    bodySelectors: [
      "article [data-type='paragraph']",
      "article [data-testid='article-body'] p",
      "article p"
    ]
  },
  nyt: {
    id: "nyt",
    name: "The New York Times",
    publisherOwner: "The New York Times Company",
    loginUrl: "https://myaccount.nytimes.com/auth/login",
    sessionEnvKey: "NYT_STORAGE_STATE_B64",
    feedUrls: [
      "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml"
    ],
    allowedHosts: ["nytimes.com"],
    articlePathPatterns: [/^\/\d{4}\/\d{2}\/\d{2}\//],
    bodySelectors: [
      "section[name='articleBody'] p",
      "[data-testid='article-body'] p",
      "article p"
    ]
  },
  wapo: {
    id: "wapo",
    name: "The Washington Post",
    publisherOwner: "The Washington Post",
    loginUrl: "https://www.washingtonpost.com/subscribe/signin/",
    sessionEnvKey: "WAPO_STORAGE_STATE_B64",
    feedUrls: ["https://feeds.washingtonpost.com/rss/business"],
    allowedHosts: ["washingtonpost.com"],
    articlePathPatterns: [/^\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\//],
    bodySelectors: [
      "[data-qa='article-body'] p",
      ".article-body p",
      ".meteredContent p",
      "[data-testid='article-body'] p",
      "article p"
    ]
  },
  ft: {
    id: "ft",
    name: "Financial Times",
    publisherOwner: "The Financial Times Ltd",
    loginUrl: "https://accounts.ft.com/login",
    sessionEnvKey: "FT_STORAGE_STATE_B64",
    feedUrls: [
      "https://www.ft.com/markets?format=rss",
      "https://www.ft.com/global-economy?format=rss",
      "https://www.ft.com/companies?format=rss"
    ],
    allowedHosts: ["ft.com"],
    articlePathPatterns: [/^\/content\/[0-9a-f-]+$/i],
    bodySelectors: [
      "[data-component='article-body'] p",
      "article.js-article__content-body p",
      ".article__content-body p",
      ".n-content-body p",
      "article p"
    ]
  },
  bloomberg: {
    id: "bloomberg",
    name: "Bloomberg",
    publisherOwner: "Bloomberg L.P.",
    loginUrl: "https://www.bloomberg.com/account/login",
    sessionEnvKey: "BLOOMBERG_STORAGE_STATE_B64",
    feedUrls: [
      "https://feeds.bloomberg.com/markets/news.rss",
      "https://feeds.bloomberg.com/economics/news.rss",
      "https://feeds.bloomberg.com/business/news.rss",
      "https://feeds.bloomberg.com/industries/news.rss"
    ],
    allowedHosts: ["bloomberg.com"],
    articlePathPatterns: [/^\/(news|opinion)\/articles\//],
    bodySelectors: [
      "[itemprop='articleBody'] p",
      "[data-component='body'] p",
      "[data-testid='article-body'] p",
      "article p"
    ]
  }
};

export function parsePremiumPublisherIds(value: string | undefined) {
  if (!value?.trim()) return [];
  const ids = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  for (const id of ids) {
    if (!(id in premiumPublisherProfiles)) {
      throw new Error(
        `Unknown premium publisher "${id}". Expected wsj, nyt, wapo, ft, or bloomberg.`
      );
    }
  }
  return [...new Set(ids)] as PremiumPublisherId[];
}

export function isAllowedPublisherUrl(
  value: string,
  profile: PremiumPublisherProfile
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      profile.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      ) &&
      profile.articlePathPatterns.some((pattern) => pattern.test(url.pathname))
    );
  } catch {
    return false;
  }
}

export function decodeStorageState(encoded: string): EncodedBrowserStorageState {
  try {
    const text = Buffer.from(encoded, "base64").toString("utf8");
    const parsed = JSON.parse(text) as EncodedBrowserStorageState;
    if (!Array.isArray(parsed.cookies) || !Array.isArray(parsed.origins)) {
      throw new Error("missing cookies or origins");
    }
    return parsed;
  } catch {
    throw new Error("Publisher storage state is not valid base64 Playwright JSON.");
  }
}
