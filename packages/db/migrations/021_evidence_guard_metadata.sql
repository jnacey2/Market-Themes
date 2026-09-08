-- Move per-slug evidence guards out of code and into definition metadata.
-- Runtime reads metadata.evidenceContract.requiredPatterns / forbiddenPatterns
-- (case-insensitive regular expressions) so guards version with the definition.

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(price|pricing|average ticket|mix)","(demand|volume|transactions?|units?|traffic|elasticity)"],"forbiddenPatterns":["(declin|decreas|fell|falling|lower|weak).{0,45}(volume|transactions?|units?|traffic)"]}'::jsonb,
  true
)
where slug = 'pricing-power'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(pipeline|volumes?|activity|market|advisory|underwriting|issuance|ipos?|m&a)","(recover|rebound|reopen|improv|increas|accelerat|growth|stronger|higher)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'deal-activity-recovery'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(artificial intelligence|\\bai\\b)","\\b(demand|capacity|backlog|orders|load)\\b|infrastructure.{0,35}(invest|spend|build|deploy|expand)|(revenue|sales).{0,25}(grow|increas|up\\b)|(grow|increas|up\\b).{0,25}(revenue|sales)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'ai-infrastructure-demand'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(artificial intelligence|\\bai\\b|data cent(er|re))","(return|roi|utilization|discipline|restrain|moderat|efficien|budget)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'ai-capex-discipline'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(delinquen|default|charge.?off|loss provision|nonperform|credit quality)","(deteriorat|worsen|increas|higher|rise|rising|stress)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'credit-quality-deterioration'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(borrower|debt|maturit|refinanc)","(higher|cost|difficult|restrict|wall|pressure|risk)"],"forbiddenPatterns":["(reinvestment risk|callable note)"]}'::jsonb,
  true
)
where slug = 'refinancing-risk'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(gross margin|operating margin|profit margin)","(compress|pressure|declin|decreas|lower|contract)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'margin-pressure'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(consumer|customer|shopper|spending|purchase)","(trade.?down|value|afford|lower.?price|smaller|cautious|budget|selective)"],"forbiddenPatterns":[]}'::jsonb,
  true
)
where slug = 'consumer-trade-down'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(supply|inventory|lead time|freight|logistics|availability)","(normaliz|easing|shorter|improv|recover|rebalanc|declin)"],"forbiddenPatterns":["(disruption|shortage|constraint|ransomware)"]}'::jsonb,
  true
)
where slug = 'supply-chain-normalization'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;

update narrative_definitions
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{evidenceContract}',
  coalesce(metadata->'evidenceContract', '{}'::jsonb) || '{"requiredPatterns":["(demand|load|consumption)","(accelerat|expand|growth|increas|higher|record|rising)","(economic|industrial|electrif|electric vehicle|data cent(er|re)|artificial intelligence|\\bai\\b)"],"forbiddenPatterns":["(weather|temperature|summer|winter|heat wave|cold snap|cooling degree|heating degree)"]}'::jsonb,
  true
)
where slug = 'energy-demand-growth'
  and (metadata->'evidenceContract'->'requiredPatterns') is null;
