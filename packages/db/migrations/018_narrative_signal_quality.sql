alter table narrative_definitions
  add column if not exists parent_definition_id text
    references narrative_definitions(id);

alter table narrative_definitions
  add column if not exists merged_into_definition_id text
    references narrative_definitions(id);

alter table narrative_definitions
  add column if not exists dimension text;

alter table narrative_definitions
  add column if not exists event_expires_at timestamptz;

alter table narrative_definitions
  add column if not exists activated_at timestamptz;

update narrative_definitions
set activated_at = coalesce(activated_at, created_at)
where status = 'active';

create index if not exists narrative_definitions_parent_idx
  on narrative_definitions (parent_definition_id, status);

create index if not exists narrative_definitions_merged_into_idx
  on narrative_definitions (merged_into_definition_id)
  where merged_into_definition_id is not null;

create index if not exists narrative_definitions_event_expiry_idx
  on narrative_definitions (event_expires_at)
  where kind = 'event' and status in ('probationary', 'active');

alter table narrative_trends
  add column if not exists story_breadth integer not null default 0;

alter table narrative_trends
  add column if not exists corpus_eligible_documents integer not null default 0;

alter table narrative_trends
  add column if not exists classified_documents integer not null default 0;

alter table narrative_trends
  add column if not exists classification_coverage_pct numeric not null default 0;

alter table narrative_trends
  add column if not exists coverage_state text not null default 'no_corpus';

update narrative_trends
set corpus_eligible_documents = eligible_documents,
    classified_documents = eligible_documents,
    classification_coverage_pct =
      case when eligible_documents > 0 then 100 else 0 end,
    coverage_state =
      case
        when eligible_documents = 0 then 'no_corpus'
        when matched_documents = 0 then 'measured_zero'
        else 'measured'
      end;

update documents d
set publisher_owner = case
      when dt.content ~* '(^|[(:—-][[:space:]]*)Reuters([[:space:]]*[):—-]|$)'
        or dt.content ~* '\mReuters reported\M'
        then 'reuters'
      when dt.content ~* '(^|[(:—-][[:space:]]*)(Associated Press|AP)([[:space:]]*[):—-]|$)'
        or dt.content ~* '\m(Associated Press|the AP) reported\M'
        then 'associated-press'
      when dt.content ~* '(^|[(:—-][[:space:]]*)AFP([[:space:]]*[):—-]|$)'
        or dt.content ~* '\mAFP reported\M'
        then 'afp'
      else d.publisher_owner
    end,
    metadata = d.metadata || jsonb_build_object(
      'wireOrigin',
      case
        when dt.content ~* '(^|[(:—-][[:space:]]*)Reuters([[:space:]]*[):—-]|$)'
          or dt.content ~* '\mReuters reported\M'
          then 'reuters'
        when dt.content ~* '(^|[(:—-][[:space:]]*)(Associated Press|AP)([[:space:]]*[):—-]|$)'
          or dt.content ~* '\m(Associated Press|the AP) reported\M'
          then 'associated-press'
        when dt.content ~* '(^|[(:—-][[:space:]]*)AFP([[:space:]]*[):—-]|$)'
          or dt.content ~* '\mAFP reported\M'
          then 'afp'
      end
    )
from document_texts dt
where dt.document_id = d.id
  and d.source_class = 'newspaper'
  and (
    dt.content ~* '(^|[(:—-][[:space:]]*)(Reuters|Associated Press|AP|AFP)([[:space:]]*[):—-]|$)'
    or dt.content ~* '\m(Reuters|Associated Press|the AP|AFP) reported\M'
  );

insert into narrative_definitions (
  id, slug, version, name, proposition, category,
  inclusion_guidance, exclusion_guidance, positive_examples,
  negative_examples, status, kind, event_label, metadata,
  parent_definition_id, dimension, activated_at
) values (
  'narrative:def:geopolitical-energy-shock-family:v1',
  'geopolitical-energy-shock',
  1,
  'Geopolitical Energy Shock',
  'Geopolitical conflict is disrupting energy supply and transmitting into inflation, monetary-policy expectations, or cross-asset repricing.',
  'Macro',
  'This is a family for separately measured supply, inflation-and-rates, and cross-asset consequences.',
  'Do not classify documents directly against this family record.',
  '{}',
  '{}',
  'family',
  'structural',
  null,
  '{"familyOnly":true,"dimensions":["supply disruption","inflation and rates","cross-asset repricing"]}'::jsonb,
  null,
  'family',
  now()
)
on conflict (slug, version) do update set
  name = excluded.name,
  proposition = excluded.proposition,
  status = 'family',
  metadata = narrative_definitions.metadata || excluded.metadata,
  dimension = 'family',
  updated_at = now();

insert into narrative_definitions (
  id, slug, version, name, proposition, category,
  inclusion_guidance, exclusion_guidance, positive_examples,
  negative_examples, status, kind, event_label, metadata,
  parent_definition_id, dimension, event_expires_at
) values
  (
    'narrative:def:geopolitical-energy-supply-risk:v1',
    'geopolitical-energy-supply-risk',
    1,
    'Geopolitical Energy Supply Risk',
    'Military conflict or state action is disrupting, or credibly threatening to disrupt, oil and gas production or shipping routes.',
    'Energy',
    'Require a specific conflict or state action, a named supply channel or shipping route, and direct evidence of actual or threatened energy-flow disruption.',
    'Exclude generic geopolitical tension without a concrete energy-supply transmission channel.',
    array['Attacks near the Strait of Hormuz reduced tanker traffic and lifted crude prices.'],
    array['Middle East tensions remain elevated.'],
    'probationary',
    'event',
    'US-Iran conflict and Strait of Hormuz supply risk',
    '{"origin":"quality_consolidation","evidenceContract":{"requiredTermGroups":[["iran","hormuz","military","conflict","strike"],["oil","crude","energy","tanker"],["supply","shipping","flow","production","disruption","risk"]]}}'::jsonb,
    'narrative:def:geopolitical-energy-shock-family:v1',
    'supply disruption',
    '2026-10-02T23:59:59Z'
  ),
  (
    'narrative:def:energy-shock-inflation-rates:v1',
    'energy-shock-inflation-rates',
    1,
    'Energy Shock Reprices Inflation And Rates',
    'Rising energy prices are lifting inflation expectations and causing markets or central banks to reprice the path of interest rates.',
    'Macro',
    'Require explicit evidence linking higher oil or energy prices to inflation expectations and to rate-hike, tightening, or monetary-policy repricing.',
    'Exclude oil moves without the inflation channel, and inflation commentary without an explicit rates consequence.',
    array['Higher crude prices revived inflation fears and lifted the market-implied probability of a rate hike.'],
    array['Oil rose after renewed fighting.'],
    'probationary',
    'event',
    'Energy-price shock and monetary-policy repricing',
    '{"origin":"quality_consolidation","evidenceContract":{"requiredTermGroups":[["oil","crude","energy"],["inflation"],["rate hike","hike bets","tightening","monetary policy","interest rate"]]}}'::jsonb,
    'narrative:def:geopolitical-energy-shock-family:v1',
    'inflation and rates',
    '2026-10-02T23:59:59Z'
  ),
  (
    'narrative:def:energy-shock-cross-asset-repricing:v1',
    'energy-shock-cross-asset-repricing',
    1,
    'Energy Shock Drives Cross-Asset Repricing',
    'An energy-price shock is simultaneously pushing sovereign yields higher and pressuring equities or other rate-sensitive assets.',
    'Cross-sector',
    'Require higher oil or energy prices, higher sovereign bond yields, and a contemporaneous decline in equities, gold, or another named rate-sensitive asset.',
    'Exclude isolated moves in only one asset class and exclude generic risk-off commentary without the energy and yields linkage.',
    array['Oil surged, Treasury yields rose, and major equity indexes declined in the same session.'],
    array['Stocks fell amid geopolitical uncertainty.'],
    'probationary',
    'event',
    'Energy shock and cross-asset market repricing',
    '{"origin":"quality_consolidation","evidenceContract":{"requiredTermGroups":[["oil","crude","energy"],["bond","treasury","yield"],["stock","equity","equities","dow","nasdaq","s&p","gold"]]}}'::jsonb,
    'narrative:def:geopolitical-energy-shock-family:v1',
    'cross-asset repricing',
    '2026-10-02T23:59:59Z'
  )
on conflict (slug, version) do update set
  name = excluded.name,
  proposition = excluded.proposition,
  inclusion_guidance = excluded.inclusion_guidance,
  exclusion_guidance = excluded.exclusion_guidance,
  metadata = narrative_definitions.metadata || excluded.metadata,
  parent_definition_id = excluded.parent_definition_id,
  dimension = excluded.dimension,
  event_expires_at = excluded.event_expires_at,
  updated_at = now();

with invalid_observations as (
  select no.id
  from narrative_observations no
  join narrative_definitions nd on nd.id = no.narrative_definition_id
  where nd.slug = 'oil-inflation-fed-hike-bond-selloff'
    and no.review_status = 'approved'
    and not (
      lower(no.evidence_snippet) ~ '(oil|crude|energy)'
      and lower(no.evidence_snippet) ~ 'inflation'
      and lower(no.evidence_snippet) ~ '(fed|federal reserve)'
      and lower(no.evidence_snippet) ~ '(rate.?hike|hike bets|tighten|fed.{0,30}hike|hike.{0,30}fed)'
      and lower(no.evidence_snippet) ~ '(bond|treasury|yield)'
      and lower(no.evidence_snippet) ~ '(stock|equity|equities|dow|nasdaq|s&p)'
    )
)
insert into narrative_review_events (
  id, observation_id, observation_key, previous_status, new_status,
  actor_type, review_note, metadata
)
select
  'narrative:review-event:quality-rereview:' || md5(id),
  id,
  id,
  'approved',
  'rejected',
  'system',
  'Rejected during contract-completeness re-review: the quotation does not contain every required causal leg.',
  '{"policyVersion":"narrative_signal_quality_v1"}'::jsonb
from invalid_observations
on conflict (id) do nothing;

update narrative_observations no
set review_status = 'rejected',
    reviewed_at = now(),
    review_note = 'Rejected during contract-completeness re-review: the quotation does not contain every required causal leg.',
    metadata = (no.metadata - 'reviewProvenance') ||
      jsonb_build_object(
        'reviewProvenance',
        jsonb_build_object(
          'actorType', 'system',
          'reviewedAt', now(),
          'policyVersion', 'narrative_signal_quality_v1'
        )
      )
from narrative_definitions nd
where nd.id = no.narrative_definition_id
  and nd.slug = 'oil-inflation-fed-hike-bond-selloff'
  and no.review_status = 'approved'
  and not (
    lower(no.evidence_snippet) ~ '(oil|crude|energy)'
    and lower(no.evidence_snippet) ~ 'inflation'
    and lower(no.evidence_snippet) ~ '(fed|federal reserve)'
    and lower(no.evidence_snippet) ~ '(rate.?hike|hike bets|tighten|fed.{0,30}hike|hike.{0,30}fed)'
    and lower(no.evidence_snippet) ~ '(bond|treasury|yield)'
    and lower(no.evidence_snippet) ~ '(stock|equity|equities|dow|nasdaq|s&p)'
  );

with consolidated as (
  update narrative_definitions
  set status = 'merged',
      parent_definition_id = 'narrative:def:geopolitical-energy-shock-family:v1',
      merged_into_definition_id = case
        when slug in ('iran-us-conflict-oil-spike', 'us-iran-escalation-middle-east')
          then 'narrative:def:geopolitical-energy-supply-risk:v1'
        when slug like '%inflation%fed%hike%'
          then 'narrative:def:energy-shock-inflation-rates:v1'
        else 'narrative:def:energy-shock-cross-asset-repricing:v1'
      end,
      dimension = case
        when slug in ('iran-us-conflict-oil-spike', 'us-iran-escalation-middle-east')
          then 'supply disruption'
        when slug like '%inflation%fed%hike%'
          then 'inflation and rates'
        else 'cross-asset repricing'
      end,
      metadata = metadata || jsonb_build_object(
        'consolidation',
        jsonb_build_object(
          'actorType', 'system',
          'reason', 'Consolidated into the Geopolitical Energy Shock family so supply, inflation-and-rates, and cross-asset effects are measured separately.',
          'parentDefinitionId', 'narrative:def:geopolitical-energy-shock-family:v1',
          'mergedIntoDefinitionId', case
            when slug in ('iran-us-conflict-oil-spike', 'us-iran-escalation-middle-east')
              then 'narrative:def:geopolitical-energy-supply-risk:v1'
            when slug like '%inflation%fed%hike%'
              then 'narrative:def:energy-shock-inflation-rates:v1'
            else 'narrative:def:energy-shock-cross-asset-repricing:v1'
          end,
          'at', now()
        )
      ),
      updated_at = now()
  where status in ('active', 'probationary')
    and (
      slug in (
        'iran-us-conflict-oil-spike',
        'us-iran-escalation-middle-east',
        'oil-inflation-fed-hike-bond-selloff',
        'geopolitical-oil-shock-inflation-fed-hike',
        'geopolitical-oil-shock-revives-inflation-fed-hike-path',
        'global-bond-rout-2008-yields'
      )
      or lower(name) in (
        'iran-us conflict oil spike',
        'us-iran escalation middle east',
        'oil inflation fed hike bond selloff',
        'geopolitical oil shock revives inflation-fed hike path',
        'global bond rout 2008 yields'
      )
    )
  returning id
)
insert into narrative_definition_events (
  id, narrative_definition_id, action, actor_type, reason, metadata
)
select
  'narrative:definition:event:quality-consolidation:' || md5(id),
  id,
  'consolidated',
  'system',
  'Consolidated overlapping geopolitical energy narratives into one family with separately measured dimensions.',
  '{"policyVersion":"narrative_signal_quality_v1"}'::jsonb
from consolidated
on conflict (id) do nothing;

with retracted as (
  update narrative_definitions
  set status = 'inactive',
      metadata = metadata || jsonb_build_object(
        'retraction',
        jsonb_build_object(
          'actorType', 'system',
          'reason', 'The proposition overstated US ownership, field status, and certainty of Strategic Petroleum Reserve replenishment.',
          'at', now()
        )
      ),
      updated_at = now()
  where slug = 'us-venezuela-oil-partnership'
    and status in ('active', 'probationary')
  returning id
)
insert into narrative_definition_events (
  id, narrative_definition_id, action, actor_type, reason, metadata
)
select
  'narrative:definition:event:venezuela-correction:' || md5(id),
  id,
  'retracted',
  'system',
  'Retracted because the proposition overstated ownership, field status, and certainty of SPR replenishment.',
  '{"policyVersion":"narrative_signal_quality_v1"}'::jsonb
from retracted
on conflict (id) do nothing;

insert into narrative_definitions (
  id, slug, version, name, proposition, category,
  inclusion_guidance, exclusion_guidance, positive_examples,
  negative_examples, status, kind, event_label, metadata,
  dimension, event_expires_at
) values (
  'narrative:def:us-venezuela-oil-partnership:v2',
  'us-venezuela-oil-partnership',
  2,
  'US-Backed Venezuela Oil Concessions',
  'Venezuela granted long-term concessions for 17 oil fields to a US-backed producer; the US government holds a 35% parent-company stake and preferential oil-purchase rights that could support future strategic-reserve purchases.',
  'Energy',
  'Require the 17-field concessions, the 35% US government stake, and preferential offtake or purchase rights. Describe SPR replenishment as an objective or possibility, not a guaranteed outcome.',
  'Exclude claims of majority US equity ownership, claims that all fields are untapped, and claims that production or SPR replenishment is assured.',
  array['The US holds a 35% parent-company stake and rights to purchase part of future production.'],
  array['The US owns a majority of the venture and will refill the SPR.'],
  'probationary',
  'event',
  'US-backed Venezuelan oil concessions announced in August 2026',
  '{"origin":"quality_correction","evidenceContract":{"requiredTermGroups":[["venezuela"],["17","seventeen"],["35%","35 percent"],["stake","equity"],["purchase","offtake","off-take","first refusal"]]}}'::jsonb,
  'supply diversification',
  '2026-10-02T23:59:59Z'
)
on conflict (slug, version) do nothing;

with probationary_events as (
  update narrative_definitions
  set status = 'probationary',
      kind = 'event',
      event_expires_at = coalesce(
        event_expires_at,
        case
          when slug = 'ecb-rate-hike-expectations'
            then '2026-09-12T23:59:59Z'::timestamptz
          else created_at + interval '30 days'
        end
      ),
      metadata = metadata || jsonb_build_object(
        'probation',
        jsonb_build_object(
          'actorType', 'system',
          'reason', 'Candidate-origin events require current-version unique-story breadth before publication.',
          'at', now()
        )
      ),
      updated_at = now()
  where status = 'active'
    and (
      slug in ('ecb-rate-hike-expectations', 'amazon-advertising-antitrust-risk')
      or (kind = 'event' and metadata ? 'candidateId')
    )
  returning id
)
insert into narrative_definition_events (
  id, narrative_definition_id, action, actor_type, reason, metadata
)
select
  'narrative:definition:event:probation:' || md5(id),
  id,
  'probation_started',
  'system',
  'Moved candidate-origin event to probation until current-version unique-story breadth is confirmed.',
  '{"policyVersion":"narrative_signal_quality_v1"}'::jsonb
from probationary_events
on conflict (id) do nothing;
