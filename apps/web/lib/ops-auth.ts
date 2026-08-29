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
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
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
