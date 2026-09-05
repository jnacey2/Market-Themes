import { NextResponse, type NextRequest } from "next/server";
import { authNotConfiguredHtml, authRequiredHtml } from "./lib/auth-wall";
import { PROTECTED_PATHS } from "./lib/navigation";
import { isAuthorized } from "./lib/ops-auth";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

export function proxy(request: NextRequest) {
  if (!PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const username = process.env.OPS_USERNAME;
  const password = process.env.OPS_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }

    return new NextResponse(
      wantsHtml(request) ? authNotConfiguredHtml() : "Operational authentication is not configured.",
      { status: 503, headers: wantsHtml(request) ? HTML_HEADERS : undefined }
    );
  }

  if (isAuthorized(request.headers.get("authorization"), username, password)) {
    return NextResponse.next();
  }

  return new NextResponse(
    wantsHtml(request) ? authRequiredHtml(request.nextUrl.pathname) : "Authentication required.",
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Market Themes Operations"',
        ...(wantsHtml(request) ? HTML_HEADERS : {})
      }
    }
  );
}

/** Browsers navigating to a page get the styled wall; API clients keep the plain text. */
function wantsHtml(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) return false;
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

export const config = {
  matcher: [
    "/analysis/:path*",
    "/ingestion/:path*",
    "/theme-mappings/:path*",
    "/narrative-review/:path*",
    "/narrative-candidates/:path*",
    "/sources/:path*",
    "/api/narrative-definitions/:path*",
    "/api/narrative-candidates/:path*",
    "/api/narrative-observations/:path*",
    "/api/publication-feeds/:path*",
    "/api/backfill/:path*"
  ]
};
