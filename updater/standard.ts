import { createHash } from "node:crypto";
import type { StandardRecord } from "./types.js";

export function createStandardId(
  standard: Pick<StandardRecord, "abbreviation" | "name">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([standard.abbreviation, standard.name]))
    .digest("hex")
    .slice(0, 16);
}
