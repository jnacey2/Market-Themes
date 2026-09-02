import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exportNarrativeEvalCases,
  type ExportEvalCasesOptions,
  type SourceClass
} from "@market-themes/db";

/**
 * Exports real stored documents as an evaluation case file.
 *
 *   npm run eval:export -- --out eval/narrative-cases.json --unlabeled 40
 *
 * Reviewed documents arrive pre-labeled from approve/reject decisions. The
 * "unlabeled" recall sample must be hand-labeled by editing
 * `expectedMatchedSlugs` (null -> array of slugs, or [] when none apply)
 * before `npm run eval:narratives -- --cases <file>` will include it.
 */
export async function exportEvalCases(argv = process.argv.slice(2)) {
  const options = parseExportArgs(argv);
  const file = await exportNarrativeEvalCases(options.export);
  const outPath = resolve(options.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(file, null, 2)}\n`);

  const byLabelSource = new Map<string, number>();
  for (const item of file.cases) {
    byLabelSource.set(item.labelSource, (byLabelSource.get(item.labelSource) ?? 0) + 1);
  }

  return {
    out: outPath,
    definitions: file.definitions.length,
    cases: file.cases.length,
    byLabelSource: Object.fromEntries(byLabelSource),
    nextCommand: `npm run eval:narratives -- --offline --cases ${options.out}`
  };
}

export function parseExportArgs(argv: string[]) {
  let out = "eval/narrative-eval-cases.json";
  const exportOptions: ExportEvalCasesOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    const takeNumber = (assign: (parsed: number) => void) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${flag} requires a non-negative number.`);
      }
      assign(parsed);
      index += 1;
    };

    if (flag === "--out" && value) {
      out = value;
      index += 1;
    } else if (flag === "--reviewed-per-definition" && value) {
      takeNumber((parsed) => (exportOptions.reviewedPerDefinition = parsed));
    } else if (flag === "--unlabeled" && value) {
      takeNumber((parsed) => (exportOptions.unlabeledSample = parsed));
    } else if (flag === "--lookback-days" && value) {
      takeNumber((parsed) => (exportOptions.lookbackDays = parsed));
    } else if (flag === "--max-text-chars" && value) {
      takeNumber((parsed) => (exportOptions.maxTextChars = parsed));
    } else if (flag === "--source-class" && value) {
      exportOptions.sourceClasses = [
        ...(exportOptions.sourceClasses ?? []),
        value as SourceClass
      ];
      index += 1;
    } else if (flag === "--model" && value) {
      exportOptions.model = value;
      index += 1;
    } else if (flag === "--prompt-version" && value) {
      exportOptions.promptVersion = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete export argument: ${flag}`);
    }
  }

  return { out, export: exportOptions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportEvalCases()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
