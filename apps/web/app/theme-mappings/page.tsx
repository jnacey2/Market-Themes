import { getThemeMappingStatus, type ThemeMappingSummary } from "@market-themes/db";

export const dynamic = "force-dynamic";

export default async function ThemeMappingsPage() {
  const status = await getThemeMappingStatus();
  const marketGroups = groupByMarketTheme(status.mappings);

  return (
    <div className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Theme Mappings</p>
          <h1>Review normalized market narratives.</h1>
          <p className="lede">
            Inspect how company-specific extracted themes are mapped into
            overall market themes and sector sub-themes before they power the
            dashboard.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Coverage</p>
          <h2>{status.mappingCount} mappings</h2>
          <p>
            {status.mappedSignalCount} mapped signals · {status.unmappedSignalCount} unmapped
            signals.
          </p>
        </div>
      </section>

      <section className="grid three">
        <Metric label="Market themes" value={marketGroups.length} />
        <Metric label="Mapped signals" value={status.mappedSignalCount} />
        <Metric label="Unmapped signals" value={status.unmappedSignalCount} />
      </section>

      <section className="section">
        <p className="eyebrow">Mappings</p>
        <div className="grid">
          {marketGroups.length === 0 ? (
            <div className="panel">
              <h2>No mappings yet</h2>
              <p>Run npm run themes:normalize after applying the schema.</p>
            </div>
          ) : (
            marketGroups.map((group) => (
              <div className="panel" key={group.marketThemeId}>
                <div className="pill-row">
                  <span className="pill">market theme</span>
                  <span className="pill">{group.mappings.length} mapped themes</span>
                </div>
                <h2>{group.marketThemeLabel}</h2>
                <p>{group.marketThemeDescription}</p>
                <div className="grid">
                  {group.mappings.map((mapping) => (
                    <div className="evidence-card" key={mapping.id}>
                      <div className="pill-row">
                        <span className="pill">{mapping.sector}</span>
                        <span className="pill">{mapping.confidenceLabel}</span>
                        <span className="pill">{Math.round(mapping.confidence)} confidence</span>
                        <span className="pill">{mapping.status}</span>
                      </div>
                      {mapping.sectorSubthemeLabel ? (
                        <h3>{mapping.sectorSubthemeLabel}</h3>
                      ) : null}
                      <p>
                        <strong>Extracted:</strong> {mapping.extractedThemeLabel}
                      </p>
                      <p>{mapping.rationale}</p>
                      {mapping.affectedEntities.length > 0 ? (
                        <div className="pill-row">
                          {mapping.affectedEntities.slice(0, 8).map((entity) => (
                            <span className="pill" key={entity}>
                              {entity}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {mapping.representativeSnippets.slice(0, 2).map((snippet) => (
                        <p key={snippet}>{snippet}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
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

function groupByMarketTheme(mappings: ThemeMappingSummary[]) {
  const groups = new Map<
    string,
    {
      marketThemeId: string;
      marketThemeLabel: string;
      marketThemeDescription: string;
      mappings: ThemeMappingSummary[];
    }
  >();

  for (const mapping of mappings) {
    const group = groups.get(mapping.marketThemeId) ?? {
      marketThemeId: mapping.marketThemeId,
      marketThemeLabel: mapping.marketThemeLabel,
      marketThemeDescription: mapping.marketThemeDescription,
      mappings: []
    };
    group.mappings.push(mapping);
    groups.set(mapping.marketThemeId, group);
  }

  return Array.from(groups.values());
}
