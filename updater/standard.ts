import { createHash } from "node:crypto";
import type {
  DownloadedRecentDocument,
  StandardRecord,
} from "./types.js";

export function createStandardId(
  standard: Pick<StandardRecord, "abbreviation" | "name">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([standard.abbreviation, standard.name]))
    .digest("hex")
    .slice(0, 16);
}

export function createChangeEventId(
  document: Pick<DownloadedRecentDocument, "sha256" | "action">,
  page: number,
  code: string,
  standard: Pick<
    StandardRecord,
    "abbreviation" | "name" | "acceptanceNumber" | "effectiveFrom"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        document.sha256,
        page,
        code,
        document.action,
        standard.abbreviation,
        standard.name,
        standard.acceptanceNumber,
        standard.effectiveFrom,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
}
