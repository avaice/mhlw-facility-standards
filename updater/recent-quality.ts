import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createChangeEventId } from "./standard.js";
import type {
  ChangeAction,
  ChangeManifest,
  ChangeReviewReason,
  CompactFacilityRecord,
  DataManifest,
  FacilityChangeEvent,
  FacilityChangeRecord,
  FacilityChangeShard,
  FacilityShard,
  StandardCatalog,
} from "./types.js";
import { normalizeText } from "./utils/text.js";

export interface RecentDocumentMetadata {
  sourceId: string;
  documentUrl: string;
  sha256: string;
  asOf: string;
  action: ChangeAction;
}

export interface ExistingRecentData {
  records: FacilityChangeRecord[];
  documents: RecentDocumentMetadata[];
  retainedDocumentCount: number;
}

export interface NormalizedRecentData {
  records: FacilityChangeRecord[];
  unresolvedEventCount: number;
  reviewedOcrDocumentCount: number;
  unresolvedByReason: Record<ChangeReviewReason, number>;
}

const REVIEW_REASONS: ChangeReviewReason[] = [
  "unverified-facility-identity",
  "missing-standard-abbreviation",
  "unknown-standard",
  "ambiguous-standard",
  "multiple-base-records",
  "missing-effective-date",
  "missing-acceptance-number",
  "unreviewed-ocr",
];

function emptyReasonCounts(): Record<ChangeReviewReason, number> {
  return Object.fromEntries(
    REVIEW_REASONS.map((reason) => [reason, 0]),
  ) as Record<ChangeReviewReason, number>;
}

async function readJsonIfExists<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function sourceBaseDates(manifest: DataManifest): Map<string, string> {
  const dates = new Map<string, string>();
  for (const source of manifest.sources) {
    const existing = dates.get(source.id);
    if (existing && existing !== source.asOf) {
      throw new Error(
        `${source.id}: 月次manifest内で地域基準日が競合しています ` +
          `(${existing} / ${source.asOf})`,
      );
    }
    dates.set(source.id, source.asOf);
  }
  return dates;
}

export async function loadExistingRecentData(
  outputRoot: string,
  baseDates: ReadonlyMap<string, string>,
  replacedDocumentUrls: ReadonlySet<string>,
): Promise<ExistingRecentData> {
  const changesRoot = path.join(outputRoot, "changes");
  const manifest = await readJsonIfExists<ChangeManifest>(
    path.join(changesRoot, "manifest.json"),
  );
  const facilitiesRoot = path.join(changesRoot, "facilities");
  let files: string[] = [];
  try {
    files = (await readdir(facilitiesRoot))
      .filter((file) => file.endsWith(".json"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const records: FacilityChangeRecord[] = [];
  const referencedDocuments = new Set<string>();
  for (const file of files) {
    const shard = JSON.parse(
      await readFile(path.join(facilitiesRoot, file), "utf8"),
    ) as FacilityChangeShard;
    for (const [medicalInstitutionCode, facility] of Object.entries(
      shard.facilities,
    )) {
      const events = facility.events.filter((event) => {
        const baseAsOf = baseDates.get(event.sourceId);
        if (!baseAsOf || event.publishedAt <= baseAsOf) {
          return false;
        }
        if (replacedDocumentUrls.has(event.documentUrl)) {
          return false;
        }
        // Legacy unreviewed OCR output must never survive a reliability rebuild.
        if (
          event.extractionMethod === "ocr" &&
          event.reviewStatus !== "manual-reviewed"
        ) {
          return false;
        }
        referencedDocuments.add(event.documentUrl);
        return true;
      });
      if (events.length > 0) {
        records.push({
          medicalInstitutionCode,
          name: facility.name,
          address: facility.address,
          category: facility.category,
          events,
        });
      }
    }
  }

  const documents = (manifest?.sources ?? []).flatMap((source) =>
    source.documents.flatMap((document) =>
      referencedDocuments.has(document.url)
        ? [{
            sourceId: source.id,
            documentUrl: document.url,
            sha256: document.sha256,
            asOf: document.publishedAt,
            action: document.action,
          } satisfies RecentDocumentMetadata]
        : []
    )
  );

  return {
    records,
    documents,
    retainedDocumentCount: documents.length,
  };
}

function cleanNewFacilityName(value: string): string {
  const cleaned = normalizeText(value).replace(
    /\s*〒\s*\d{3}\s*[-ー－]?\s*\d{4}\s*$/u,
    "",
  );
  if (!cleaned || /〒\s*\d{3}\s*[-ー－]?\s*\d{4}/u.test(cleaned)) {
    throw new Error(`新規施設名を安全に正規化できません: ${value}`);
  }
  return cleaned;
}

function suspiciousNewAddress(value: string | null): boolean {
  if (!value) {
    return true;
  }
  const normalized = normalizeText(value);
  return (
    !normalized ||
    /[\[\]|_]{2,}|[ー―－-]{5,}|ニ{5,}/u.test(normalized)
  );
}

function definitionsByAbbreviation(
  catalog: StandardCatalog,
): Map<string, Array<{ id: string; name: string | null }>> {
  const result = new Map<string, Array<{ id: string; name: string | null }>>();
  for (const [id, definition] of Object.entries(catalog.standards)) {
    if (!definition.abbreviation) {
      continue;
    }
    const entries = result.get(definition.abbreviation) ?? [];
    entries.push({ id, name: definition.name });
    result.set(definition.abbreviation, entries);
  }
  return result;
}

function baseDefinitions(
  compact: CompactFacilityRecord | undefined,
  catalog: StandardCatalog,
  abbreviation: string,
): Array<{ id: string; name: string | null }> {
  if (!compact) {
    return [];
  }
  return compact.standards.flatMap(([id]) => {
    const definition = catalog.standards[id];
    return definition?.abbreviation === abbreviation
      ? [{ id, name: definition.name }]
      : [];
  });
}

function normalizeEvent(
  code: string,
  event: FacilityChangeEvent,
  compact: CompactFacilityRecord | undefined,
  catalog: StandardCatalog,
  byAbbreviation: ReadonlyMap<
    string,
    Array<{ id: string; name: string | null }>
  >,
  identityNeedsReview: boolean,
): FacilityChangeEvent {
  const reviewReasons = new Set<ChangeReviewReason>();
  if (identityNeedsReview) {
    reviewReasons.add("unverified-facility-identity");
  }
  let standardId = event.standardId;
  let standard = { ...event.standard };
  const abbreviation = event.standard.abbreviation;

  if (abbreviation) {
    const globalCandidates = byAbbreviation.get(abbreviation) ?? [];
    const facilityCandidates = baseDefinitions(compact, catalog, abbreviation);
    const exactName = event.standard.name
      ? globalCandidates.find(
          (candidate) => candidate.name === event.standard.name,
        )
      : undefined;
    const selected = event.action === "remove"
      ? facilityCandidates.length === 1
        ? facilityCandidates[0]
        : facilityCandidates.length > 1
          ? undefined
          : globalCandidates.length === 1
            ? globalCandidates[0]
            : undefined
      : exactName ??
        (globalCandidates.length === 1 ? globalCandidates[0] : undefined);

    if (selected) {
      standardId = selected.id;
      standard = { abbreviation, name: selected.name };
    } else {
      if (event.action === "remove" && facilityCandidates.length > 1) {
        const distinctIds = new Set(
          facilityCandidates.map((candidate) => candidate.id),
        );
        reviewReasons.add(
          distinctIds.size > 1
            ? "ambiguous-standard"
            : "multiple-base-records",
        );
      } else {
        reviewReasons.add(
          globalCandidates.length > 1
            ? "ambiguous-standard"
            : "unknown-standard",
        );
      }
    }
  } else {
    reviewReasons.add("missing-standard-abbreviation");
  }

  if (event.effectiveFrom === null) {
    reviewReasons.add("missing-effective-date");
  }
  if (event.action === "upsert" && !event.acceptanceNumber) {
    reviewReasons.add("missing-acceptance-number");
  }
  if (event.extractionMethod === "ocr") {
    reviewReasons.add("unreviewed-ocr");
  }

  const reasons = REVIEW_REASONS.filter((reason) => reviewReasons.has(reason));
  const reviewStatus = reasons.length > 0
    ? "needs-review"
    : event.reviewStatus === "manual-reviewed"
      ? "manual-reviewed"
      : "automatic";
  const normalized = {
    ...event,
    standardId,
    standard,
    reviewStatus,
    ...(reasons.length > 0 ? { reviewReasons: reasons } : {}),
  } satisfies FacilityChangeEvent;
  return {
    ...normalized,
    id: createChangeEventId(
      { sha256: event.documentSha256, action: event.action },
      event.page,
      code,
      {
        ...standard,
        acceptanceNumber: event.acceptanceNumber,
        effectiveFrom: event.effectiveFrom,
      },
    ),
  };
}

export async function normalizeRecentData(
  records: FacilityChangeRecord[],
  outputRoot: string,
  catalog: StandardCatalog,
): Promise<NormalizedRecentData> {
  const prefixes = [...new Set(records.map((record) =>
    record.medicalInstitutionCode.slice(0, 4)
  ))];
  const shards = new Map<string, FacilityShard>();
  await Promise.all(prefixes.map(async (prefix) => {
    const shard = await readJsonIfExists<FacilityShard>(
      path.join(outputRoot, "facilities", `${prefix}.json`),
    );
    if (shard) {
      shards.set(prefix, shard);
    }
  }));

  const byAbbreviation = definitionsByAbbreviation(catalog);
  let unresolvedEventCount = 0;
  const unresolvedByReason = emptyReasonCounts();
  const reviewedOcrDocuments = new Set<string>();
  const normalizedRecords = records.map((record) => {
    const compact = shards.get(
      record.medicalInstitutionCode.slice(0, 4),
    )?.facilities[record.medicalInstitutionCode];
    const name = compact?.name ?? cleanNewFacilityName(record.name);
    const address = compact?.address ?? record.address;
    const identityNeedsReview = !compact && suspiciousNewAddress(address);
    const eventIds = new Set<string>();
    const events = record.events.flatMap((event) => {
      const normalized = normalizeEvent(
        record.medicalInstitutionCode,
        event,
        compact,
        catalog,
        byAbbreviation,
        identityNeedsReview,
      );
      if (eventIds.has(normalized.id)) {
        return [];
      }
      eventIds.add(normalized.id);
      if (normalized.reviewStatus === "needs-review") {
        unresolvedEventCount += 1;
        for (const reason of normalized.reviewReasons ?? []) {
          unresolvedByReason[reason] += 1;
        }
      }
      if (normalized.extractionMethod === "ocr-reviewed") {
        reviewedOcrDocuments.add(normalized.documentUrl);
      }
      return [normalized];
    });
    return {
      medicalInstitutionCode: record.medicalInstitutionCode,
      name,
      address,
      category: compact?.category ?? record.category,
      events: events.sort(
        (a, b) =>
          a.publishedAt.localeCompare(b.publishedAt) ||
          (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1) ||
          a.id.localeCompare(b.id),
      ),
    } satisfies FacilityChangeRecord;
  });

  return {
    records: normalizedRecords.sort((a, b) =>
      a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode)
    ),
    unresolvedEventCount,
    reviewedOcrDocumentCount: reviewedOcrDocuments.size,
    unresolvedByReason,
  };
}

export function validateRecentData(records: FacilityChangeRecord[]): void {
  const ids = new Set<string>();
  for (const record of records) {
    if (!/^\d{2}[134]\d{7}$/u.test(record.medicalInstitutionCode)) {
      throw new Error(`不正な医療機関コードです: ${record.medicalInstitutionCode}`);
    }
    if (/〒\s*\d{3}\s*[-ー－]?\s*\d{4}/u.test(record.name)) {
      throw new Error(
        `${record.medicalInstitutionCode}: 施設名へ郵便番号が混入しています`,
      );
    }
    for (const event of record.events) {
      if (ids.has(event.id)) {
        throw new Error(`差分イベントIDが重複しています: ${event.id}`);
      }
      ids.add(event.id);
      if (event.extractionMethod === "ocr") {
        throw new Error(
          `${event.documentUrl}: 未確認OCRイベントの公開は禁止されています`,
        );
      }
      if (
        event.reviewStatus === "needs-review" &&
        (event.reviewReasons?.length ?? 0) === 0
      ) {
        throw new Error(`${event.id}: 要確認理由がありません`);
      }
      if (
        event.reviewStatus !== "needs-review" &&
        (event.reviewReasons?.length ?? 0) > 0
      ) {
        throw new Error(`${event.id}: 確定イベントに要確認理由があります`);
      }
      if (
        event.reviewStatus !== "needs-review" &&
        event.effectiveFrom === null
      ) {
        throw new Error(`${event.id}: 適用日がありません`);
      }
    }
  }
}
