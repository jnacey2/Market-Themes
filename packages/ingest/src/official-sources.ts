import { createConfiguredRssConnectors, type RssFeedConfig } from "./rss";

export const DEFAULT_OFFICIAL_FEEDS: RssFeedConfig[] = [
  {
    id: "federal-reserve-press",
    name: "Federal Reserve Board",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    sourceClass: "central_bank",
    publisherOwner: "Federal Reserve System"
  },
  {
    id: "federal-reserve-speeches",
    name: "Federal Reserve Board Speeches",
    url: "https://www.federalreserve.gov/feeds/speeches.xml",
    sourceClass: "central_bank",
    publisherOwner: "Federal Reserve System"
  },
  {
    id: "federal-reserve-testimony",
    name: "Federal Reserve Board Testimony",
    url: "https://www.federalreserve.gov/feeds/testimony.xml",
    sourceClass: "central_bank",
    publisherOwner: "Federal Reserve System"
  },
  {
    id: "bls-latest",
    name: "U.S. Bureau of Labor Statistics",
    url: "https://www.bls.gov/feed/bls_latest.rss",
    sourceClass: "government",
    publisherOwner: "U.S. Department of Labor"
  },
  {
    id: "bea-news",
    name: "U.S. Bureau of Economic Analysis",
    url: "https://apps.bea.gov/rss/rss.xml",
    sourceClass: "government",
    publisherOwner: "U.S. Department of Commerce"
  },
  {
    id: "eia-today-in-energy",
    name: "U.S. Energy Information Administration",
    url: "https://www.eia.gov/rss/todayinenergy.xml",
    sourceClass: "government",
    publisherOwner: "U.S. Department of Energy"
  },
  {
    id: "bank-of-england-news",
    name: "Bank of England News",
    url: "https://www.bankofengland.co.uk/rss/news",
    sourceClass: "central_bank",
    publisherOwner: "Bank of England",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "bank-of-england-speeches",
    name: "Bank of England Speeches",
    url: "https://www.bankofengland.co.uk/rss/speeches",
    sourceClass: "central_bank",
    publisherOwner: "Bank of England",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "bank-of-canada-press",
    name: "Bank of Canada",
    url: "https://www.bankofcanada.ca/feed/?content_type=press-releases",
    sourceClass: "central_bank",
    publisherOwner: "Bank of Canada",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "reserve-bank-australia-media",
    name: "Reserve Bank of Australia",
    url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml",
    sourceClass: "central_bank",
    publisherOwner: "Reserve Bank of Australia",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "census-economic-indicators",
    name: "U.S. Census Bureau Economic Indicators",
    url: "https://www.census.gov/economic-indicators/indicator.xml",
    sourceClass: "government",
    publisherOwner: "U.S. Department of Commerce",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "dol-news",
    name: "U.S. Department of Labor",
    url: "https://www.dol.gov/rss/releases.xml",
    sourceClass: "government",
    publisherOwner: "U.S. Department of Labor",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  },
  {
    id: "sec-press",
    name: "U.S. Securities and Exchange Commission",
    url: "https://www.sec.gov/news/pressreleases.rss",
    sourceClass: "government",
    publisherOwner: "U.S. Securities and Exchange Commission",
    lookbackHours: 336,
    maxPostsPerPoll: 20
  }
];

export function createOfficialSourceConnectors() {
  return createConfiguredRssConnectors(
    process.env.OFFICIAL_FEEDS_JSON,
    process.env.OFFICIAL_FEEDS_ENABLED === "false" ? [] : DEFAULT_OFFICIAL_FEEDS
  );
}

export function createCompanyIrConnectors() {
  return createConfiguredRssConnectors(process.env.IR_FEEDS_JSON);
}
