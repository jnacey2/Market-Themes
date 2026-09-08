import { getDailyBriefArchive } from "@market-themes/db";
export const dynamic = "force-dynamic";
export default async function BriefsPage() {
  const briefs = await getDailyBriefArchive();
  return (
    <div className="shell">
      <p className="eyebrow">Daily brief archive</p>
      <h1>Evidence, kept in context.</h1>
      <p className="lede">
        The latest 30 saved briefs. Each preserves the measured narrative
        summary saved at generation time.
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
              <p className="eyebrow">{brief.date}</p>
              <h2>{brief.headline}</h2>
              <p>{brief.summary}</p>
              {brief.sections.map((section, index) => (
                <section key={index}>
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
