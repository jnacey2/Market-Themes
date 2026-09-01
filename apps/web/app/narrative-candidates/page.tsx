import Link from "next/link";
import {
  getNarrativeCandidateQueue,
  type NarrativeCandidateSummary
} from "@market-themes/db";
import { CandidateActions } from "./CandidateActions";
import { RetractNarrativeButton } from "./RetractNarrativeButton";

export const dynamic = "force-dynamic";

export default async function NarrativeCandidatesPage() {
  const queue = await getNarrativeCandidateQueue();
  const pendingCandidates = queue.candidates.filter(
    (candidate) => candidate.status === "pending"
  );
  const approvedCandidates = queue.candidates.filter(
    (candidate) => candidate.status === "approved"
  );

  return (
    <div className="shell wide-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Narrative Discovery</p>
          <h1>Candidate narratives.</h1>
          <p className="lede">
            New propositions found outside the fixed watchlist. Candidates need
            exact quotations from at least two independent publisher groups
            before they can become tracked narratives.
          </p>
        </div>
        <div className="panel">
          <p className="eyebrow">Discovery version</p>
          <h2>{queue.promptVersion}</h2>
          <p>
            Automatic promotion also validates media-echo deduplication,
            event/entity breadth, and every quotation against the candidate
            contract. Blocked candidates remain available for manual review.
          </p>
        </div>
      </section>

      <section className="grid four">
        <Metric label="Pending" value={queue.pendingCount} />
        <Metric label="Manual ready" value={queue.qualifiedCount} />
        <Metric label="Auto eligible" value={queue.autoEligibleCount} />
        <Metric label="Promoted" value={queue.approvedCount} />
      </section>

      <section className="section candidate-queue">
        <p className="eyebrow">Review Queue</p>
        {pendingCandidates.length === 0 ? (
          <div className="panel">
            <h2>No candidate narratives yet</h2>
            <p>
              The discovery worker will populate this queue as incoming
              documents support propositions outside the tracked watchlist.
            </p>
          </div>
        ) : (
          pendingCandidates.map((candidate) => (
            <CandidateCard
              candidate={candidate}
              key={candidate.id}
              mergeTargets={pendingCandidates
                .filter((target) => target.id !== candidate.id)
                .map((target) => ({ id: target.id, name: target.name }))}
            />
          ))
        )}
      </section>

      {approvedCandidates.length > 0 ? (
        <section className="section candidate-queue">
          <p className="eyebrow">Recently Promoted</p>
          {approvedCandidates.map((candidate) => (
            <CandidateCard
              candidate={candidate}
              key={candidate.id}
              mergeTargets={[]}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function CandidateCard({
  candidate,
  mergeTargets
}: {
  candidate: NarrativeCandidateSummary;
  mergeTargets: Array<{ id: string; name: string }>;
}) {
  return (
    <article className="panel candidate-card">
      <div className="candidate-main">
        <div className="pill-row">
          <span className={`pill review-${candidate.status}`}>
            {candidate.status}
          </span>
          <span className={`pill ${candidate.qualified ? "review-approved" : "warning-pill"}`}>
            {candidate.qualified ? "breadth confirmed" : "building breadth"}
          </span>
          <span className="pill">{candidate.kind}</span>
          {candidate.promotedDefinitionStatus === "inactive" ? (
            <span className="pill review-rejected">retracted</span>
          ) : null}
          <span className="pill">{candidate.category}</span>
        </div>
        <p className="eyebrow">{candidate.clusterKey}</p>
        <h2>{candidate.name}</h2>
        <p className="candidate-proposition">{candidate.proposition}</p>
        {candidate.eventLabel ? (
          <p><strong>Underlying event:</strong> {candidate.eventLabel}</p>
        ) : null}
        <div className="candidate-breadth">
          <Metric label="Recent documents" value={candidate.documentBreadth} compact />
          <Metric label="Publisher groups" value={candidate.publisherOwnerBreadth} compact />
          <Metric label="Source classes" value={candidate.sourceClassBreadth} compact />
          <Metric label="Entities" value={candidate.entityBreadth} compact />
        </div>
        {candidate.promotionValidation ? (
          <div className="eligibility-panel">
            <div className="pill-row">
              <span
                className={`pill ${
                  candidate.promotionValidation.status === "eligible"
                    ? "review-approved"
                    : "warning-pill"
                }`}
              >
                auto {candidate.promotionValidation.status.replaceAll("_", " ")}
              </span>
              <span className="pill">
                {candidate.promotionValidation.breadth.storyBreadth} unique stories
              </span>
              <span className="pill">
                {candidate.promotionValidation.breadth.eventBreadth} events
              </span>
              <span className="pill">
                {candidate.promotionValidation.breadth.primaryEntityBreadth} primary entities
              </span>
            </div>
            <p>{candidate.promotionValidation.summaryReason}</p>
            {candidate.promotionValidation.reasons.length > 0 ? (
              <ul className="blocker-list">
                {candidate.promotionValidation.reasons.map((reason) => (
                  <li key={reason}>{reason.replaceAll("_", " ").toLowerCase()}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : candidate.status === "pending" ? (
          <p className="warning-text">
            Awaiting promotion-time contract and media-echo validation.
          </p>
        ) : null}
        <details className="detail-block">
          <summary>Classification contract</summary>
          <p><strong>Include:</strong> {candidate.inclusionGuidance}</p>
          <p><strong>Exclude:</strong> {candidate.exclusionGuidance}</p>
        </details>
        <div className="candidate-evidence">
          {candidate.evidence.map((evidence) => (
            <div className="evidence-card" key={evidence.id}>
              <span className="label">
                {evidence.publisher} · {evidence.sourceClass.replaceAll("_", " ")} ·{" "}
                {formatDate(evidence.publishedAt)}
              </span>
              <h3>{evidence.title}</h3>
              <blockquote>{evidence.evidenceSnippet}</blockquote>
              <p>
                <span className="synthesis-label">Model interpretation</span>{" "}
                {evidence.interpretation}
              </p>
              <div className="pill-row">
                <span className="pill">score {evidence.matchScore.toFixed(0)}</span>
                <span className="pill">{evidence.publisherOwner}</span>
                {candidate.promotionValidation?.evidence.find(
                  (item) => item.evidenceId === evidence.id
                ) ? (
                  <span
                    className={`pill ${
                      candidate.promotionValidation.evidence.find(
                        (item) => item.evidenceId === evidence.id
                      )?.verdict === "support"
                        ? "review-approved"
                        : "review-rejected"
                    }`}
                  >
                    contract{" "}
                    {
                      candidate.promotionValidation.evidence.find(
                        (item) => item.evidenceId === evidence.id
                      )?.verdict
                    }
                  </span>
                ) : null}
              </div>
              <a href={evidence.url} rel="noreferrer" target="_blank">Open source</a>
            </div>
          ))}
        </div>
        {candidate.status === "approved" &&
        candidate.promotedDefinitionId &&
        candidate.promotedDefinitionStatus !== "inactive" ? (
          <div className="button-row">
            <Link
              className="button"
              href={`/themes/${encodeURIComponent(candidate.promotedDefinitionId)}`}
            >
              Open tracked narrative
            </Link>
          </div>
        ) : null}
      </div>
      {candidate.status === "pending" ? (
        <CandidateActions
          id={candidate.id}
          qualified={candidate.qualified}
          requiresOverrideNote={
            candidate.promotionValidation?.status === "ineligible"
          }
          mergeTargets={mergeTargets}
        />
      ) : (
        <div className="candidate-actions">
          <span className="label">Review note</span>
          <p>{candidate.reviewNote || "Promoted from reviewed candidate evidence."}</p>
          {candidate.promotedDefinitionId &&
          candidate.promotedDefinitionStatus === "active" ? (
            <RetractNarrativeButton
              definitionId={candidate.promotedDefinitionId}
            />
          ) : null}
        </div>
      )}
    </article>
  );
}

function Metric({
  label,
  value,
  compact = false
}: {
  label: string;
  value: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "metric compact-metric" : "panel"}>
      <span className="label">{label}</span>
      <h2>{value}</h2>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(
    new Date(value)
  );
}
