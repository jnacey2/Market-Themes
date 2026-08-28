export default function Loading() {
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Market Themes</div>
      </nav>
      <section className="hero">
        <div>
          <p className="eyebrow">Narrative Intelligence</p>
          <h1>Loading live themes…</h1>
          <p className="lede">
            Fetching ranking data from the research database. This should only
            take a few seconds.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Today&apos;s highest priority</p>
          <h2>Loading</h2>
          <p>Waiting on the latest theme ranking query.</p>
        </div>
      </section>
    </div>
  );
}
