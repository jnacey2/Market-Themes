import { getResearchQueue } from "@market-themes/db";

function SourceLink({ url, title }: { url: string; title: string }) {
  // Provider API URLs have redacted credentials and are not public reading links.
  return /[?&]apikey=/i.test(url)
    ? <span>{title} · stored transcript excerpt</span>
    : <a href={url} target="_blank" rel="noreferrer">{title}</a>;
}

function displayQuote(quote: string) {
  return quote.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (original, code: string) => {
    const point = code[0].toLowerCase() === "x" ? parseInt(code.slice(1),16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : original;
  }).replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

export async function ResearchQueue() {
  const queue = await getResearchQueue();
  return <section className="section" id="research">
    <p className="eyebrow">Research queue</p>
    <h2>Start with the reported figures.</h2>
    <p>Up to five company research questions, grounded in exact passages from filings and transcripts.
      Issuer filings and transcripts in this window are conservatively grouped as one reporting event per company. Figures may cover different periods;
      the questions below still require comparison and valuation work.</p>
    {!queue ? <p>Research queue is awaiting its first publication.</p> : <>
      <p className="label">Published {new Date(queue.generatedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC · {queue.documentsScanned} primary-source documents scanned</p>
      {Date.now() - Date.parse(queue.generatedAt) > 36 * 3600000 ? <p role="status">This research queue is more than 36 hours old. Check source dates before using it.</p> : null}
      {queue.leads.length === 0 ? <p>No lead met the requirement for two distinct quoted operating metrics in the scanned sources.</p> : null}
      {queue.leads.map(lead => <article className="panel" key={lead.company} style={{ marginTop: 16 }}>
        <p className="eyebrow">{lead.company} · {lead.sourceEvents} source {lead.sourceEvents === 1 ? "event" : "events"}</p>
        <h3>{lead.question}</h3>
        <h4>Reported update</h4>
        {lead.facts.map(fact => <div key={fact.metric}>
          <strong>{fact.metric} · {fact.basis}</strong><blockquote>{displayQuote(fact.quote)}</blockquote>
          <SourceLink url={fact.source.url} title={fact.source.title} />
          <p className="label">{fact.source.publisher} · {fact.source.publishedAt.slice(0,10)}</p>
        </div>)}
        {lead.counterevidence.length ? <details><summary>Potential counterevidence</summary>
          {lead.counterevidence.map((fact, i) => <blockquote key={i}>{displayQuote(fact.quote)} <SourceLink url={fact.source.url} title={fact.source.title} /></blockquote>)}
        </details> : null}
        <p><strong>What to check next:</strong> {lead.nextCheck}</p>
        <p><strong>What would weaken the thesis:</strong> {lead.invalidation}</p>
        <details><summary>Open questions and evidence gaps</summary><ul>{lead.gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></details>
      </article>)}
    </>}
  </section>;
}
