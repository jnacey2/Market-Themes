import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  let ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 6) ip = new URL(`https://[${ip}]`).hostname.slice(1, -1);
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Allow only global unicast, excluding special-purpose/documentation prefixes.
  // This also rejects mapped IPv4, loopback, ULA, link-local, multicast and NAT64.
  return (
    isIP(ip) === 6 &&
    /^[23][0-9a-f]{3}:/.test(ip) &&
    !/^2001:(?:0{0,3}[01][0-9a-f]{0,2}|db8):/.test(ip) &&
    !ip.startsWith("2002:") &&
    !ip.startsWith("3fff:")
  );
}

export function publicHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid publication URL is required.");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      "Publication URLs must use HTTPS on port 443 without credentials."
    );
  }
  if (
    host === "localhost" ||
    /\.(localhost|local|internal)$/.test(host) ||
    (isIP(host) && !isPublicAddress(host))
  ) {
    throw new Error("Publication URL must not target a private network.");
  }
  url.hash = "";
  return url;
}

export async function resolvePublicUrl(
  value: string,
  resolver = lookup,
  signal = AbortSignal.timeout(20_000)
) {
  const url = publicHttpsUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await abortable(resolver(host, { all: true }), signal);
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicAddress(entry.address))
  ) {
    throw new Error(
      "Publication URL resolved to a private or unavailable network."
    );
  }
  return { url, addresses };
}

/** HTTPS GET with DNS pinned to a validated address, verified TLS, bounded body,
 * and a fresh validation on every redirect. No cookies or authentication headers.
 */
export async function publicFetch(
  input: string | URL | Request,
  init: RequestInit = {}
): Promise<Response> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(20_000),
    ...(init.signal ? [init.signal] : [])
  ]);
  let destination =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (init.method && init.method !== "GET")
    throw new Error("Public feed fetching only supports GET.");
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    signal.throwIfAborted();
    const { url, addresses } = await resolvePublicUrl(
      destination,
      lookup,
      signal
    );
    signal.throwIfAborted();
    const response = await new Promise<Response>((resolve, reject) => {
      const pinned = addresses[0];
      const headers = new Headers(init.headers);
      const req = request(
        url,
        {
          agent: false,
          signal,
          headers: {
            Accept: headers.get("accept") ?? "*/*",
            "User-Agent": headers.get("user-agent") ?? "MarketThemesBot/0.1"
          },
          lookup: (_host, options, callback) => {
            if (typeof options === "object" && options.all)
              callback(null, [pinned]);
            else callback(null, pinned.address, pinned.family);
          }
        },
        (res) => {
          const status = res.statusCode ?? 502;
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined)
              responseHeaders.set(
                key,
                Array.isArray(value) ? value.join(", ") : value
              );
          }
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.resume();
            resolve(new Response(null, { status, headers: responseHeaders }));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 4 * 1024 * 1024)
              req.destroy(new Error("Feed response exceeds 4 MiB."));
            else chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve(
              new Response(
                [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
                { status, headers: responseHeaders }
              )
            )
          );
        }
      );
      req.on("error", reject);
      req.end();
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirect === 3)
      throw new Error("Feed redirect limit exceeded or destination missing.");
    destination = new URL(location, url).href;
  }
  throw new Error("Feed redirect limit exceeded.");
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}
