insert into narrative_definitions (
  id, slug, version, name, proposition, category,
  inclusion_guidance, exclusion_guidance, positive_examples, negative_examples
) values
  (
    'narrative:def:ai-capex-discipline:v1', 'ai-capex-discipline', 1,
    'AI Capex Discipline',
    'Companies and investors are demanding measurable returns, efficiency, or restraint from artificial-intelligence infrastructure spending.',
    'Technology',
    'Include scrutiny of AI infrastructure budgets, utilization, ROI, or spending discipline.',
    'Exclude generic AI adoption, product launches, and demand claims without a spending-efficiency frame.',
    array['AI investment must translate into revenue or productivity', 'management is moderating data-center spend until utilization improves'],
    array['the company launched a new AI assistant']
  ),
  (
    'narrative:def:ai-infrastructure-demand:v1', 'ai-infrastructure-demand', 1,
    'AI Infrastructure Demand',
    'Demand for compute, power, networking, data centers, or semiconductors is rising because of artificial-intelligence workloads.',
    'Technology',
    'Include concrete demand, capacity, backlog, constraint, or investment evidence tied to AI infrastructure.',
    'Exclude generic AI optimism and software-only adoption.',
    array['AI workloads are driving accelerator and networking demand'],
    array['employees are testing an AI writing tool']
  ),
  (
    'narrative:def:consumer-trade-down:v1', 'consumer-trade-down', 1,
    'Consumer Trade-Down',
    'Consumers are shifting toward lower-priced products, channels, or quantities because household budgets are under pressure.',
    'Consumer',
    'Include downtrading, value-seeking, reduced basket size, private-label shifts, or affordability pressure.',
    'Exclude ordinary promotions or premium-product weakness without evidence of budget pressure.',
    array['customers are choosing value tiers and smaller packs'],
    array['a seasonal promotion increased traffic']
  ),
  (
    'narrative:def:pricing-power:v1', 'pricing-power', 1,
    'Pricing Power',
    'Companies can raise or maintain prices without a proportionate loss of demand.',
    'Cross-sector',
    'Include realized price increases, resilient elasticity, mix benefits, or explicit ability to pass through costs.',
    'Exclude list-price announcements without evidence of realization or demand resilience.',
    array['price increases held while volumes remained resilient'],
    array['the company published a higher suggested retail price']
  ),
  (
    'narrative:def:margin-pressure:v1', 'margin-pressure', 1,
    'Margin Pressure',
    'Input costs, labor, competition, mix, or weak demand are compressing corporate profit margins.',
    'Cross-sector',
    'Include evidence of gross or operating margin compression and its identified drivers.',
    'Exclude purely accounting changes and one-time charges without operating implications.',
    array['labor and freight costs compressed operating margin'],
    array['a tax adjustment reduced reported net income']
  ),
  (
    'narrative:def:credit-quality-deterioration:v1', 'credit-quality-deterioration', 1,
    'Credit Quality Deterioration',
    'Borrower stress, delinquencies, defaults, charge-offs, or loss provisions are increasing.',
    'Financials',
    'Include worsening consumer, corporate, real-estate, or private-credit performance.',
    'Exclude normal seasonal movements and growth-driven reserve increases without deterioration.',
    array['delinquencies and net charge-offs increased'],
    array['loan balances grew while loss rates remained stable']
  ),
  (
    'narrative:def:refinancing-risk:v1', 'refinancing-risk', 1,
    'Refinancing Risk',
    'Borrowers face greater difficulty or cost when refinancing maturing debt.',
    'Credit',
    'Include maturity walls, higher refinancing coupons, restricted market access, covenant pressure, or extension activity.',
    'Exclude routine debt issuance with ample liquidity and unchanged terms.',
    array['upcoming maturities must be refinanced at materially higher rates'],
    array['the issuer refinanced early at similar terms']
  ),
  (
    'narrative:def:deal-activity-recovery:v1', 'deal-activity-recovery', 1,
    'Deal Activity Recovery',
    'Mergers, acquisitions, IPOs, underwriting, or advisory activity is recovering from depressed levels.',
    'Capital Markets',
    'Include improving pipelines, completed volumes, client engagement, or reopening issuance windows.',
    'Exclude commentary about a single transaction with no broader activity signal.',
    array['the advisory pipeline and announced M&A volumes are rebuilding'],
    array['the company completed one previously announced acquisition']
  ),
  (
    'narrative:def:supply-chain-normalization:v1', 'supply-chain-normalization', 1,
    'Supply Chain Normalization',
    'Availability, lead times, freight, inventories, or supplier reliability are returning toward normal conditions.',
    'Cross-sector',
    'Include easing shortages, shorter lead times, normalized logistics, or inventory rebalancing.',
    'Exclude isolated supplier changes without evidence of broader normalization.',
    array['lead times and freight costs returned toward pre-disruption levels'],
    array['the company selected a new component vendor']
  ),
  (
    'narrative:def:energy-demand-growth:v1', 'energy-demand-growth', 1,
    'Energy Demand Growth',
    'Electricity, natural-gas, or fuel demand is accelerating because of economic activity, electrification, or data-center load.',
    'Energy',
    'Include load forecasts, consumption growth, capacity needs, or infrastructure constraints.',
    'Exclude price changes without evidence of physical demand growth.',
    array['data centers are materially increasing regional power demand'],
    array['oil prices rose following a geopolitical headline']
  )
on conflict (slug, version) do nothing;
