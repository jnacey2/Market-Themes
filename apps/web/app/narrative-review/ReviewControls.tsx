"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NarrativeReviewStatus } from "@market-themes/db";

export function ReviewControls({
  id,
  currentStatus
}: {
  id: string;
  currentStatus: NarrativeReviewStatus;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<NarrativeReviewStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(status: "approved" | "rejected") {
    setPending(status);
    setError(null);
    try {
      const response = await fetch("/api/narrative-observations/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, note })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Review failed.");
      }
      router.refresh();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="review-controls">
      <label>
        Review note
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional rationale or correction"
          rows={2}
        />
      </label>
      <div className="button-row">
        <button
          className="button"
          disabled={pending !== null || currentStatus === "approved"}
          onClick={() => review("approved")}
          type="button"
        >
          {pending === "approved" ? "Approving…" : "Approve evidence"}
        </button>
        <button
          className="button danger"
          disabled={pending !== null || currentStatus === "rejected"}
          onClick={() => review("rejected")}
          type="button"
        >
          {pending === "rejected" ? "Rejecting…" : "Reject match"}
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
