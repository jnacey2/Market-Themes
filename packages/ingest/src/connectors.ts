import type { PersistableDocument, SourceClass } from "@market-themes/db";
import { createSecFilingsConnector } from "./sec";
import { createFmpNewsConnector } from "./fmp-news";

export type RawDocument = PersistableDocument;

export type SourceConnector = {
  id: string;
  sourceClass: SourceClass;
  description: string;
  poll: () => Promise<RawDocument[]>;
};

export function createManualConnector(documents: RawDocument[]): SourceConnector {
  return {
    id: "manual",
    sourceClass: "manual",
    description: "User-provided article text, transcripts, or notes.",
    async poll() {
      return documents;
    }
  };
}

export function createPlaceholderConnector(
  id: string,
  sourceClass: SourceClass,
  description: string
): SourceConnector {
  return {
    id,
    sourceClass,
    description,
    async poll() {
      return [];
    }
  };
}

export const defaultConnectors: SourceConnector[] = [
  createSecFilingsConnector(),
  createPlaceholderConnector(
    "company-ir",
    "press_release",
    "Company investor-relations press release connector."
  ),
  createPlaceholderConnector(
    "earnings-transcripts",
    "transcript",
    "Earnings call transcript connector for licensed or public sources."
  ),
  createFmpNewsConnector()
];
