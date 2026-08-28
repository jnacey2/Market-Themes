const TRANSIENT_NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE"
]);

const UNRESOLVED_HOST_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

export function collectErrorCodes(error) {
  const codes = [];
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current.code === "string" && current.code) {
      codes.push(current.code);
    }
    current = current.cause;
  }
  return codes;
}

export function errorText(error) {
  if (!error) {
    return "";
  }
  return [error.message, error.cause?.message].filter(Boolean).join(" ");
}

export function isTransientNetworkError(error) {
  if (collectErrorCodes(error).some((code) => TRANSIENT_NETWORK_CODES.has(code))) {
    return true;
  }
  return /getaddrinfo|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(
    errorText(error)
  );
}

export function isUnresolvedHostError(error) {
  if (collectErrorCodes(error).some((code) => UNRESOLVED_HOST_CODES.has(code))) {
    return true;
  }
  return /getaddrinfo\s+ENOTFOUND|getaddrinfo\s+EAI_AGAIN/i.test(errorText(error));
}

export function shouldUseSsl(databaseUrl) {
  if (!databaseUrl) {
    return false;
  }
  return (
    databaseUrl.includes("render.com") ||
    /[?&]sslmode=(require|verify-ca|verify-full)/i.test(databaseUrl)
  );
}

export function connectionHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname || "(unknown-host)";
  } catch {
    return "(unparseable-url)";
  }
}

export function uniqueConnectionStrings(urls) {
  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    if (typeof url !== "string") {
      continue;
    }
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

export function resolveDatabaseUrls(env = process.env) {
  return uniqueConnectionStrings([env.DATABASE_URL, env.DATABASE_URL_EXTERNAL]);
}

export function parseApplySchemaArgs(argv = process.argv.slice(2)) {
  return {
    allowUnresolvedHost: argv.includes("--allow-unresolved-host")
  };
}

export async function connectWithRetry({
  connectionString,
  createClient,
  maxAttempts = 5,
  initialDelayMs = 1_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onRetry
}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = createClient(connectionString);
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      await client.end?.().catch(() => undefined);
      const retryable = isTransientNetworkError(error) && attempt < maxAttempts;
      if (!retryable) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      onRetry?.({
        attempt,
        maxAttempts,
        delayMs,
        error,
        host: connectionHost(connectionString)
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}
