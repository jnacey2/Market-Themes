export function isAuthorized(
  authorization: string | null,
  expectedUsername: string,
  expectedPassword: string
) {
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");

    if (separator < 0) {
      return false;
    }

    return (
      constantTimeEqual(decoded.slice(0, separator), expectedUsername) &&
      constantTimeEqual(decoded.slice(separator + 1), expectedPassword)
    );
  } catch {
    return false;
  }
}

export function isSafeMutationRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return false;
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return false;
  }
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }
  try {
    const requestUrl = new URL(request.url);
    const expectedOrigins = new Set([requestUrl.origin]);
    const forwardedHost =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host");
    const forwardedProtocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      requestUrl.protocol.replace(":", "");
    if (
      forwardedHost &&
      (forwardedProtocol === "http" || forwardedProtocol === "https")
    ) {
      expectedOrigins.add(`${forwardedProtocol}://${forwardedHost}`);
    }
    return expectedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

/**
 * Standard 403 for mutation routes that fail the same-origin JSON check.
 * Returns null when the request is acceptable so routes can early-return.
 */
export function rejectUnsafeMutation(request: Request): Response | null {
  if (isSafeMutationRequest(request)) {
    return null;
  }
  return Response.json(
    { error: "Cross-origin or non-JSON mutation rejected." },
    { status: 403 }
  );
}

/**
 * Error text safe to return to a browser. Operational details (connection
 * strings, hostnames, SQL) are logged server-side instead of echoed back.
 */
export function publicErrorMessage(error: unknown, fallback = "Request failed.") {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return fallback;
  if (/postgres|pg_|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|password|DATABASE_URL|ssl|tls|certificate|connect/i.test(message)) {
    return fallback;
  }
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}
