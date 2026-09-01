"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetractNarrativeButton({
  definitionId
}: {
  definitionId: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retract() {
    if (!reason.trim()) {
      setError("Enter the contract or evidence problem before retracting.");
      return;
    }
    if (!window.confirm("Remove this narrative from all public surfaces?")) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/narrative-definitions/retract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: definitionId, reason })
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Narrative retraction failed.");
      }
      router.refresh();
    } catch (retractionError) {
      setError(
        retractionError instanceof Error
          ? retractionError.message
          : String(retractionError)
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="candidate-retraction">
      <label>
        Retraction reason
        <textarea
          onChange={(event) => setReason(event.target.value)}
          placeholder="Contract violation, media echo, or overgeneralization"
          rows={2}
          value={reason}
        />
      </label>
      <button
        className="button danger"
        disabled={pending}
        onClick={() => void retract()}
        type="button"
      >
        {pending ? "Retracting…" : "Retract public narrative"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
