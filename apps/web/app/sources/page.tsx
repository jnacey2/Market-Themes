import Link from "next/link";
import { listPublicationFeeds } from "@market-themes/db";
import { SourceManager } from "./SourceManager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const feeds = await listPublicationFeeds();

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
            Add public Substacks, blogs, and RSS publications without a code deploy.
            Each source is deduplicated, checkpointed, and routed through evidence review
            before it can affect published narratives.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Registered</p>
          <h2>{feeds.length}</h2>
          <p>{feeds.filter((feed) => feed.enabled).length} enabled publications.</p>
        </div>
      </section>

      <SourceManager feeds={feeds} />
    </div>
  );
}
