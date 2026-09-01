"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CandidateAction = "promote" | "reject" | "merge";

export function CandidateActions({
  id,
  qualified,
  requiresOverrideNote,
  mergeTargets
}: {
  id: string;
  qualified: boolean;
  requiresOverrideNote: boolean;
  mergeTargets: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [targetId, setTargetId] = useState(mergeTargets[0]?.id ?? "");
  const [pending, setPending] = useState<CandidateAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: CandidateAction) {
    if (action === "promote" && requiresOverrideNote && !note.trim()) {
      setError("Explain why the automatic validation blockers should be overridden.");
      return;
    }
    setPending(action);
    setError(null);
    try {
      const response = await fetch("/api/narrative-candidates/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          targetId: action === "merge" ? targetId : undefined,
          note
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Candidate review failed.");
      }
      router.refresh();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error ? reviewError.message : String(reviewError)
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="candidate-actions">
      <label>
        Review note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this should be tracked, rejected, or merged"
          rows={2}
        />
      </label>
      <div className="button-row">
        <button
          className="button"
          disabled={!qualified || pending !== null}
          onClick={() => submit("promote")}
          type="button"
        >
          {pending === "promote"
            ? "Promoting…"
            : requiresOverrideNote
              ? "Promote with override"
              : "Approve & track"}
        </button>
        <button
          className="button danger"
          disabled={pending !== null}
          onClick={() => submit("reject")}
          type="button"
        >
          {pending === "reject" ? "Rejecting…" : "Reject candidate"}
        </button>
      </div>
      {!qualified ? (
        <p className="warning-text">
          Promotion unlocks after evidence from two independent publisher groups.
        </p>
      ) : null}
      {requiresOverrideNote ? (
        <p className="warning-text">
          Automatic validation blocked this candidate. Manual promotion requires
          an explicit override reason.
        </p>
      ) : null}
      {mergeTargets.length > 0 ? (
        <div className="candidate-merge">
          <label>
            Merge duplicate into
            <select
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {mergeTargets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={!targetId || pending !== null}
            onClick={() => submit("merge")}
            type="button"
          >
            {pending === "merge" ? "Merging…" : "Merge duplicate"}
          </button>
        </div>
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
