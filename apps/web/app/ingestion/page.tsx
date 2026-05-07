import Link from "next/link";
import { getIngestionStatus } from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function IngestionPage() {
  const status = await getIngestionStatus();

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
          <Link href="/analysis">Analysis</Link>
        </div>
      </nav>

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
