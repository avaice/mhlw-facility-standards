export interface AppliedStandardRecord {
  abbreviation: string | null;
  name: string | null;
  acceptanceNumber: string | null;
  effectiveFrom: string | null;
}

export interface AppliedStandardEntry {
  standardId: string;
  record: AppliedStandardRecord;
}

export interface ApplicableChangeEvent {
  standardId: string;
  standard: Pick<AppliedStandardRecord, "abbreviation" | "name">;
  acceptanceNumber: string | null;
  effectiveFrom: string | null;
  action: "upsert" | "remove";
  reviewStatus?: "automatic" | "manual-reviewed" | "needs-review";
}

export function applyChangeEvent(
  standards: AppliedStandardEntry[],
  event: ApplicableChangeEvent,
): "applied" | "no-op" | "unresolved" {
  if (event.reviewStatus === "needs-review") {
    return "unresolved";
  }
  const exactMatches = standards.flatMap((entry, index) =>
    entry.standardId === event.standardId ? [index] : []
  );
  const abbreviationMatches = event.standard.abbreviation
    ? standards.flatMap((entry, index) =>
        entry.record.abbreviation === event.standard.abbreviation ? [index] : []
      )
    : [];
  if (event.action === "remove") {
    if (exactMatches.length > 0) {
      // A withdrawal applies to the resolved standard itself. Remove every
      // historical/current row for that exact definition.
      for (const index of exactMatches.reverse()) {
        standards.splice(index, 1);
      }
      return "applied";
    }
    if (abbreviationMatches.length > 1) {
      return "unresolved";
    }
    const index = abbreviationMatches[0];
    if (index === undefined) {
      return "no-op";
    }
    standards.splice(index, 1);
    return "applied";
  }

  const definitionMatches = exactMatches.length > 0
    ? exactMatches
    : abbreviationMatches;
  const identicalMatches = definitionMatches.filter((index) => {
    const existing = standards[index]!;
    return (
      existing.standardId === event.standardId &&
      existing.record.abbreviation === event.standard.abbreviation &&
      existing.record.name === event.standard.name &&
      existing.record.acceptanceNumber === event.acceptanceNumber &&
      existing.record.effectiveFrom === event.effectiveFrom
    );
  });
  // Monthly workbooks can contain both a historical row and the current row
  // for the same standard and acceptance number. If the exact current row is
  // already present, replaying the official change is safely idempotent.
  if (identicalMatches.length > 0) {
    return "no-op";
  }
  if (exactMatches.length === 0 && abbreviationMatches.length > 1) {
    return "unresolved";
  }
  // A registration is identified by the standard, acceptance number and
  // effective date together. Official monthly workbooks retain historical
  // rows, so a later effective date must be appended rather than replacing
  // an earlier row with the same acceptance number.
  standards.push({
    standardId: event.standardId,
    record: {
      ...event.standard,
      acceptanceNumber: event.acceptanceNumber,
      effectiveFrom: event.effectiveFrom,
    },
  });
  return "applied";
}
