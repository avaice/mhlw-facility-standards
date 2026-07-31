import { readFile } from "node:fs/promises";
import path from "node:path";
import { RECENT_SOURCES } from "./config/recent-sources.js";
import {
  downloadTypedDocument,
  fetchPage,
  mapWithConcurrency,
} from "./http.js";
import { parseRecentPdf } from "./parser/recent-pdf.js";
import { discoverRecentDocuments } from "./recent-discovery.js";
import { writeRecentData } from "./recent-output.js";
import {
  loadExistingRecentData,
  normalizeRecentData,
  type RecentDocumentMetadata,
  sourceBaseDates,
  validateRecentData,
} from "./recent-quality.js";
import type {
  ChangeManifest,
  DataManifest,
  FacilityChangeRecord,
  RecentSourceDefinition,
  StandardCatalog,
} from "./types.js";
import { maxIsoDate } from "./utils/date.js";
import { uniqueSorted } from "./utils/text.js";

export interface RecentUpdateOptions {
  outputDirectory: string;
  sources?: RecentSourceDefinition[];
  onProgress?: (message: string) => void;
}

export interface RecentUpdateResult {
  manifest: ChangeManifest;
  warnings: string[];
}

function mergeRecords(
  records: Iterable<FacilityChangeRecord>,
): FacilityChangeRecord[] {
  const merged = new Map<string, FacilityChangeRecord>();
  for (const incoming of records) {
    const existing = merged.get(incoming.medicalInstitutionCode);
    if (!existing) {
      merged.set(incoming.medicalInstitutionCode, incoming);
      continue;
    }
    if (incoming.name.length > existing.name.length) {
      existing.name = incoming.name;
    }
    existing.address ??= incoming.address;
    const eventIds = new Set(existing.events.map((event) => event.id));
    for (const event of incoming.events) {
      if (!eventIds.has(event.id)) {
        existing.events.push(event);
        eventIds.add(event.id);
      }
    }
  }
  return [...merged.values()]
    .map((record) => ({
      ...record,
      events: record.events.sort(
        (a, b) =>
          a.publishedAt.localeCompare(b.publishedAt) ||
          (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1) ||
          a.id.localeCompare(b.id),
      ),
    }))
    .sort((a, b) =>
      a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode)
    );
}

function buildManifest(
  baseAsOf: string,
  records: FacilityChangeRecord[],
  documents: RecentDocumentMetadata[],
  sources: RecentSourceDefinition[],
  baseDates: ReadonlyMap<string, string>,
  quality: ChangeManifest["quality"],
): ChangeManifest {
  const latestAsOf = maxIsoDate(documents.map((document) => document.asOf)) ??
    baseAsOf;
  const sourceIds = uniqueSorted(sources.map((source) => source.sourceId));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseAsOf,
    latestAsOf,
    facilityCount: records.length,
    eventCount: records.reduce(
      (sum, record) => sum + record.events.length,
      0,
    ),
    quality,
    sources: sourceIds.map((id) => {
      const definitions = sources.filter((source) => source.sourceId === id);
      const sourceDocuments = documents.filter(
        (document) => document.sourceId === id,
      );
      return {
        id,
        bureauName: definitions[0]?.bureauName ?? id,
        baseAsOf: baseDates.get(id) ?? baseAsOf,
        pageUrls: uniqueSorted(definitions.map((source) => source.pageUrl)),
        documents: sourceDocuments
          .map((document) => ({
            url: document.documentUrl,
            sha256: document.sha256,
            publishedAt: document.asOf,
            action: document.action,
          }))
          .sort((a, b) => a.url.localeCompare(b.url)),
      };
    }),
  };
}

export async function updateRecentData(
  options: RecentUpdateOptions,
): Promise<RecentUpdateResult> {
  const sources = options.sources ?? RECENT_SOURCES;
  const outputRoot = path.resolve(options.outputDirectory);
  const baseManifest = JSON.parse(
    await readFile(path.join(outputRoot, "manifest.json"), "utf8"),
  ) as DataManifest;
  const catalog = JSON.parse(
    await readFile(path.join(outputRoot, "catalog.json"), "utf8"),
  ) as StandardCatalog;
  const baseDates = sourceBaseDates(baseManifest);

  const discoveredGroups = await mapWithConcurrency(
    sources,
    3,
    async (source) => {
      options.onProgress?.(`${source.bureauName}: 月内差分ページを確認`);
      const html = await fetchPage(source.pageUrl);
      const baseAsOf = baseDates.get(source.sourceId);
      if (!baseAsOf) {
        throw new Error(
          `${source.bureauName}: 月次manifestに地域基準日がありません`,
        );
      }
      return discoverRecentDocuments(source, html, baseAsOf);
    },
  );
  const discoveredByUrl = new Map(
    discoveredGroups.flat().map((document) => [document.documentUrl, document]),
  );
  const discovered = [...discoveredByUrl.values()].sort((a, b) =>
    a.documentUrl.localeCompare(b.documentUrl)
  );
  options.onProgress?.(`${discovered.length}件の差分PDFを取得`);
  const documents = await mapWithConcurrency(
    discovered,
    3,
    async (document) => {
      options.onProgress?.(`${document.bureauName}: ${document.documentUrl}`);
      return downloadTypedDocument(document);
    },
  );
  const parsed = await mapWithConcurrency(documents, 2, async (document) => {
    options.onProgress?.(`${document.bureauName}: PDFを解析`);
    return parseRecentPdf(document);
  });
  const existing = await loadExistingRecentData(
    outputRoot,
    baseDates,
    new Set(discovered.map((document) => document.documentUrl)),
  );
  const mergedRecords = mergeRecords([
    ...existing.records,
    ...parsed.flatMap((result) => result.records),
  ]);
  const normalized = await normalizeRecentData(
    mergedRecords,
    outputRoot,
    catalog,
  );
  validateRecentData(normalized.records);
  const currentDocuments: RecentDocumentMetadata[] = documents.map(
    (document) => ({
      sourceId: document.sourceId,
      documentUrl: document.documentUrl,
      sha256: document.sha256,
      asOf: document.asOf,
      action: document.action,
    }),
  );
  const documentByUrl = new Map(
    [...existing.documents, ...currentDocuments].map((document) => [
      document.documentUrl,
      document,
    ]),
  );
  const manifestDocuments = [...documentByUrl.values()].sort((a, b) =>
    a.documentUrl.localeCompare(b.documentUrl)
  );
  const warnings = [
    ...parsed.flatMap((result) => result.warnings),
    ...(existing.retainedDocumentCount > 0
      ? [`掲載ページから消えた未収載文書を${existing.retainedDocumentCount}件保持`]
      : []),
    ...(normalized.unresolvedEventCount > 0
      ? [`曖昧な差分${normalized.unresolvedEventCount}件を自動適用対象外に設定`]
      : []),
  ];
  const quality: ChangeManifest["quality"] = {
    status: normalized.unresolvedEventCount > 0 ? "needs-review" : "verified",
    retainedDocumentCount: existing.retainedDocumentCount,
    reviewedOcrDocumentCount: normalized.reviewedOcrDocumentCount,
    unresolvedEventCount: normalized.unresolvedEventCount,
    unresolvedByReason: normalized.unresolvedByReason,
  };
  const manifest = buildManifest(
    baseManifest.asOf,
    normalized.records,
    manifestDocuments,
    sources,
    baseDates,
    quality,
  );
  await writeRecentData(
    normalized.records,
    manifest,
    path.join(outputRoot, "changes"),
  );
  options.onProgress?.(
    `${manifest.facilityCount}施設・${manifest.eventCount}件の月内差分を出力` +
      `（要確認${manifest.quality.unresolvedEventCount}件）`,
  );
  return { manifest, warnings };
}
