"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Server components that read from Postgres can
 * throw on connection or timeout failures; without this boundary Next.js
 * renders a blank page. Details are logged (server-side via the digest) and
 * the reader gets a retry that re-runs the server component.
 */
export default function RouteError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[web] route render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Temporarily unavailable</p>
          <h1>This page could not be loaded</h1>
          <p className="lede">
            A data read failed while rendering. The rest of the site is unaffected; the
            narrative board and daily brief are stored records, so retrying usually succeeds
            once the database responds.
          </p>
          <div className="button-row">
            <button className="button" onClick={() => reset()} type="button">
              Try again
            </button>
            <a className="button secondary" href="/">
              Back to overview
            </a>
          </div>
          {error.digest ? (
            <p className="error-text">Reference: {error.digest}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
