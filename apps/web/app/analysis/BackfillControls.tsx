"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BackfillControlStatus } from "@market-themes/db";

export function BackfillControls({ status }: { status: BackfillControlStatus }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const activeJob = status.activeJob;
  const canStop =
    activeJob?.status === "queued" ||
    activeJob?.status === "running" ||
    activeJob?.status === "stop_requested";
  const queuedForMs =
    activeJob?.status === "queued" ? Date.now() - new Date(activeJob.createdAt).getTime() : 0;

  async function runAction(endpoint: "/api/backfill/start" | "/api/backfill/stop") {
    setMessage(null);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(activeJob ? { jobId: activeJob.id } : {})
    });
    const body = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(body.error ?? "Backfill request failed.");
      return;
    }

    setMessage(endpoint.endsWith("/start") ? "Backfill queued." : stopActionMessage(activeJob?.status));
    startTransition(() => router.refresh());
  }

  return (
    <div className="panel">
      <div className="pill-row">
        <span className="pill">{activeJob ? activeJob.status : "idle"}</span>
        {activeJob ? <span className="pill">job {activeJob.id.slice(-8)}</span> : null}
        {activeJob ? <span className="pill">concurrency {activeJob.concurrency}</span> : null}
        {activeJob ? (
          <span className="pill">
            limit {activeJob.batchSize * activeJob.maxBatches} docs
          </span>
        ) : null}
      </div>
      <h2>Document Analysis Backfill</h2>
      <p>
        Start queues a controlled pass over up to 100 unread documents from the
        latest 30 days at concurrency 2. Stop is cooperative: the worker finishes
        any in-flight documents, then stops before selecting more.
      </p>

      {activeJob ? (
        <div className="grid four control-metrics">
          <MiniMetric label="Selected" value={activeJob.selectedDocuments} />
          <MiniMetric label="Completed" value={activeJob.completedDocuments} />
          <MiniMetric label="Failed" value={activeJob.failedDocuments} />
          <MiniMetric label="Signals" value={activeJob.insertedSignals} />
        </div>
      ) : null}

      {activeJob?.lastMessage ? <p>{activeJob.lastMessage}</p> : null}
      {queuedForMs > 90_000 ? (
        <p className="error-text">
          This job has been queued for {formatDuration(queuedForMs)}. Check that
          the Render worker service is deployed and running; it should claim jobs
          within about 45 seconds.
        </p>
      ) : null}
      {activeJob?.lastError ? <p className="error-text">{activeJob.lastError}</p> : null}
      {message ? <p>{message}</p> : null}

      <div className="button-row">
        <button
          className="button"
          disabled={Boolean(activeJob) || isPending}
          onClick={() => void runAction("/api/backfill/start")}
          type="button"
        >
          {isPending ? "Working..." : "Start Backfill"}
        </button>
        <button
          className="button danger"
          disabled={!canStop || isPending}
          onClick={() => void runAction("/api/backfill/stop")}
          type="button"
        >
          {activeJob?.status === "stop_requested" ? "Cancel Stuck Job" : "Stop"}
        </button>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDuration(milliseconds: number) {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function stopActionMessage(status: string | undefined) {
  return status === "stop_requested" ? "Stuck job cancelled." : "Stop requested.";
}
