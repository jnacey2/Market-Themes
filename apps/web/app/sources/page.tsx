import Link from "next/link";
import { listConnectorCheckpoints, listPublicationFeeds } from "@market-themes/db";
import { NEWSPAPER_FEED_GROUPS, NEWSPAPER_FEED_PRESETS } from "@market-themes/ingest";
import { SourceManager } from "./SourceManager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [feeds, connectors] = await Promise.all([
    listPublicationFeeds(),
    listConnectorCheckpoints()
  ]);
  const substackSessionConfigured = Boolean(process.env.SUBSTACK_STORAGE_STATE_B64?.trim());
  const premiumSources = [
    ["premium-wsj", "The Wall Street Journal"],
    ["premium-nyt", "The New York Times"],
    ["premium-wapo", "The Washington Post"],
    ["premium-ft", "Financial Times"],
    ["premium-bloomberg", "Bloomberg"]
  ].map(([id, name]) => ({
    id,
    name,
    checkpoint: connectors.find((connector) => connector.connectorId === id)
  }));

  return (
    <div className="shell wide-shell">
      <nav className="nav">
        <Link className="brand" href="/">Market Themes</Link>
        <div className="nav-links">
          <Link href="/trends">Narrative Currents</Link>
          <Link href="/narrative-review">Evidence Review</Link>
          <Link href="/ingestion">Operations</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Source Registry</p>
          <h1>Managed publications.</h1>
          <p className="lede">
            Add the Substacks you subscribe to, plus blogs and official newspaper
            RSS, without a code deploy. A captured Substack subscriber session
            downloads paid posts you already pay for. Headline feeds stay
            snippet-only. Each source is deduplicated, checkpointed, and routed
            through evidence review before it can affect published narratives.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Registered</p>
          <h2>{feeds.length}</h2>
          <p>{feeds.filter((feed) => feed.enabled).length} enabled publications.</p>
        </div>
      </section>

      <SourceManager
        feeds={feeds}
        newspaperGroups={NEWSPAPER_FEED_GROUPS}
        newspaperPresets={NEWSPAPER_FEED_PRESETS}
        substackSessionConfigured={substackSessionConfigured}
      />

      <section className="section">
        <p className="eyebrow">Authenticated Publishers</p>
        <p className="lede">
          These collectors run in an isolated Render browser job. Session files are
          captured locally and stored only as encrypted Render secrets.
        </p>
        <div className="grid two">
          {premiumSources.map((source) => (
            <div className="panel" key={source.id}>
              <span className="label">{source.id}</span>
              <h2>{source.name}</h2>
              <p>
                {source.checkpoint?.lastError
                  ? source.checkpoint.lastError
                  : source.checkpoint?.lastSuccessAt
                    ? `Last successful scrape ${new Date(source.checkpoint.lastSuccessAt).toLocaleString()}`
                    : "Not enabled or not run yet."}
              </p>
              <div className="metric-row">
                <div className="metric">
                  <span>Fetched</span>
                  <strong>{source.checkpoint?.documentsFetched ?? 0}</strong>
                </div>
                <div className="metric">
                  <span>Inserted</span>
                  <strong>{source.checkpoint?.documentsInserted ?? 0}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
