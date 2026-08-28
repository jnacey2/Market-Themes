import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PublicationFeed, PublicationFeedInput } from "@market-themes/db";
import {
  inferPublicationNameFromUrl,
  normalizePublicationFeedInput
} from "./publication-feed";

export const SUBSTACK_FEED_TERMS =
  "Subscriber posts the operator already pays for; stored as full text when the captured session can read them, otherwise as previews.";

export type SubstackPublication = {
  name: string;
  baseUrl: string;
};

export type SubstackPublicationPreset = SubstackPublication & {
  id: string;
};

export const SUBSTACK_PUBLICATION_PRESETS: SubstackPublicationPreset[] = [
  preset("pinebrook", "https://www.pinebrookcap.com"),
  preset("lordfed", "https://www.lordfed.co.uk"),
  preset("taekim", "https://taekim.substack.com"),
  preset("jimpaulsen", "https://paulsenperspectives.substack.com"),
  preset("fidenza", "https://www.fidenzamacro.com"),
  preset("moontower", "https://moontower.substack.com"),
  preset("dannydayan", "https://dannydayan.substack.com"),
  preset("dampedspring", "https://dampedspring101.substack.com")
];

export function substackPresetToFeedInput(
  publication: SubstackPublication
): PublicationFeedInput & { url: string } {
  const input = normalizePublicationFeedInput({
    name: publication.name,
    url: publication.baseUrl,
    platform: "substack",
    tags: ["substack", "preset"],
    termsNotes: SUBSTACK_FEED_TERMS
  });
  return {
    ...input,
    url: publication.baseUrl
  };
}

export function matchSubstackPreset(url: string): SubstackPublicationPreset | null {
  const origin = originOf(url);
  if (!origin) return null;
  return (
    SUBSTACK_PUBLICATION_PRESETS.find((preset) => originOf(preset.baseUrl) === origin) ?? null
  );
}

export function resolveSubstackPublication(
  url: string,
  name?: string | null
): SubstackPublication {
  const preset = matchSubstackPreset(url);
  const resolvedName =
    String(name ?? "").trim() || preset?.name || inferPublicationNameFromUrl(url);
  if (!resolvedName) {
    throw new Error("A publication name or HTTPS URL is required.");
  }
  return {
    name: resolvedName,
    baseUrl: stripTrailingSlash(preset?.baseUrl ?? new URL(url).origin)
  };
}

export function feedFromSubstackUrl(
  url: string,
  options: { name?: string | null; maxPostsPerPoll?: number; backfillDays?: number } = {}
): PublicationFeed {
  const publication = resolveSubstackPublication(url, options.name);
  const input = normalizePublicationFeedInput({
    name: publication.name,
    url: publication.baseUrl,
    platform: "substack",
    maxPostsPerPoll: options.maxPostsPerPoll ?? 12,
    backfillDays: options.backfillDays ?? 30,
    tags: ["substack", "preset"],
    termsNotes: SUBSTACK_FEED_TERMS
  });
  return {
    id: `publication:${createHash("sha256").update(input.feedUrl).digest("hex").slice(0, 24)}`,
    name: input.name,
    homepageUrl: input.homepageUrl,
    feedUrl: input.feedUrl,
    platform: input.platform,
    sourceClass: "newspaper",
    publisherId: slug(input.name),
    publisherOwner: slug(input.publisherOwner ?? input.name),
    retentionPolicy: input.retentionPolicy ?? "full_text",
    enabled: true,
    backfillDays: input.backfillDays ?? 30,
    maxPostsPerPoll: input.maxPostsPerPoll ?? 12,
    rateLimitMs: input.rateLimitMs ?? 1_500,
    tags: input.tags ?? ["substack", "preset"],
    termsNotes: input.termsNotes ?? SUBSTACK_FEED_TERMS,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastPublishedAt: null,
    lastError: null
  };
}

export function loadSubstackPublications(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): SubstackPublication[] {
  const raw = env.SUBSTACK_PUBLICATIONS_YAML?.trim();
  if (raw) {
    if (looksLikeInlinePublications(raw)) {
      return parseSubstackPublicationsYaml(raw);
    }
    if (existsSync(raw)) {
      return parseSubstackPublicationsYaml(readFileSync(raw, "utf8"));
    }
    throw new Error(`SUBSTACK_PUBLICATIONS_YAML path was not found: ${raw}`);
  }

  const file = resolveSubstackPublicationsFile(env, cwd);
  if (file) {
    return parseSubstackPublicationsYaml(readFileSync(file, "utf8"));
  }
  return SUBSTACK_PUBLICATION_PRESETS.map(({ name, baseUrl }) => ({ name, baseUrl }));
}

export function resolveSubstackPublicationsFile(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string | null {
  const raw = env.SUBSTACK_PUBLICATIONS_YAML?.trim();
  if (raw && !looksLikeInlinePublications(raw) && existsSync(raw)) {
    return raw;
  }
  const root = findRepoRoot(cwd);
  const candidate = path.join(root, "config", "substacks.yaml");
  return existsSync(candidate) ? candidate : null;
}

export function parseSubstackPublicationsYaml(text: string): SubstackPublication[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return normalizeParsedPublications(JSON.parse(trimmed));
  }

  const publications: SubstackPublication[] = [];
  let current: Partial<SubstackPublication> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line || line === "publications:") continue;

    const item = line.match(/^- (name|base_url):\s*(.+)$/);
    const field = line.match(/^(name|base_url):\s*(.+)$/);
    const match = item ?? field;
    if (!match) continue;

    if (item) {
      if (current && current.name && current.baseUrl) {
        publications.push({ name: current.name, baseUrl: current.baseUrl });
      }
      current = {};
    }

    current ??= {};
    const value = stripYamlQuotes(match[2]);
    if (match[1] === "name") current.name = value;
    else current.baseUrl = stripTrailingSlash(value);
  }

  if (current?.name && current.baseUrl) {
    publications.push({ name: current.name, baseUrl: current.baseUrl });
  }
  return publications.map(validatePublication);
}

export function findRepoRoot(start = process.cwd()): string {
  try {
    const fromModule = fileURLToPath(new URL("../../..", import.meta.url));
    if (isRepoRoot(fromModule)) return fromModule;
  } catch {
    // ignore non-file module URLs
  }

  let dir = start;
  for (let index = 0; index < 8; index += 1) {
    if (isRepoRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

function preset(name: string, baseUrl: string): SubstackPublicationPreset {
  return { id: name, name, baseUrl: stripTrailingSlash(baseUrl) };
}

function looksLikeInlinePublications(raw: string) {
  return (
    raw.includes("\n") ||
    raw.includes("base_url:") ||
    raw.startsWith("[") ||
    raw.startsWith("-") ||
    raw.startsWith("{")
  );
}

function normalizeParsedPublications(value: unknown): SubstackPublication[] {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object" && "publications" in value
      ? (value as { publications: unknown }).publications
      : null;
  if (!Array.isArray(items)) {
    throw new Error("Substack publications JSON must be an array of {name, base_url}.");
  }
  return items.map((item) =>
    validatePublication({
      name: String((item as { name?: unknown }).name ?? ""),
      baseUrl: String(
        (item as { base_url?: unknown; baseUrl?: unknown }).base_url ??
          (item as { baseUrl?: unknown }).baseUrl ??
          ""
      )
    })
  );
}

function validatePublication(publication: SubstackPublication): SubstackPublication {
  if (!publication.name.trim()) throw new Error("Each publication needs a name.");
  const url = new URL(publication.baseUrl);
  if (url.protocol !== "https:") throw new Error("Publication URLs must use HTTPS.");
  return {
    name: publication.name.trim(),
    baseUrl: stripTrailingSlash(url.origin === publication.baseUrl || url.pathname === "/"
      ? url.origin
      : publication.baseUrl)
  };
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function stripYamlQuotes(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isRepoRoot(dir: string) {
  return (
    existsSync(path.join(dir, "config", "substacks.yaml")) ||
    (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "apps")))
  );
}
