"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PublicationFeed } from "@market-themes/db";

const NEWSPAPER_FEED_TERMS =
  "Public RSS headline and summary only; snippet retention; no paywall or authentication bypass.";

export type NewspaperPreset = {
  id: string;
  group: string;
  name: string;
  url: string;
  homepageUrl: string;
  publisherOwner: string;
};

export type NewspaperPresetGroup = {
  id: string;
  label: string;
  publisherOwner: string;
};

export function SourceManager({
  feeds,
  newspaperGroups,
  newspaperPresets,
  substackSessionConfigured
}: {
  feeds: PublicationFeed[];
  newspaperGroups: NewspaperPresetGroup[];
  newspaperPresets: NewspaperPreset[];
  substackSessionConfigured: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registeredUrls = new Set(feeds.map((feed) => feed.feedUrl));

  async function addFeed(formData: FormData) {
    setPending("create");
    setError(null);
    try {
      await createPublication({
        name: formData.get("name"),
        url: formData.get("url"),
        platform: formData.get("platform"),
        publisherOwner: formData.get("publisherOwner"),
        retentionPolicy: formData.get("retentionPolicy"),
        backfillDays: formData.get("backfillDays"),
        maxPostsPerPoll: formData.get("maxPostsPerPoll"),
        termsNotes: formData.get("termsNotes")
      });
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setPending(null);
    }
  }

  async function addPreset(preset: NewspaperPreset) {
    setPending(preset.id);
    setError(null);
    try {
      await createPublication(presetPayload(preset));
      router.refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setPending(null);
    }
  }

  async function addGroup(groupId: string) {
    const remaining = newspaperPresets.filter(
      (preset) => preset.group === groupId && !registeredUrls.has(preset.url)
    );
    setPending(`group:${groupId}`);
    setError(null);
    try {
      for (const preset of remaining) {
        await createPublication(presetPayload(preset));
      }
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

  const substackFeeds = feeds.filter((feed) => feed.platform === "substack");

  return (
    <>
      <section className="panel">
        <div>
          <p className="eyebrow">Substack Subscriber Session</p>
          <h2>{substackSessionConfigured ? "Subscriber session configured." : "Capture your paid Substack session."}</h2>
          <p>
            Paid posts are scraped with the same account that holds the
            subscriptions. Playwright only logs in; archive and post JSON
            endpoints then download the bodies your session can read.
            {substackFeeds.length > 0
              ? ` ${substackFeeds.length} Substack publication${substackFeeds.length === 1 ? "" : "s"} registered.`
              : " Register each Substack you subscribe to below."}
          </p>
          <p>
            {substackSessionConfigured
              ? "Paid subscriber posts can be stored as full text and later upgraded if an earlier poll only got a preview."
              : "Run `npm run substack:capture-session`, confirm a paid article opens, then set SUBSTACK_STORAGE_STATE_B64 on web, worker, and poll-sources."}
          </p>
        </div>
      </section>

      <section className="panel newspaper-presets">
        <div>
          <p className="eyebrow">Major Newspapers</p>
          <h2>Add public headline feeds</h2>
          <p>
            Official RSS from NYT, WSJ, Washington Post, Bloomberg, and FT.
            These store headlines and ledes only. No login or paywall bypass.
          </p>
        </div>
        <div className="preset-groups">
          {newspaperGroups.map((group) => {
            const presets = newspaperPresets.filter((preset) => preset.group === group.id);
            const remaining = presets.filter((preset) => !registeredUrls.has(preset.url));
            return (
              <article className="preset-group" key={group.id}>
                <div className="preset-group-header">
                  <div>
                    <h3>{group.label}</h3>
                    <p>
                      {presets.length - remaining.length} of {presets.length} registered
                    </p>
                  </div>
                  <button
                    className="button"
                    disabled={pending !== null || remaining.length === 0}
                    onClick={() => addGroup(group.id)}
                    type="button"
                  >
                    {pending === `group:${group.id}`
                      ? "Adding…"
                      : remaining.length === 0
                        ? "Added"
                        : `Add all ${remaining.length}`}
                  </button>
                </div>
                <div className="preset-row">
                  {presets.map((preset) => {
                    const added = registeredUrls.has(preset.url);
                    return (
                      <button
                        className={`preset-chip${added ? " preset-chip-added" : ""}`}
                        disabled={pending !== null || added}
                        key={preset.id}
                        onClick={() => addPreset(preset)}
                        type="button"
                      >
                        {pending === preset.id ? "Adding…" : added ? `${preset.name} added` : preset.name}
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <form action={addFeed} className="panel source-form">
        <div>
          <p className="eyebrow">Add Publication</p>
          <h2>Register a Substack or RSS feed</h2>
          <p>
            Add each Substack you subscribe to by homepage URL, including custom
            domains. Paid posts are stored as full text when the captured
            subscriber session can read them, otherwise as previews. Generic
            publications use RSS or Atom.
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
            placeholder={NEWSPAPER_FEED_TERMS}
            required
          />
        </label>
        <button className="button" disabled={pending === "create"} type="submit">
          {pending === "create" ? "Validating…" : "Add publication"}
        </button>
        {error ? <p className="error-text source-form-wide">{error}</p> : null}
        <p className="source-form-wide">
          Substack session:{" "}
          <strong>{substackSessionConfigured ? "configured" : "not configured"}</strong>
          {substackSessionConfigured
            ? " Paid subscriber posts can be upgraded from preview to full text."
            : " Capture one locally with `npm run substack:capture-session`, then set SUBSTACK_STORAGE_STATE_B64."}
        </p>
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

function presetPayload(preset: NewspaperPreset) {
  return {
    name: preset.name,
    url: preset.url,
    homepageUrl: preset.homepageUrl,
    platform: "rss",
    publisherOwner: preset.publisherOwner,
    retentionPolicy: "snippet",
    backfillDays: 7,
    maxPostsPerPoll: 50,
    tags: ["rss", "newspaper", "preset"],
    termsNotes: NEWSPAPER_FEED_TERMS
  };
}

async function createPublication(body: Record<string, unknown>) {
  const response = await fetch("/api/publication-feeds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Unable to add publication.");
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}
