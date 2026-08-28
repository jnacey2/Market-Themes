"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicationFeed } from "@market-themes/db";

export function SourceManager({ feeds }: { feeds: PublicationFeed[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addFeed(formData: FormData) {
    setPending("create");
    setError(null);
    try {
      const response = await fetch("/api/publication-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          url: formData.get("url"),
          platform: formData.get("platform"),
          publisherOwner: formData.get("publisherOwner"),
          retentionPolicy: formData.get("retentionPolicy"),
          backfillDays: formData.get("backfillDays"),
          maxPostsPerPoll: formData.get("maxPostsPerPoll"),
          termsNotes: formData.get("termsNotes")
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to add publication.");
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setPending(null);
    }
  }

  async function toggle(feed: PublicationFeed) {
    setPending(feed.id);
    setError(null);
    try {
      const response = await fetch("/api/publication-feeds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feed.id, enabled: !feed.enabled })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to update publication.");
      router.refresh();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <form action={addFeed} className="panel source-form">
        <div>
          <p className="eyebrow">Add Publication</p>
          <h2>Register a public feed</h2>
          <p>
            Substack uses its public archive and post APIs. Paid-only posts are
            always skipped. Generic publications use RSS or Atom.
          </p>
        </div>
        <label>
          Publication name
          <input name="name" placeholder="Example Macro Letter" required />
        </label>
        <label>
          Publication URL
          <input name="url" placeholder="https://example.substack.com" required type="url" />
        </label>
        <label>
          Platform
          <select defaultValue="substack" name="platform">
            <option value="substack">Substack</option>
            <option value="rss">RSS / Atom</option>
          </select>
        </label>
        <label>
          Publisher owner
          <input name="publisherOwner" placeholder="Author or publishing group" />
        </label>
        <label>
          Retention
          <select defaultValue="full_text" name="retentionPolicy">
            <option value="full_text">Public full text</option>
            <option value="snippet">Snippet only</option>
          </select>
        </label>
        <label>
          Historical lookback days
          <input defaultValue="30" max="3650" min="1" name="backfillDays" type="number" />
        </label>
        <label>
          Maximum posts per poll
          <input defaultValue="50" max="250" min="1" name="maxPostsPerPoll" type="number" />
        </label>
        <label className="source-form-wide">
          Terms / permission note
          <input
            name="termsNotes"
            placeholder="Public posts only; internal research use."
            required
          />
        </label>
        <button className="button" disabled={pending === "create"} type="submit">
          {pending === "create" ? "Validating…" : "Add publication"}
        </button>
        {error ? <p className="error-text source-form-wide">{error}</p> : null}
      </form>

      <div className="review-queue">
        {feeds.length === 0 ? (
          <div className="panel"><p>No managed publications yet.</p></div>
        ) : feeds.map((feed) => (
          <article className="panel managed-source" key={feed.id}>
            <div>
              <div className="pill-row">
                <span className="pill">{feed.platform}</span>
                <span className={`pill ${feed.enabled ? "review-approved" : "review-rejected"}`}>
                  {feed.enabled ? "enabled" : "disabled"}
                </span>
                <span className="pill">{feed.retentionPolicy.replace("_", " ")}</span>
              </div>
              <h2>{feed.name}</h2>
              <p>{feed.publisherOwner}</p>
              <a href={feed.homepageUrl} rel="noreferrer" target="_blank">
                {feed.homepageUrl}
              </a>
            </div>
            <div className="source-status">
              <span className="label">Last success</span>
              <strong>{formatDate(feed.lastSuccessAt)}</strong>
              <span className="label">Latest publication</span>
              <strong>{formatDate(feed.lastPublishedAt)}</strong>
              {feed.lastError ? <p className="error-text">{feed.lastError}</p> : null}
              <button
                className={feed.enabled ? "button danger" : "button"}
                disabled={pending === feed.id}
                onClick={() => toggle(feed)}
                type="button"
              >
                {feed.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}
