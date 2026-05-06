import Link from "next/link";
import { dailyBrief, storyboards } from "@market-themes/db";

const topStoryboard = storyboards[0];

export default function HomePage() {
  const averageZScore =
    storyboards.reduce((total, storyboard) => total + storyboard.zScore, 0) /
    storyboards.length;

  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Market Themes</div>
        <div className="nav-links">
          <a href="#storyboards">Storyboards</a>
          <a href="#brief">Daily Brief</a>
          <a href="#copilot">Copilot</a>
          <Link href="/ingestion">Ingestion</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Narrative Intelligence</p>
          <h1>See which market stories are actually changing.</h1>
          <p className="lede">
            Track emerging risks and bullish themes across filings, transcripts,
            press releases, and news. Each storyboard explains the narrative,
            why it is unusual, and the evidence behind the signal.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Today&apos;s highest priority</p>
          <h2>{topStoryboard.theme}</h2>
          <p>{topStoryboard.whyUnusual}</p>
          <div className="metric-row">
            <div className="metric">
              <span>Z-score</span>
              <strong>{topStoryboard.zScore.toFixed(1)}</strong>
            </div>
            <div className="metric">
              <span>Percentile</span>
              <strong>{topStoryboard.percentileRank}</strong>
            </div>
            <div className="metric">
              <span>Confidence</span>
              <strong>{topStoryboard.confidence}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid three">
        <div className="panel">
          <span className="label">Coverage</span>
          <h2>S&P 500 + Nasdaq-100</h2>
          <p>Initial scope targets US equities plus macro themes.</p>
        </div>
        <div className="panel">
          <span className="label">Signal</span>
          <h2>{averageZScore.toFixed(1)} avg z-score</h2>
          <p>Ranks themes by normalized surprise, not raw popularity.</p>
        </div>
        <div className="panel">
          <span className="label">Workflow</span>
          <h2>Days, weeks, months</h2>
          <p>Designed for research prioritization across multiple horizons.</p>
        </div>
      </section>

      <section className="section" id="storyboards">
        <p className="eyebrow">Storyboards</p>
        <div className="grid">
          {storyboards.map((storyboard) => (
            <Link
              className="storyboard-card"
              href={`/storyboards/${storyboard.id}`}
              key={storyboard.id}
            >
              <div>
                <div className="pill-row">
                  <span className="pill">{storyboard.status}</span>
                  <span className="pill">z {storyboard.zScore.toFixed(1)}</span>
                  <span className="pill">{storyboard.percentileRank}th pctile</span>
                </div>
                <h2>{storyboard.theme}</h2>
                <p>{storyboard.narrative}</p>
                <div className="pill-row">
                  {storyboard.affectedEntities.slice(0, 5).map((entity) => (
                    <span className="pill" key={entity}>
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
              <div className="score-stack">
                <div className="score">
                  <span className="label">Risk tone</span>
                  <strong>{storyboard.riskTone}</strong>
                </div>
                <div className="score">
                  <span className="label">Bullish tone</span>
                  <strong>{storyboard.bullishTone}</strong>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section grid two">
        <div className="panel brief" id="brief">
          <p className="eyebrow">Daily Brief</p>
          <h2>{dailyBrief.headline}</h2>
          <p>{dailyBrief.summary}</p>
        </div>
        <div className="panel" id="copilot">
          <p className="eyebrow">Research Copilot</p>
          <h2>Ask from the evidence, not the model&apos;s memory.</h2>
          <div className="copilot-box">
            What are management teams saying about consumer weakness this week?
          </div>
          <p>
            The first copilot will retrieve storyboard evidence and document
            chunks, then answer with citations and clear separation between
            sourced evidence and interpretation.
          </p>
        </div>
      </section>
    </div>
  );
}
