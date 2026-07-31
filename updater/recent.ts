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
import type {
  ChangeManifest,
  DataManifest,
  DownloadedRecentDocument,
  FacilityChangeRecord,
  RecentSourceDefinition,
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
  documents: DownloadedRecentDocument[],
  sources: RecentSourceDefinition[],
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
    sources: sourceIds.map((id) => {
      const definitions = sources.filter((source) => source.sourceId === id);
      const sourceDocuments = documents.filter(
        (document) => document.sourceId === id,
      );
      return {
        id,
        bureauName: definitions[0]?.bureauName ?? id,
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

  const discoveredGroups = await mapWithConcurrency(
    sources,
    3,
    async (source) => {
      options.onProgress?.(`${source.bureauName}: 月内差分ページを確認`);
      const html = await fetchPage(source.pageUrl);
      return discoverRecentDocuments(source, html, baseManifest.asOf);
    },
  );
  const discovered = discoveredGroups.flat();
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
  const records = mergeRecords(
    parsed.flatMap((result) => result.records),
  );
  const warnings = parsed.flatMap((result) => result.warnings);
  const manifest = buildManifest(
    baseManifest.asOf,
    records,
    documents,
    sources,
  );
  await writeRecentData(
    records,
    manifest,
    path.join(outputRoot, "changes"),
  );
  options.onProgress?.(
    `${manifest.facilityCount}施設・${manifest.eventCount}件の月内差分を出力`,
  );
  return { manifest, warnings };
}
