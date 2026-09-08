import Link from "next/link";
import { getDailyBriefArchive } from "@market-themes/db";
export const dynamic = "force-dynamic";
export default async function BriefsPage() {
  const briefs = await getDailyBriefArchive();
  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <Link href="/">Dashboard</Link>
      </nav>
      <p className="eyebrow">Daily brief archive</p>
      <h1>Evidence, kept in context.</h1>
      <p className="lede">
        The latest 30 saved briefs. Each records its measurement date and the
        reviewed quotations used at generation time.
      </p>
      <div className="grid">
        {!briefs.length ? (
          <div className="panel">
            <h2>No saved briefs yet</h2>
            <p>
              The scheduled briefing will appear here after narrative
              measurements are available.
            </p>
          </div>
        ) : (
          briefs.map((brief) => (
            <article className="panel" key={brief.date}>
              <p className="eyebrow">
                {brief.date} · Measurements through {brief.measurementDate}
              </p>
              <h2>{brief.headline}</h2>
              <p>{brief.summary}</p>
              {brief.evidence.map((item) => (
                <details className="detail-block" key={item.narrativeId}>
                  <summary>{item.name}: supporting sources</summary>
                  {item.citations.map((citation, i) => (
                    <div key={i}>
                      <blockquote>{citation.quote}</blockquote>
                      <a
                        className="pill"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {citation.publisher}: {citation.title}
                      </a>
                    </div>
                  ))}
                </details>
              ))}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
