export type PublisherOwnerId =
  | "dow-jones"
  | "nyt"
  | "washington-post"
  | "financial-times"
  | "bloomberg"
  | "reuters";

type PublisherOwnerRule = {
  id: PublisherOwnerId;
  domains: string[];
  aliases: string[];
};

const OWNER_RULES: PublisherOwnerRule[] = [
  {
    id: "dow-jones",
    domains: [
      "wsj.com",
      "dowjones.com",
      "dowjones.io",
      "dj.com",
      "marketwatch.com",
      "barrons.com",
      "fnlondon.com"
    ],
    aliases: [
      "wsj",
      "wall street journal",
      "the wall street journal",
      "dow jones",
      "marketwatch",
      "barron's",
      "barrons"
    ]
  },
  {
    id: "nyt",
    domains: ["nytimes.com", "nyt.com"],
    aliases: ["nyt", "nytimes", "new york times", "the new york times", "the new york times company"]
  },
  {
    id: "washington-post",
    domains: ["washingtonpost.com", "wapo.com"],
    aliases: ["wapo", "washington post", "the washington post", "washingtonpost"]
  },
  {
    id: "financial-times",
    domains: ["ft.com"],
    aliases: ["ft", "financial times", "the financial times", "the financial times ltd"]
  },
  {
    id: "bloomberg",
    domains: ["bloomberg.com"],
    aliases: ["bloomberg", "bloomberg l.p.", "bloomberg lp"]
  },
  {
    id: "reuters",
    domains: ["reuters.com"],
    aliases: ["reuters"]
  }
];

export function slugPublisher(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function hostnameFromUrl(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function resolvePublisherOwner(input: {
  url?: string;
  site?: string;
  name?: string;
  fallback?: string;
}): string {
  const hostname = hostnameFromUrl(input.url);
  if (hostname) {
    const fromDomain = OWNER_RULES.find((rule) =>
      rule.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    );
    if (fromDomain) return fromDomain.id;
  }

  const haystack = [input.site, input.name, input.fallback]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.toLowerCase())
    .join(" | ");

  if (haystack) {
    const fromAlias = OWNER_RULES.find((rule) =>
      rule.aliases.some((alias) => {
        const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(alias)}(?:[^a-z0-9]|$)`, "i");
        return pattern.test(haystack);
      })
    );
    if (fromAlias) return fromAlias.id;
  }

  return slugPublisher(input.fallback ?? input.site ?? input.name ?? "unknown");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
