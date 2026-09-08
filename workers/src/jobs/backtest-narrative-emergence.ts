import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_BACKTEST_SIGNAL_Z,
  formatEmergenceBacktestTable,
  loadNarrativeEmergenceTimelines,
  summarizeEmergenceBacktest,
  type TrendWindow
} from "@market-themes/db";

/**
 * Backtests first-emergence detection against stored trend history.
 *
 *   npm run narratives:backtest
 *   npm run narratives:backtest -- --truth eval/emergence-truth.json --window 7d --z 2
 *
 * The truth file maps definition slug -> YYYY-MM-DD (the date a human asserts
 * the narrative first became visible). Without it the report still shows how
 * far each detector fired ahead of, or behind, the date the narrative was
 * defined, which is the cheapest available proxy for "would we have caught it
 * earlier".
 */
export async function backtestNarrativeEmergence(argv = process.argv.slice(2)) {
  const options = parseBacktestArgs(argv);
  const truth = options.truthPath ? await loadTruth(options.truthPath) : {};
  const timelines = await loadNarrativeEmergenceTimelines({
    window: options.window,
    signalZ: options.signalZ,
    promptVersion: options.promptVersion ?? undefined,
    statuses: options.includeExpired
      ? undefined
      : ["active", "probationary"]
  });
  const filtered = options.slugs.length
    ? timelines.filter((timeline) => options.slugs.includes(timeline.slug))
    : timelines;
  const summary = summarizeEmergenceBacktest(filtered, truth, {
    window: options.window,
    signalZ: options.signalZ
  });
  return { summary, table: formatEmergenceBacktestTable(summary), format: options.format };
}

export async function loadTruth(path: string) {
  const raw = await readFile(resolve(path), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Truth file must be a JSON object mapping slug to YYYY-MM-DD.");
  }
  const truth: Record<string, string> = {};
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Truth date for ${slug} must be YYYY-MM-DD.`);
    }
    truth[slug] = value;
  }
  return truth;
}

export function parseBacktestArgs(argv: string[]) {
  let window: TrendWindow = "7d";
  let signalZ = DEFAULT_BACKTEST_SIGNAL_Z;
  let truthPath: string | null = null;
  let promptVersion: string | null = null;
  let format: "table" | "json" = "table";
  let includeExpired = false;
  const slugs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--window" && value) {
      if (value !== "7d" && value !== "30d") {
        throw new Error("--window must be 7d or 30d.");
      }
      window = value;
      index += 1;
    } else if (flag === "--z" && value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--z must be a positive number.");
      }
      signalZ = parsed;
      index += 1;
    } else if (flag === "--truth" && value) {
      truthPath = value;
      index += 1;
    } else if (flag === "--prompt-version" && value) {
      promptVersion = value;
      index += 1;
    } else if (flag === "--slug" && value) {
      slugs.push(value);
      index += 1;
    } else if (flag === "--json") {
      format = "json";
    } else if (flag === "--include-expired") {
      includeExpired = true;
    } else {
      throw new Error(`Unknown or incomplete backtest argument: ${flag}`);
    }
  }

  return { window, signalZ, truthPath, promptVersion, format, includeExpired, slugs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backtestNarrativeEmergence()
    .then((result) => {
      if (result.format === "json") {
        console.log(JSON.stringify(result.summary, null, 2));
      } else {
        console.log(result.table);
      }
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
