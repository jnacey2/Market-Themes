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
