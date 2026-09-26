export function Options() {
  return (
    <main className="surface options-surface">
      <div className="eyebrow">Pushbullet Reborn</div>
      <h1>Settings</h1>
      <p className="lede">This is the new MV3 foundation. Feature migrations will land here incrementally.</p>

      <section className="roadmap-card" aria-labelledby="roadmap-heading">
        <div>
          <div className="card-kicker">Foundation status</div>
          <h2 id="roadmap-heading">Scaffold ready</h2>
        </div>
        <span className="status-pill">v0.1.0</span>
        <p>The popup, options page, and service worker now share one typed build pipeline.</p>
      </section>
    </main>
  )
}
