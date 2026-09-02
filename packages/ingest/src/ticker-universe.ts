import { SEC_TARGET_TICKERS } from "./sec-targets";

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

export type TickerUniverseId = "seed" | "sp500" | "nasdaq100" | "dowjones";

const UNIVERSE_ENDPOINTS: Record<Exclude<TickerUniverseId, "seed">, string> = {
  sp500: "sp500-constituent",
  nasdaq100: "nasdaq-constituent",
  dowjones: "dowjones-constituent"
};

export type ResolveTargetTickersOptions = {
  /** Explicit override; wins over everything else. */
  explicit?: string[] | null;
  /** Comma-separated universe ids, e.g. "sp500,nasdaq100". Defaults to TARGET_UNIVERSE. */
  universe?: string | null;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  /** Used for tests; the in-process cache otherwise lives for the life of the job. */
  cache?: Map<string, Promise<string[]>>;
};

const processCache = new Map<string, Promise<string[]>>();

export function parseUniverseIds(value: string | null | undefined): TickerUniverseId[] {
  if (!value) return ["seed"];
  const ids = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => (item === "nasdaq-100" || item === "nasdaq" ? "nasdaq100" : item))
    .map((item) => (item === "spx" || item === "s&p500" ? "sp500" : item));
  const valid = ids.filter(
    (item): item is TickerUniverseId =>
      item === "seed" || item === "sp500" || item === "nasdaq100" || item === "dowjones"
  );
  return valid.length > 0 ? [...new Set(valid)] : ["seed"];
}

/**
 * Resolves the issuer universe for SEC filings and transcripts.
 *
 * Priority: explicit list → SEC_TARGET_TICKERS env → TARGET_UNIVERSE constituents fetched
 * from FMP (cached per process) → checked-in seed list. Any fetch failure falls back to
 * the seed list with a warning rather than failing the job, so a data-vendor outage
 * degrades coverage instead of stopping ingestion.
 */
export async function resolveTargetTickers(
  options: ResolveTargetTickersOptions = {}
): Promise<string[]> {
  if (options.explicit && options.explicit.length > 0) return normalize(options.explicit);
  const envOverride = parseTickers(process.env.SEC_TARGET_TICKERS);
  if (envOverride && envOverride.length > 0) return envOverride;
  const universes = parseUniverseIds(options.universe ?? process.env.TARGET_UNIVERSE);
  if (universes.every((id) => id === "seed")) return [...SEC_TARGET_TICKERS];
  const apiKey = options.apiKey ?? process.env.FMP_API_KEY;
  if (!apiKey) {
    console.warn(
      `[ticker-universe] TARGET_UNIVERSE=${universes.join(",")} requires FMP_API_KEY; using the seed list.`
    );
    return [...SEC_TARGET_TICKERS];
  }
  const cache = options.cache ?? processCache;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tickers = new Set<string>();
  for (const universe of universes) {
    if (universe === "seed") {
      for (const ticker of SEC_TARGET_TICKERS) tickers.add(ticker);
      continue;
    }
    const key = `${universe}:${apiKey.slice(-4)}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = fetchConstituents(universe, apiKey, fetchImpl);
      cache.set(key, pending);
    }
    try {
      for (const ticker of await pending) tickers.add(ticker);
    } catch (error) {
      cache.delete(key);
      console.warn(
        `[ticker-universe] ${universe} constituents unavailable (${
          error instanceof Error ? error.message : String(error)
        }); falling back to the seed list for this universe.`
      );
      for (const ticker of SEC_TARGET_TICKERS) tickers.add(ticker);
    }
  }
  return normalize([...tickers]);
}

async function fetchConstituents(
  universe: Exclude<TickerUniverseId, "seed">,
  apiKey: string,
  fetchImpl: typeof fetch
) {
  const url = new URL(`${FMP_BASE_URL}/${UNIVERSE_ENDPOINTS[universe]}`);
  url.searchParams.set("apikey", apiKey);
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`FMP ${universe} constituents returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const tickers = parseConstituents(payload);
  if (tickers.length < 20) {
    throw new Error(`FMP ${universe} constituents returned only ${tickers.length} symbols`);
  }
  return tickers;
}

export function parseConstituents(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return normalize(
    payload
      .map((row) =>
        row && typeof row === "object" && typeof (row as { symbol?: unknown }).symbol === "string"
          ? (row as { symbol: string }).symbol
          : ""
      )
      .filter(Boolean)
  );
}

function normalize(tickers: string[]) {
  return [
    ...new Set(
      tickers
        .map((ticker) => ticker.trim().toUpperCase().replace(".", "-"))
        .filter((ticker) => /^[A-Z][A-Z0-9-]{0,9}$/.test(ticker))
    )
  ].sort();
}

export function parseTickers(value: string | undefined | null) {
  if (!value) return null;
  const tickers = value
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  return tickers.length > 0 ? normalize(tickers) : null;
}
