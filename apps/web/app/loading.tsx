export default function Loading() {
  return (
    <div className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Market Themes</p>
          <h1>Loading workspace…</h1>
          <p className="lede">
            Fetching the latest research data from the market intelligence
            database.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Live data</p>
          <h2>Loading</h2>
          <p>The requested page will appear when its latest data is ready.</p>
        </div>
      </section>
    </div>
  );
}
