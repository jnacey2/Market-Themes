import Link from "next/link";
import { notFound } from "next/navigation";
import { storyboards } from "@market-themes/db";

type StoryboardPageProps = {
  params: {
    id: string;
  };
};

export function generateStaticParams() {
  return storyboards.map((storyboard) => ({ id: storyboard.id }));
}

export default function StoryboardPage({ params }: StoryboardPageProps) {
  const storyboard = storyboards.find((item) => item.id === params.id);

  if (!storyboard) {
    notFound();
  }

  const maxIntensity = Math.max(...storyboard.trend.map((point) => point.intensity));

  return (
    <div className="shell">
      <nav className="nav">
        <Link className="brand" href="/">
          Market Themes
        </Link>
        <div className="nav-links">
          <Link href="/">Dashboard</Link>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Storyboard</p>
          <h1>{storyboard.theme}</h1>
          <p className="lede">{storyboard.narrative}</p>
          <div className="pill-row">
            {storyboard.affectedEntities.map((entity) => (
              <span className="pill" key={entity}>
                {entity}
              </span>
            ))}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Why this is unusual</p>
          <p>{storyboard.whyUnusual}</p>
          <div className="metric-row">
            <div className="metric">
              <span>Z-score</span>
              <strong>{storyboard.zScore.toFixed(1)}</strong>
            </div>
            <div className="metric">
              <span>Percentile</span>
              <strong>{storyboard.percentileRank}</strong>
            </div>
            <div className="metric">
              <span>Confidence</span>
              <strong>{storyboard.confidence}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <p className="eyebrow">Trend vs baseline</p>
          <div className="chart" aria-label="Theme intensity chart">
            {storyboard.trend.map((point) => (
              <div
                className="bar"
                key={point.date}
                style={{ height: `${(point.intensity / maxIntensity) * 100}%` }}
                title={`${point.date}: ${point.intensity}`}
              />
            ))}
          </div>
        </div>
        <div className="panel">
          <p className="eyebrow">Source mix</p>
          <div className="grid">
            {Object.entries(storyboard.sourceMix).map(([sourceClass, value]) => (
              <div className="metric" key={sourceClass}>
                <span>{sourceClass.replace("_", " ")}</span>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <p className="eyebrow">Evidence</p>
        <div className="grid two">
          {storyboard.evidence.map((evidence) => (
            <article className="evidence-card" key={evidence.id}>
              <span className="label">
                {evidence.publisher} · {evidence.sourceClass.replace("_", " ")}
              </span>
              <h3>{evidence.title}</h3>
              <p>{evidence.snippet}</p>
              <a className="pill" href={evidence.url}>
                Source link
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="section panel">
        <p className="eyebrow">What to investigate next</p>
        <div className="grid">
          {storyboard.followUpQuestions.map((question) => (
            <div className="copilot-box" key={question}>
              {question}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
