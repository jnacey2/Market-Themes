import Link from "next/link";
import {
  getNarrativeCandidateQueue,
  type NarrativeCandidateSummary
} from "@market-themes/db";
import { CandidateActions } from "./CandidateActions";

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
            Three score-90 documents from three independent publisher groups
            promote automatically. Two-source candidates remain available for
            manual review.
          </p>
        </div>
      </section>

      <section className="grid four">
        <Metric label="Pending" value={queue.pendingCount} />
        <Metric label="Ready to promote" value={queue.qualifiedCount} />
        <Metric label="Promoted" value={queue.approvedCount} />
        <Metric label="Rejected / merged" value={queue.rejectedCount + queue.mergedCount} />
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
          <span className="pill">{candidate.category}</span>
        </div>
        <p className="eyebrow">{candidate.clusterKey}</p>
        <h2>{candidate.name}</h2>
        <p className="candidate-proposition">{candidate.proposition}</p>
        <div className="candidate-breadth">
          <Metric label="Recent documents" value={candidate.documentBreadth} compact />
          <Metric label="Publisher groups" value={candidate.publisherOwnerBreadth} compact />
          <Metric label="Source classes" value={candidate.sourceClassBreadth} compact />
          <Metric label="Entities" value={candidate.entityBreadth} compact />
        </div>
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
              </div>
              <a href={evidence.url} rel="noreferrer" target="_blank">Open source</a>
            </div>
          ))}
        </div>
        {candidate.status === "approved" && candidate.promotedDefinitionId ? (
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
          mergeTargets={mergeTargets}
        />
      ) : (
        <div className="candidate-actions">
          <span className="label">Review note</span>
          <p>{candidate.reviewNote || "Promoted from reviewed candidate evidence."}</p>
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
