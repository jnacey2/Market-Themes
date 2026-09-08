import { getAnalysisStatus } from "@market-themes/db";
import { BackfillControls } from "./BackfillControls";

export const dynamic = "force-dynamic";

export default async function AnalysisPage() {
  const status = await getAnalysisStatus();

  return (
    <div className="shell">
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
              ? status.degraded
                ? "Connected, but one or more status sections timed out."
                : "The app can query Claude extraction results."
              : "Set DATABASE_URL and apply the schema to inspect analysis results."}
          </p>
        </div>
      </section>

      {status.degraded ? (
        <section className="section panel">
          <p className="eyebrow">Partial data</p>
          <h2>Some analysis status queries are temporarily unavailable.</h2>
          <p>
            Existing extraction data has not been erased. Unavailable sections
            show a dash instead of a misleading zero. Retry after intensive
            trend or ingestion jobs finish.
          </p>
          <div className="pill-row">
            {status.unavailableSections.map((section) => (
              <span className="pill warning-pill" key={section}>
                {formatSection(section)}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid three">
        <Metric
          label="Signals"
          value={status.signalCount}
          unavailable={status.unavailableSections.includes("summary")}
        />
        <Metric
          label="Themes"
          value={status.themeCount}
          unavailable={status.unavailableSections.includes("summary")}
        />
        <Metric
          label="Failed runs"
          value={status.failedRuns}
          unavailable={status.unavailableSections.includes("summary")}
        />
      </section>

      <section className="section">
        <p className="eyebrow">Document Coverage</p>
        <div className="grid four">
          <Metric
            label="Ingested docs"
            value={status.ingestedDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
          <Metric
            label="Readable docs"
            value={status.readableDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
          <Metric
            label="Missing full text"
            value={status.missingTextDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
          <Metric
            label="Read by Claude"
            value={status.completedDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
          <Metric
            label="Unread docs left"
            value={status.unreadDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
          <Metric
            label="Currently running"
            value={status.runningDocumentCount}
            unavailable={status.unavailableSections.includes("coverage")}
          />
        </div>
        <p className="lede">
          Ingested docs include SEC and FMP documents in scope. Readable docs have
          stored full text and can be selected by Claude backfill.
        </p>
      </section>

      <section className="section">
        <p className="eyebrow">Backfill Control</p>
        {status.unavailableSections.includes("backfill") ? (
          <div className="panel">
            <h2>Backfill status temporarily unavailable</h2>
            <p>Controls are disabled until the database status can be verified.</p>
          </div>
        ) : (
          <BackfillControls status={status.backfillControl} />
        )}
      </section>

      <section className="section">
        <p className="eyebrow">Recent Signals</p>
        <div className="grid">
          {status.unavailableSections.includes("recentSignals") ? (
            <div className="panel">
              <h2>Recent signals temporarily unavailable</h2>
              <p>The extraction history still exists. Retry this page shortly.</p>
            </div>
          ) : status.recentSignals.length === 0 ? (
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
          {status.unavailableSections.includes("recentRuns") ? (
            <div className="panel">
              <h2>Recent runs temporarily unavailable</h2>
              <p>The run history still exists. Retry this page shortly.</p>
            </div>
          ) : status.recentRuns.length === 0 ? (
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

function Metric({
  label,
  value,
  unavailable = false
}: {
  label: string;
  value: number;
  unavailable?: boolean;
}) {
  return (
    <div className="panel">
      <span className="label">{label}</span>
      <h2>{unavailable ? "—" : value}</h2>
      {unavailable ? <p className="warning-text">Temporarily unavailable</p> : null}
    </div>
  );
}

function formatSection(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
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
