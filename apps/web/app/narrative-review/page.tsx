import Link from "next/link";
import { getNarrativeReviewQueue } from "@market-themes/db";
import { ReviewControls } from "./ReviewControls";

export const dynamic = "force-dynamic";

export default async function NarrativeReviewPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const status = ["pending", "approved", "rejected", "all"].includes(
    params.status ?? ""
  )
    ? params.status!
    : "pending";
  const page = Math.max(0, Math.floor(Number(params.page) || 0));
  const queue = await getNarrativeReviewQueue(undefined, undefined, {
    status,
    query: params.q,
    page
  });
  const pageHref = (value: number) =>
    `/narrative-review?${new URLSearchParams({ status, q: params.q ?? "", page: String(value) })}`;

  return (
    <div className="shell wide-shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/trends">Narrative Currents</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/ingestion">Operations</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Quality Control</p>
          <h1>Narrative evidence review.</h1>
          <p className="lede">
            Approve only when the exact quotation directly supports the tracked
            proposition. Pending evidence suppresses comparisons until review is
            complete.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Classifier version</p>
          <h2>{queue.promptVersion}</h2>
          <p>
            Reviews automatically queue a measurement refresh. The worker checks
            every 45 seconds.
          </p>
        </div>
      </section>

      <section className="grid three">
        <Metric label="Pending" value={queue.pendingCount} />
        <Metric label="Approved" value={queue.approvedCount} />
        <Metric label="Rejected" value={queue.rejectedCount} />
      </section>

      <form className="section filter-form">
        <label>
          Review status
          <select name="status" defaultValue={status}>
            {["pending", "approved", "rejected", "all"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Title, publisher, or narrative
          <input name="q" defaultValue={params.q ?? ""} />
        </label>
        <button className="button">Filter</button>
      </form>
      <section className="section review-queue">
        {queue.items.length === 0 ? (
          <div className="panel">
            <h2>No evidence matches these filters</h2>
            <p>
              Run classification against current documents to populate this
              queue.
            </p>
          </div>
        ) : (
          queue.items.map((item) => (
            <article className="panel review-card" key={item.id}>
              <div>
                <div className="pill-row">
                  <span className={`pill review-${item.reviewStatus}`}>
                    {item.reviewStatus}
                  </span>
                  <span className="pill">
                    match {item.matchScore.toFixed(0)}
                  </span>
                  <span className="pill">
                    {item.sourceClass.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="eyebrow">{item.narrativeName}</p>
                <h2>{item.title}</h2>
                <p>
                  <strong>Proposition:</strong> {item.proposition}
                </p>
                <blockquote>{item.evidenceSnippet}</blockquote>
                <p>
                  <span className="synthesis-label">
                    Unreviewed model synthesis
                  </span>{" "}
                  {item.interpretation}
                </p>
                <p className="label">
                  {item.publisher} ·{" "}
                  {new Date(item.publishedAt).toLocaleDateString()}
                </p>
                <a href={item.url} rel="noreferrer" target="_blank">
                  Open source
                </a>
                <details className="detail-block">
                  <summary>Review guidance</summary>
                  <p>
                    <strong>Include:</strong> {item.inclusionGuidance}
                  </p>
                  <p>
                    <strong>Exclude:</strong> {item.exclusionGuidance}
                  </p>
                </details>
              </div>
              <ReviewControls
                id={item.id}
                currentStatus={item.reviewStatus}
                initialNote={item.reviewNote ?? ""}
              />
            </article>
          ))
        )}
      </section>
      <div className="button-row">
        {page > 0 ? (
          <Link className="pill" href={pageHref(page - 1)}>
            Previous
          </Link>
        ) : null}
        <span>Page {page + 1}</span>
        {queue.hasMore ? (
          <Link className="pill" href={pageHref(page + 1)}>
            Next
          </Link>
        ) : null}
      </div>
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
