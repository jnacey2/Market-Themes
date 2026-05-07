import Link from "next/link";
import { getAnalysisStatus } from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const status = await getAnalysisStatus();

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/ingestion">Ingestion</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Claude Analysis</p>
          <h1>Review extracted market signals.</h1>
          <p className="lede">
            Inspect Claude&apos;s evidence-backed signals before they power theme
            trends or storyboards. Full source text stays out of the UI; this
            page shows snippets, scores, provenance, and failed runs.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Database</p>
          <h2>{status.databaseConfigured ? "Connected" : "Not configured"}</h2>
          <p>
            {status.databaseConfigured
              ? "The app can query Claude extraction results."
              : "Set DATABASE_URL and apply the schema to inspect analysis results."}
          </p>
        </div>
      </section>

      <section className="grid three">
        <Metric label="Signals" value={status.signalCount} />
        <Metric label="Themes" value={status.themeCount} />
        <Metric label="Failed runs" value={status.failedRuns} />
      </section>

      <section className="section">
        <p className="eyebrow">Recent Signals</p>
        <div className="grid">
          {status.recentSignals.length === 0 ? (
            <div className="panel">
              <h2>No Claude signals yet</h2>
              <p>Run npm run claude:extract:smoke after applying the schema.</p>
            </div>
          ) : (
            status.recentSignals.map((signal) => (
              <article className="storyboard-card" key={signal.id}>
                <div>
                  <div className="pill-row">
                    <span className="pill">{signal.stance}</span>
                    <span className="pill">{signal.sourceClass}</span>
                    <span className="pill">{formatDate(signal.publishedAt)}</span>
                  </div>
                  <h2>{signal.themeLabel}</h2>
                  <p>{signal.interpretation}</p>
                  <div className="evidence-card">
                    <p>{signal.evidenceSnippet}</p>
                  </div>
                  <p>
                    <strong>{signal.documentTitle}</strong> · {signal.publisher}
                  </p>
                  {signal.affectedEntities.length > 0 ? (
                    <div className="pill-row">
                      {signal.affectedEntities.slice(0, 8).map((entity) => (
                        <span className="pill" key={entity}>
                          {entity}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="score-stack">
                  <Score label="Risk" value={signal.riskTone} />
                  <Score label="Bullish" value={signal.bullishTone} />
                  <Score label="Confidence" value={signal.confidence} />
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Recent Runs</p>
        <div className="grid">
          {status.recentRuns.length === 0 ? (
            <div className="panel">
              <p>No Claude analysis runs have been recorded yet.</p>
            </div>
          ) : (
            status.recentRuns.map((run) => (
              <div className="panel" key={run.id}>
                <div className="pill-row">
                  <span className="pill">{run.status}</span>
                  <span className="pill">attempts {run.attemptCount}</span>
                  <span className="pill">{run.model}</span>
                </div>
                <h2>{run.documentTitle}</h2>
                <p>
                  {run.promptVersion} · updated {formatDate(run.updatedAt)}
                </p>
                {run.errorMessage ? <p>{run.errorMessage}</p> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel">
      <span className="label">{label}</span>
      <h2>{value}</h2>
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="score">
      <span className="label">{label}</span>
      <strong>{Math.round(value)}</strong>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) {
    return "None yet";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
