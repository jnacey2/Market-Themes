import {
  getIngestionFunnel,
  getIngestionStatus,
  getOperationsStatus,
  type IngestionFunnel
} from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function IngestionPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const windowDays = parseWindow(params.window);
  const [status, operations, funnel] = await Promise.all([
    getIngestionStatus(),
    getOperationsStatus(),
    getIngestionFunnel({ windowDays })
  ]);

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Ingestion Status</p>
          <h1>Ingestion pipelines</h1>
          <p className="lede">
            Monitor whether source ingestion is connected, writing documents,
            and producing chunks for later Claude analysis.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Database</p>
          <h2>{status.databaseConfigured ? "Connected" : "Not configured"}</h2>
          <p>
            {status.databaseConfigured
              ? "The app can query Postgres for ingestion status."
              : "Set DATABASE_URL to enable live ingestion status."}
          </p>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <span className="label">Total documents</span>
          <h2>{status.totalDocuments}</h2>
          <p>All normalized documents currently stored.</p>
        </div>
        <div className="panel">
          <span className="label">SEC documents</span>
          <h2>{status.secDocuments}</h2>
          <p>Documents inserted by the official SEC connector.</p>
        </div>
        <div className="panel">
          <span className="label">Latest SEC filing</span>
          <h2>{formatDate(status.latestSecDocumentAt)}</h2>
          <p>Most recent SEC `published_at` timestamp in Postgres.</p>
        </div>
      </section>

      <section className="section grid two">
        <IngestionCard
          title="SEC filings"
          description="Official SEC submissions and filing document downloads."
          documents={status.secDocuments}
          latest={status.latestSecDocumentAt}
          commands={["npm run sec:smoke", "npm run sec:backfill"]}
          breakdown={status.secCategoryCounts.map((category) => ({
            label: categoryLabel(category.category),
            value: category.count
          }))}
        />
        <IngestionCard
          title="FMP transcripts"
          description="Financial Modeling Prep earnings call transcript ingestion."
          documents={status.fmpTranscriptDocuments}
          latest={status.latestFmpTranscriptAt}
          commands={["npm run fmp:smoke", "npm run fmp:backfill", "npm run fmp:poll"]}
        />
      </section>

      <section className="section">
        <p className="eyebrow">Pipeline Operations</p>
        <div className="grid four">
          <OperationalMetric label="Analyzed" value={`${operations.analyzedDocuments}/${operations.totalDocuments}`} />
          <OperationalMetric label="Extraction backlog" value={String(operations.extractionBacklog)} />
          <OperationalMetric label="Normalization backlog" value={String(operations.normalizationBacklog)} />
          <OperationalMetric label="Classification backlog" value={String(operations.narrativeClassificationBacklog)} />
          <OperationalMetric label="Discovery backlog" value={String(operations.narrativeDiscoveryBacklog)} />
          <OperationalMetric label="Evidence awaiting review" value={String(operations.narrativeReviewPendingCount)} />
          <OperationalMetric label="Candidate narratives" value={`${operations.narrativeCandidateQualifiedCount}/${operations.narrativeCandidatePendingCount} ready`} />
          <OperationalMetric label="Latest trend" value={formatDate(operations.latestNarrativeTrendDate ?? operations.latestTrendDate)} />
        </div>
      </section>

      <FunnelSection funnel={funnel} />

      <section className="section">
        <p className="eyebrow">Source Pipeline Telemetry</p>
        {operations.sourceTelemetry.length === 0 ? (
          <div className="panel">
            <p>No source telemetry has been recorded yet.</p>
          </div>
        ) : (
          <div className="currents-board source-telemetry-board">
            <div className="currents-header" aria-hidden="true">
              <span>Source</span>
              <span>Ingested</span>
              <span>Extract</span>
              <span>Classify</span>
              <span>Discover</span>
              <span>Matches</span>
            </div>
            {operations.sourceTelemetry.map((source) => (
              <div className="current-row" key={source.sourceId}>
                <div className="current-name">
                  <span className="label">
                    {source.sourceClass?.replaceAll("_", " ") ?? "registered source"}
                  </span>
                  <strong>{source.label}</strong>
                  <small>
                    {source.lastIngestError
                      ? `Error: ${source.lastIngestError}`
                      : `Last success ${formatDate(source.lastIngestSuccessAt)}`}
                  </small>
                </div>
                <TelemetryMetric
                  primary={String(source.documentCount)}
                  secondary={`latest ${formatDate(source.latestDocumentAt)}`}
                />
                <TelemetryMetric
                  primary={String(source.extractionBacklog)}
                  secondary={`${source.analyzedDocuments} complete`}
                />
                <TelemetryMetric
                  primary={String(source.narrativeClassificationBacklog)}
                  secondary="documents waiting"
                />
                <TelemetryMetric
                  primary={String(source.narrativeDiscoveryBacklog)}
                  secondary="documents waiting"
                />
                <TelemetryMetric
                  primary={String(source.matchedPending)}
                  secondary={`${source.matchedApproved} approved · ${source.matchedRejected} rejected`}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section grid two">
        <div className="panel">
          <p className="eyebrow">Connector Health</p>
          <div className="grid">
            {operations.connectors.length === 0 ? (
              <p>No connector checkpoints have been recorded yet.</p>
            ) : operations.connectors.map((connector) => (
              <div className="metric" key={connector.connectorId}>
                <span>{connector.connectorId}</span>
                <strong>{connector.lastError ? "Needs attention" : "Healthy"}</strong>
                <p>
                  Last success {formatDate(connector.lastSuccessAt)} · inserted{" "}
                  {connector.documentsInserted}
                </p>
                {connector.lastError ? <p className="error-text">{connector.lastError}</p> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Recent Pipeline Runs</p>
          <div className="grid">
            {operations.recentRuns.length === 0 ? (
              <p>No pipeline runs have been recorded yet.</p>
            ) : operations.recentRuns.slice(0, 8).map((run) => (
              <div className="metric" key={run.id}>
                <span>{run.stage} · {formatDate(run.startedAt)}</span>
                <strong>{run.status}</strong>
                <p>{run.processedCount} processed · {run.failedCount} failed</p>
                {run.errorMessage ? <p className="error-text">{run.errorMessage}</p> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section grid two">
        <div className="panel">
          <p className="eyebrow">Source counts</p>
          <div className="grid">
            {status.sourceCounts.length === 0 ? (
              <p>No documents have been stored yet.</p>
            ) : (
              status.sourceCounts.map((source) => (
                <div className="metric" key={source.sourceClass}>
                  <span>{source.sourceClass.replace("_", " ")}</span>
                  <strong>{source.count}</strong>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Operational commands</p>
          <div className="copilot-box">npm run db:apply</div>
          <div className="copilot-box">npm run sec:smoke</div>
          <div className="copilot-box">npm run sec:backfill</div>
        </div>
      </section>
    </div>
  );
}

const FUNNEL_WINDOWS = [1, 7, 30] as const;

function parseWindow(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return FUNNEL_WINDOWS.includes(parsed as (typeof FUNNEL_WINDOWS)[number]) ? parsed : 7;
}

function FunnelSection({ funnel }: { funnel: IngestionFunnel }) {
  const ingested = funnel.stages[0]?.count ?? 0;
  const drops = funnel.stages
    .slice(1)
    .map((stage, index) => ({
      stage,
      lost: (funnel.stages[index]?.count ?? 0) - stage.count
    }))
    .filter((entry) => entry.lost > 0)
    .sort((left, right) => right.lost - left.lost);
  const biggestDrop = drops[0] ?? null;

  return (
    <section className="section">
      <div className="funnel-heading">
        <div>
          <p className="eyebrow">Coverage Funnel</p>
          <h2>Where documents fall out of the pipeline</h2>
          <p>
            Documents first stored in the last {funnel.windowDays === 1 ? "day" : `${funnel.windowDays} days`},
            traced through each processing stage. Every stage is a share of what was ingested.
          </p>
        </div>
        <nav className="pill-row" aria-label="Funnel window">
          {FUNNEL_WINDOWS.map((days) => (
            <a
              key={days}
              href={days === 7 ? "/ingestion" : `/ingestion?window=${days}`}
              className={days === funnel.windowDays ? "pill active" : "pill"}
              aria-current={days === funnel.windowDays ? "page" : undefined}
            >
              {days === 1 ? "24h" : `${days}d`}
            </a>
          ))}
        </nav>
      </div>

      <div className="grid four">
        <OperationalMetric
          label="Fetched by connectors"
          value={funnel.polling.runs > 0 ? String(funnel.polling.fetched) : "n/a"}
        />
        <OperationalMetric
          label="Deduplicated away"
          value={
            funnel.polling.runs > 0
              ? `${funnel.polling.skipped} (${formatShare(funnel.polling.dedupeRate)})`
              : "n/a"
          }
        />
        <OperationalMetric label="Connector failures" value={String(funnel.polling.failedConnectors)} />
        <OperationalMetric
          label="Biggest drop"
          value={
            biggestDrop
              ? `${biggestDrop.stage.label} (−${biggestDrop.lost})`
              : ingested > 0
                ? "None"
                : "No documents"
          }
        />
      </div>

      <div className="panel funnel">
        {funnel.stages.map((stage) => (
          <div className="funnel-stage" key={stage.key} title={stage.description}>
            <div className="funnel-label">
              <strong>{stage.label}</strong>
              <small>{stage.description}</small>
            </div>
            <div className="funnel-track" aria-hidden="true">
              <div className="funnel-fill" style={{ width: `${Math.max(2, stage.share * 100)}%` }} />
            </div>
            <div className="funnel-value">
              <strong>{stage.count}</strong>
              <span>{formatShare(stage.share)}</span>
            </div>
          </div>
        ))}
        {funnel.polling.runs === 0 ? (
          <p className="funnel-note">
            Connector fetch and dedupe totals appear once <code>poll:sources</code> has recorded a run in this window.
          </p>
        ) : null}
      </div>

      <div className="grid two">
        <div className="panel">
          <p className="eyebrow">By source class</p>
          {funnel.bySourceClass.length === 0 ? (
            <p>No documents stored in this window.</p>
          ) : (
            <table className="funnel-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Ingested</th>
                  <th>Text</th>
                  <th>Extracted</th>
                  <th>Classified</th>
                  <th>Matched</th>
                  <th>Approved</th>
                </tr>
              </thead>
              <tbody>
                {funnel.bySourceClass.map((row) => (
                  <tr key={row.sourceClass}>
                    <td>{row.sourceClass.replaceAll("_", " ")}</td>
                    <td>{row.ingested}</td>
                    <td>{cell(row.withText, row.ingested)}</td>
                    <td>{cell(row.extracted, row.ingested)}</td>
                    <td>{cell(row.classified, row.ingested)}</td>
                    <td>{cell(row.matched, row.ingested)}</td>
                    <td>{cell(row.approved, row.ingested)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <p className="eyebrow">Discovery output</p>
          {funnel.candidates.length === 0 ? (
            <p>No candidate narratives were created in this window.</p>
          ) : (
            <div className="grid">
              {funnel.candidates.map((candidate) => (
                <div className="metric" key={candidate.status}>
                  <span>{candidate.status.replaceAll("_", " ")}</span>
                  <strong>{candidate.count}</strong>
                </div>
              ))}
            </div>
          )}
          <p className="funnel-note">
            Candidates created from documents in this window, by current status. Promotions
            feed the tracked narrative set; rejections and merges are expected attrition.
          </p>
        </div>
      </div>
    </section>
  );
}

function cell(count: number, total: number) {
  if (total === 0) return "0";
  return `${count} · ${formatShare(count / total)}`;
}

function formatShare(value: number) {
  return `${Math.round(value * 100)}%`;
}

function OperationalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel">
      <span className="label">{label}</span>
      <h2>{value}</h2>
    </div>
  );
}

function TelemetryMetric({
  primary,
  secondary
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <div className="current-level">
      <strong>{primary}</strong>
      <span>{secondary}</span>
    </div>
  );
}

function IngestionCard({
  title,
  description,
  documents,
  latest,
  commands,
  breakdown = []
}: {
  title: string;
  description: string;
  documents: number;
  latest: string | null;
  commands: string[];
  breakdown?: Array<{
    label: string;
    value: number;
  }>;
}) {
  return (
    <div className="panel">
      <p className="eyebrow">{title}</p>
      <p>{description}</p>
      <div className="metric-row">
        <div className="metric">
          <span>Documents</span>
          <strong>{documents}</strong>
        </div>
        <div className="metric">
          <span>Latest source date</span>
          <strong>{formatDate(latest)}</strong>
        </div>
      </div>
      {breakdown.length > 0 ? (
        <div className="grid">
          {breakdown.map((item) => (
            <div className="metric" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid">
        {commands.map((command) => (
          <div className="copilot-box" key={command}>
            {command}
          </div>
        ))}
      </div>
    </div>
  );
}

function categoryLabel(category: string) {
  return category.replaceAll("_", " ");
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
