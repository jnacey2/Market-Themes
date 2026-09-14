import { createDatabaseClient } from "./persistence";

export type ResearchDocument = {
  id: string; title: string; publisher: string; url: string; publishedAt: string;
  sourceClass: string; tickers: string[]; text: string; eventKey: string;
};
export type ResearchFact = { basis: "Outlook" | "Reported result"; metric: string; quote: string; source: Omit<ResearchDocument, "text"> };
export type ResearchLead = {
  company: string; question: string; reportedAt: string; facts: ResearchFact[];
  counterevidence: ResearchFact[]; sourceEvents: number; nextCheck: string;
  invalidation: string; gaps: string[];
};
export type ResearchQueue = { generatedAt: string; documentsScanned: number; leads: ResearchLead[] };

const metrics = [
  ["Revenue", /\b(revenue|net sales|sales growth)\b/i],
  ["Demand and capacity", /\b(backlog|remaining performance obligations|utilization|capacity|orders)\b/i],
  ["Cash and investment", /\b(free cash flow|operating cash flow|cash flow from operations|cash (?:provided by|from) operating(?: activities)?|capital expenditure|capital spending|capex)\b/i],
  ["Profitability", /\b(operating (?:income|margin|loss)|gross (?:profit|margin)|net income)\b/i]
] as const;
const quantity = /(?:\$\s*\d[\d,.]*|\d[\d,.]*\s*(?:%|million\b|billion\b|megawatts\b|basis points\b))/i;
const negative = /\b(decreas|declin|contract(?:ed|ing|ion)|lower|down|fell|negative|loss|impairment|shortfall|underutiliz)/i;

/** Exact contiguous passages only; figures are issuer-reported, not model estimates.
 * Sentence boundaries avoid joining figures from unrelated table rows. */
export function extractResearchFacts(document: ResearchDocument): ResearchFact[] {
  if (!["filing", "transcript"].includes(document.sourceClass)) return [];
  const { text, ...source } = document;
  const passages = text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+|&#(?:8226|x2022);/);
  const facts: ResearchFact[] = [];
  for (const passage of passages) {
    const quote = passage.trim();
    if (quote.length < 45 || quote.length > 600 || !quantity.test(quote)) continue;
    if (/\b(hypothetical|illustrative|litigation|penalt|stock.sale|10b5-1|tax|table|reconciliation|deferred revenue|stock.based|notes payable)\b/i.test(quote)) continue;
    if (/\b(liquidity requirements|no single|geographic distribution|regions contributed|capital deployment|CAGR|distributors|end.customer)\b/i.test(quote)) continue;
    if (!/\b(is|was|were|grew|rose|generated|reported|achieved|reached|totaled|declined|doubled|included|recognized|increased|decreased|expects|expect|represented)\b/i.test(quote)) continue;
    if ((quote.match(/\d[\d,.]*/g) ?? []).length > 12) continue;
    const firstMetric = metrics.filter(([,pattern]) => pattern.test(quote))
      .sort((a,b) => quote.search(a[1])-quote.search(b[1]))[0]?.[0];
    for (const [metric, pattern] of metrics) {
      if (metric !== firstMetric) continue;
      if (metric === "Demand and capacity" && /\b(debt|repurchase|borrowing|liquidity|credit facility|revolving)\b/i.test(quote)) continue;
      if (pattern.test(quote) && !facts.some(f => f.metric === metric && f.quote === quote)) {
        facts.push({ metric, quote, source, basis: /\b(expect|expected|expects|anticipat|forecast|guidance|will)\b/i.test(quote) ? "Outlook" : "Reported result" });
      }
    }
  }
  return facts.slice(0, 40);
}

export function buildResearchQueue(documents: ResearchDocument[], now = new Date()): ResearchQueue {
  const companies = new Map<string, ResearchFact[]>();
  for (const document of documents) {
    // Multi-issuer documents cannot safely attribute every passage to every ticker.
    if (document.tickers.length !== 1) continue;
    const ticker = document.tickers[0];
    const found = extractResearchFacts(document);
    companies.set(ticker, [...(companies.get(ticker) ?? []), ...found]);
  }
  const leads: ResearchLead[] = [];
  for (const [company, all] of companies) {
    const relevance = (f: ResearchFact) =>
      (/prepayment|upfront license/i.test(f.quote) ? 6 : 0) +
      (/year.over.year|relative to|compared to|increased|decreased|grew|declined/i.test(f.quote) ? 3 : 0);
    const sorted = all.sort((a, b) => b.source.publishedAt.localeCompare(a.source.publishedAt) || relevance(b)-relevance(a));
    const facts: ResearchFact[] = [];
    const seen = new Set<string>();
    for (const fact of sorted) {
      const key = fact.quote.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key) || facts.some(f => f.metric === fact.metric)) continue;
      seen.add(key); facts.push(fact);
    }
    // Two distinct metric families and passages are a minimum research lead.
    if (facts.length < 2) continue;
    const counterevidence = sorted.filter(f => negative.test(f.quote))
      .filter((f, i, a) => a.findIndex(x => x.quote === f.quote) === i).slice(0, 2);
    const hasCash = facts.some(f => f.metric === "Cash and investment");
    const hasDemand = facts.some(f => f.metric === "Demand and capacity");
    // Multiple issuer reports within this short intake window can describe the
    // same results. Count conservatively as one reporting cluster per company.
    const sourceEvents = 1;
    leads.push({
      company,
      question: facts.some(f => /prepayment/i.test(f.quote)) && hasDemand
        ? `How much of ${company}'s cash improvement comes from customer prepayments, and what investment is needed to fulfill the backlog?`
        : facts.some(f => /upfront license/i.test(f.quote))
        ? `How much of ${company}'s reported revenue depends on upfront licensing, and how does that compare with recurring revenue and cash generation?`
        : hasCash && hasDemand
        ? `How does ${company}'s reported demand compare with its cash generation and investment needs?`
        : `Do ${company}'s reported operating figures and profitability support the same conclusion?`,
      reportedAt: facts[0].source.publishedAt,
      facts: facts.slice(0, 4), counterevidence, sourceEvents,
      nextCheck: "Next quarterly results: compare these same metrics on a like-for-like basis. Release date has not been verified.",
      invalidation: hasCash
        ? "An improving-demand thesis would weaken if cash conversion deteriorates or investment rises without corresponding realized revenue. Verify comparable periods and accounting definitions."
        : "An improving-business thesis would weaken if revenue, demand and margins diverge after adjusting for acquisitions, currency and one-off items.",
      gaps: [
        ...(sourceEvents < 2 ? ["One source event; independent corroboration is still needed."] : []),
        ...(!hasCash ? ["No qualifying cash-flow or investment passage was found in the scanned material."] : []),
        ...(counterevidence.length === 0 ? ["No contrary passage was found in the scanned reports; this does not establish that contrary evidence is absent."] : []),
        "Figures are management-reported; separate announcements are not independent verification.",
        "Market expectations and valuation have not been checked."
      ]
    });
  }
  leads.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt) || b.facts.length - a.facts.length || b.sourceEvents - a.sourceEvents);
  return { generatedAt: now.toISOString(), documentsScanned: documents.length, leads: leads.slice(0, 5) };
}

export async function generateResearchQueue(databaseUrl = process.env.DATABASE_URL) {
  const client = createDatabaseClient(databaseUrl, { queryTimeoutMs: 125_000, statementTimeoutMs: 120_000 });
  await client.connect();
  try {
    const result = await client.query<ResearchDocument>(`with selected as materialized (
      select d.* from documents d where d.source_class in ('filing', 'transcript')
        and d.published_at >= now() - interval '14 days' and d.published_at <= now()
        and cardinality(d.tickers) = 1 and coalesce(d.retention_policy, 'full_text') <> 'metadata_only'
        and (d.source_class = 'transcript' or d.metadata->>'form' in ('10-Q','10-K','20-F','40-F','6-K')
          or d.metadata->>'exhibitType' in ('EX-99','EX-99.1','EX-99.2'))
      order by d.published_at desc limit 120
    ) select d.id,d.title,d.publisher,d.url,d.published_at::text as "publishedAt",
      d.source_class as "sourceClass",d.tickers,left(dt.content,200000) as text,
      coalesce(nullif(d.metadata->>'accessionNumber',''), nullif(d.near_duplicate_key,''),d.url) as "eventKey"
      from selected d join document_texts dt on dt.document_id=d.id`);
    const queue = buildResearchQueue(result.rows);
    await client.query(`insert into research_queue_snapshots (id,generated_at,payload) values ('latest',now(),$1::jsonb)
      on conflict(id) do update set generated_at=excluded.generated_at,payload=excluded.payload`, [JSON.stringify(queue)]);
    return queue;
  } finally { await client.end(); }
}

export async function getResearchQueue(databaseUrl = process.env.DATABASE_URL): Promise<ResearchQueue | null> {
  if (!databaseUrl) return null;
  const client = createDatabaseClient(databaseUrl, { queryTimeoutMs: 4000, statementTimeoutMs: 3500 });
  try {
    await client.connect();
    return (await client.query<{ payload: ResearchQueue }>("select payload from research_queue_snapshots where id='latest'")).rows[0]?.payload ?? null;
  } catch (error) {
    console.warn(`[research-queue] ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally { await client.end(); }
}

/** Focus transcript/earnings polling on recent reporting companies without a
 * current transcript. The regular SEC/news polling universe is unchanged. */
export async function getResearchTargetTickers(databaseUrl = process.env.DATABASE_URL): Promise<string[]> {
  const client = createDatabaseClient(databaseUrl, { queryTimeoutMs: 65000, statementTimeoutMs: 60000 });
  await client.connect();
  try {
    const result = await client.query<{ ticker: string }>(`with reporting as (
      select d.tickers[1] as ticker,max(d.published_at) as reported_at
      from documents d where d.source_class='filing' and cardinality(d.tickers)=1
        and d.published_at >= now()-interval '30 days'
        and (d.metadata->>'form' in ('10-Q','10-K','20-F','40-F')
          or d.metadata->>'items' like '%2.02%'
          or (d.metadata->>'exhibitType' like 'EX-99%' and exists (
            select 1 from document_texts dt where dt.document_id=d.id
              and left(dt.content,12000) ~* 'quarter|financial results|earnings')))
      group by d.tickers[1]
    ) select r.ticker from reporting r where not exists (
      select 1 from documents t where t.source_class='transcript'
        and t.tickers @> array[r.ticker] and t.published_at >= r.reported_at-interval '14 days'
    ) order by r.reported_at desc,r.ticker limit 30`);
    return result.rows.map(row => row.ticker);
  } finally { await client.end(); }
}
