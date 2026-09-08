import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "./lib/ops-auth";

const PROTECTED_PATHS = [
  "/analysis",
  "/ingestion",
  "/theme-mappings",
  "/narrative-review",
  "/sources",
  "/api/backfill",
  "/api/narrative-observations",
  "/api/publication-feeds"
];

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicResearch = process.env.RESEARCH_PUBLIC_READS === "true";
  if (
    pathname === "/api/health" ||
    (publicResearch &&
      !PROTECTED_PATHS.some((path) => pathname.startsWith(path)))
  ) {
    return NextResponse.next();
  }

  const username = process.env.OPS_USERNAME;
  const password = process.env.OPS_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.next();
    }

    return new NextResponse("Operational authentication is not configured.", {
      status: 503
    });
  }

  if (isAuthorized(request.headers.get("authorization"), username, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Market Themes Operations"' }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
