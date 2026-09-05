import { createDatabaseClient } from "./persistence";
import {
  getNarrativeChangeReport,
  getNarrativeHomepageStatus,
  labelState
} from "./narratives";
import type {
  BriefSection,
  NarrativeChange,
  NarrativeChangeReport,
  NarrativeHomepageItem,
  NarrativeHomepageStatus,
  StoredBrief
} from "./types";

export type DailyBriefDraft = {
  date: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  narrativeDefinitionIds: string[];
};

export type NarrativeAlertInput = {
  narrativeDefinitionId: string;
  alertDate: string;
  alertType: string;
  severity: "info" | "notice" | "warning";
  reason: string;
  metadata?: Record<string, unknown>;
};

/**
 * Deterministic brief: every sentence is derived from stored measurements, so the text
 * is a summary of evidence rather than model synthesis.
 */
export function buildDailyBrief(
  lanes: NarrativeHomepageStatus["lanes"],
  report: Pick<NarrativeChangeReport, "changes" | "currentDate" | "previousDate" | "stateCounts">,
  date: string
): DailyBriefDraft {
  // The emerging lane deliberately shows probationary and recently activated
  // narratives even before their window has coverage. A brief must not describe
  // those as measured, so only a lane item whose own state is measured can lead.
  const isMeasured = (item: NarrativeHomepageItem) =>
    item.lifecycleState !== "unmeasured";
  const lead =
    lanes.rising.find(isMeasured) ??
    lanes.peaking.find(isMeasured) ??
    lanes.emerging.find((item) => item.lifecycleState === "emerging") ??
    null;
  const fadingLead = lanes.fading.find(isMeasured) ?? null;
  const unmeasuredCount = report.stateCounts.unmeasured ?? 0;
  const headline = lead
    ? `${lead.name} is ${lead.lifecycleState === "rising" ? "gaining attention" : lead.lifecycleState === "peaking" ? "at peak attention" : "newly measurable"}${
        fadingLead ? `; ${fadingLead.name} is fading` : ""
      }.`
    : fadingLead
      ? `${fadingLead.name} is fading; no narrative is currently rising.`
      : unmeasuredCount > 0
        ? `No narrative is measured yet; ${unmeasuredCount} ${unmeasuredCount === 1 ? "narrative is" : "narratives are"} awaiting classification coverage.`
        : "No measured narrative movement to report.";

  const summaryParts: string[] = [];
  if (unmeasuredCount > 0) {
    summaryParts.push(
      `${unmeasuredCount} ${unmeasuredCount === 1 ? "narrative has" : "narratives have"} incomplete classification coverage for the current window and ${unmeasuredCount === 1 ? "is" : "are"} not measured.`
    );
  }
  if (lead) {
    summaryParts.push(
      `${lead.name}: reviewed density ${lead.density.toFixed(1)}% (${signed(lead.change)} vs prior week), raw attention z ${lead.attentionZScore.toFixed(1)}, ${lead.storyBreadth} unique stories across ${lead.publisherOwnerBreadth} publisher groups.`
    );
  }
  if (fadingLead) {
    summaryParts.push(`${fadingLead.name}: ${describePeakPosition(fadingLead, "long")}.`);
  }
  const transitions = report.changes.filter((change) => change.kind === "state_change");
  if (transitions.length > 0) {
    summaryParts.push(
      `${transitions.length} lifecycle ${transitions.length === 1 ? "transition" : "transitions"} since ${report.previousDate ?? "the previous measurement"}.`
    );
  }
  const counts = report.stateCounts;
  summaryParts.push(
    `Board: ${counts.rising} rising, ${counts.peaking} peaking, ${counts.steady} steady, ${counts.fading} fading, ${counts.emerging} emerging, ${counts.dormant} dormant.`
  );

  const sections: BriefSection[] = [
    section("Rising", lanes.rising, (item) =>
      `${item.name} — density ${item.density.toFixed(1)}% (${signed(item.change)}), attention z ${item.attentionZScore.toFixed(1)}, ${item.storyBreadth} stories.`
    ),
    section("Peaking", lanes.peaking, (item) =>
      `${item.name} — ${item.percentOfPeak.toFixed(0)}% of 90-day peak, change ${signed(item.change)}.`
    ),
    section("Fading", lanes.fading, (item) =>
      `${item.name} — ${describePeakPosition(item, "short")}, change ${signed(item.change)}.`
    ),
    section("New and probationary", lanes.emerging, (item) =>
      `${item.name} — ${item.attentionMatchedDocuments} classifier matches, ${item.matchedDocuments} reviewed, ${item.status === "probationary" ? "probationary" : "building baseline"}.`
    ),
    {
      title: "What changed",
      items: report.changes
        .filter((change) => change.kind !== "mover")
        .slice(0, 8)
        .map(describeChange)
    }
  ].filter((entry) => entry.items.length > 0);

  const narrativeDefinitionIds = [
    ...new Set(
      [...lanes.rising, ...lanes.peaking, ...lanes.fading, ...lanes.emerging].map(
        (item) => item.id
      )
    )
  ];

  return {
    date,
    headline,
    summary: summaryParts.join(" "),
    sections,
    narrativeDefinitionIds
  };
}

export function deriveNarrativeAlerts(
  report: Pick<NarrativeChangeReport, "changes" | "currentDate">,
  lanes: NarrativeHomepageStatus["lanes"]
): NarrativeAlertInput[] {
  if (!report.currentDate) return [];
  const alerts: NarrativeAlertInput[] = [];
  for (const change of report.changes) {
    if (change.kind === "state_change" && change.currentState) {
      const severity =
        change.currentState === "fading" || change.currentState === "rising"
          ? "warning"
          : "notice";
      alerts.push({
        narrativeDefinitionId: change.narrativeDefinitionId,
        alertDate: report.currentDate,
        alertType: `state:${change.currentState}`,
        severity,
        reason: `${change.name}: ${change.detail}`,
        metadata: {
          previousState: change.previousState,
          currentState: change.currentState,
          change: change.change
        }
      });
    } else if (change.kind === "new_definition") {
      alerts.push({
        narrativeDefinitionId: change.narrativeDefinitionId,
        alertDate: report.currentDate,
        alertType: "new_definition",
        severity: "notice",
        reason: `${change.name} was activated and is now measured.`
      });
    } else if (change.kind === "mover" && Math.abs(change.change) >= 3) {
      alerts.push({
        narrativeDefinitionId: change.narrativeDefinitionId,
        alertDate: report.currentDate,
        alertType: change.change > 0 ? "surge" : "drop",
        severity: "warning",
        reason: `${change.name}: ${change.detail}`,
        metadata: { change: change.change }
      });
    }
  }
  for (const item of lanes.rising) {
    if (item.attentionZScore >= 2.5) {
      alerts.push({
        narrativeDefinitionId: item.id,
        alertDate: report.currentDate,
        alertType: "unusual_attention",
        severity: "warning",
        reason: `${item.name}: raw attention z-score ${item.attentionZScore.toFixed(1)} is unusual versus its own history.`,
        metadata: { attentionZScore: item.attentionZScore, density: item.density }
      });
    }
  }
  return alerts;
}

export async function generateDailyBrief(
  options: { date?: string } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<{
  brief: StoredBrief | null;
  alertsWritten: number;
  skipped: boolean;
  reason?: string;
}> {
  if (!databaseUrl) {
    return { brief: null, alertsWritten: 0, skipped: true, reason: "DATABASE_URL is not set" };
  }
  const [homepage, report] = await Promise.all([
    getNarrativeHomepageStatus(databaseUrl),
    getNarrativeChangeReport(databaseUrl)
  ]);
  const date = options.date ?? report.currentDate ?? new Date().toISOString().slice(0, 10);
  if (!homepage.latestDate && !report.currentDate) {
    return {
      brief: null,
      alertsWritten: 0,
      skipped: true,
      reason: "No published narrative measurements yet"
    };
  }
  const draft = buildDailyBrief(homepage.lanes, report, date);
  const alerts = deriveNarrativeAlerts(report, homepage.lanes);
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    await client.query("begin");
    const stored = await client.query<{
      id: string;
      brief_date: string;
      headline: string;
      summary: string;
      sections: BriefSection[];
      generated_at: string;
    }>(
      `insert into briefs (
         id, brief_date, headline, summary, sections, narrative_definition_ids, generated_at
       ) values ($1, $2::date, $3, $4, $5::jsonb, $6::text[], now())
       on conflict (brief_date) do update set
         headline = excluded.headline,
         summary = excluded.summary,
         sections = excluded.sections,
         narrative_definition_ids = excluded.narrative_definition_ids,
         generated_at = now()
       returning id, brief_date::text, headline, summary, sections, generated_at::text`,
      [
        `brief:${draft.date}`,
        draft.date,
        draft.headline,
        draft.summary,
        JSON.stringify(draft.sections),
        draft.narrativeDefinitionIds
      ]
    );
    let alertsWritten = 0;
    for (const alert of alerts) {
      const result = await client.query(
        `insert into narrative_alerts (
           id, narrative_definition_id, alert_date, alert_type, severity, reason, metadata
         ) values ($1, $2, $3::date, $4, $5, $6, $7::jsonb)
         on conflict (narrative_definition_id, alert_date, alert_type) do nothing`,
        [
          `narrative:alert:${alert.narrativeDefinitionId}:${alert.alertDate}:${alert.alertType}`,
          alert.narrativeDefinitionId,
          alert.alertDate,
          alert.alertType,
          alert.severity,
          alert.reason,
          JSON.stringify(alert.metadata ?? {})
        ]
      );
      alertsWritten += result.rowCount ?? 0;
    }
    await client.query("commit");
    const row = stored.rows[0];
    return {
      brief: {
        id: row.id,
        date: row.brief_date,
        headline: row.headline,
        summary: row.summary,
        sections: row.sections,
        generatedAt: row.generated_at
      },
      alertsWritten,
      skipped: false
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

export type NarrativeAlertSummary = NarrativeAlertInput & {
  id: string;
  narrativeName: string;
  narrativeSlug: string;
  createdAt: string;
  acknowledgedAt: string | null;
};

export async function listRecentNarrativeAlerts(
  options: { days?: number; limit?: number } = {},
  databaseUrl = process.env.DATABASE_URL
): Promise<NarrativeAlertSummary[]> {
  if (!databaseUrl) return [];
  const client = createDatabaseClient(databaseUrl);
  await client.connect();
  try {
    const result = await client.query<{
      id: string;
      narrative_definition_id: string;
      alert_date: string;
      alert_type: string;
      severity: NarrativeAlertInput["severity"];
      reason: string;
      metadata: Record<string, unknown>;
      created_at: string;
      acknowledged_at: string | null;
      name: string;
      slug: string;
    }>(
      `select na.id, na.narrative_definition_id, na.alert_date::text, na.alert_type,
              na.severity, na.reason, na.metadata, na.created_at::text,
              na.acknowledged_at::text, nd.name, nd.slug
       from narrative_alerts na
       join narrative_definitions nd on nd.id = na.narrative_definition_id
       where na.alert_date >= current_date - ($1::int || ' days')::interval
       order by na.alert_date desc,
                case na.severity when 'warning' then 0 when 'notice' then 1 else 2 end,
                nd.name
       limit $2`,
      [options.days ?? 7, options.limit ?? 50]
    );
    return result.rows.map((row) => ({
      id: row.id,
      narrativeDefinitionId: row.narrative_definition_id,
      narrativeName: row.name,
      narrativeSlug: row.slug,
      alertDate: row.alert_date,
      alertType: row.alert_type,
      severity: row.severity,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at
    }));
  } finally {
    await client.end();
  }
}

function section(
  title: string,
  items: NarrativeHomepageItem[],
  describe: (item: NarrativeHomepageItem) => string
): BriefSection {
  return { title, items: items.slice(0, 5).map(describe) };
}

function describeChange(change: NarrativeChange) {
  switch (change.kind) {
    case "new_definition":
      return `New: ${change.name}. ${change.detail}`;
    case "state_change":
      return `${change.name}: ${labelState(change.previousState)} → ${labelState(change.currentState)}.`;
    case "entered_board":
      return `${change.name} entered the measured board.`;
    case "left_board":
      return `${change.name} left the measured board (coverage incomplete).`;
    case "expired_definition":
      return `${change.name} expired.`;
    case "mover":
    default:
      return `${change.name}: ${change.detail}`;
  }
}

/**
 * "0% of its 90-day peak" reads as missing data; say what actually happened.
 */
export function describePeakPosition(
  item: { density: number; percentOfPeak: number; daysSincePeak: number | null },
  style: "short" | "long"
) {
  const since =
    item.daysSincePeak === null
      ? ""
      : style === "long"
        ? `, ${item.daysSincePeak} ${item.daysSincePeak === 1 ? "day" : "days"} past peak`
        : `, peak ${item.daysSincePeak}d ago`;
  if (item.density <= 0) {
    return `no approved coverage this week${since}`;
  }
  return `${item.percentOfPeak.toFixed(0)}% of ${style === "long" ? "its 90-day peak" : "peak"}${since}`;
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
