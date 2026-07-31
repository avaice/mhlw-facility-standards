import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractWorkbooks } from "./archive.js";
import { SOURCE_PREFECTURE_CODES } from "./config/prefectures.js";
import { SOURCES } from "./config/sources.js";
import { discoverDocuments } from "./discovery.js";
import {
  downloadDocument,
  fetchPage,
  mapWithConcurrency,
} from "./http.js";
import { SHARD_PREFIX_LENGTH, writeStaticData } from "./output.js";
import {
  mergeFacilityRecords,
  parseWorkbook,
} from "./parser/workbook.js";
import {
  type MonthlyQualityBaseline,
  validateMonthlyData,
} from "./quality.js";
import type {
  DataManifest,
  DiscoveredDocument,
  DownloadedDocument,
  FacilityRecord,
  FacilitySearchIndex,
  SourceDefinition,
} from "./types.js";
import { maxIsoDate } from "./utils/date.js";

export interface UpdateOptions {
  outputDirectory: string;
  minimumFacilityCount?: number;
  sources?: SourceDefinition[];
  onProgress?: (message: string) => void;
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

async function loadPreviousSnapshot(
  outputDirectory: string,
): Promise<MonthlyQualityBaseline | null> {
  const output = path.resolve(outputDirectory);
  const [manifest, search] = await Promise.all([
    readJsonIfExists<DataManifest>(path.join(output, "manifest.json")),
    readJsonIfExists<FacilitySearchIndex>(path.join(output, "search.json")),
  ]);
  if (!manifest && !search) {
    return null;
  }
  if (!manifest || !search) {
    throw new Error("前回スナップショットのmanifestまたは検索索引がありません");
  }
  return { manifest, search };
}

export interface UpdateResult {
  manifest: DataManifest;
  warnings: string[];
}

function progress(options: UpdateOptions, message: string): void {
  options.onProgress?.(message);
}

export async function discoverAllSources(
  sources: SourceDefinition[] = SOURCES,
  onProgress?: (message: string) => void,
): Promise<DiscoveredDocument[]> {
  const groups = await mapWithConcurrency(sources, 2, async (source) => {
    onProgress?.(`${source.bureauName}: 掲載ページを確認`);
    const html = await fetchPage(source.pageUrl);
    return discoverDocuments(source, html);
  });
  return groups.flat();
}

function buildManifest(
  records: FacilityRecord[],
  documents: DownloadedDocument[],
  sources: SourceDefinition[],
): DataManifest {
  const sourceEntries = sources.map((source) => {
    const sourceDocuments = documents.filter(
      (document) => document.sourceId === source.id,
    );
    const sourceRecords = records.filter((record) =>
      record.sources.some((item) => item.bureauId === source.id),
    );
    const asOf = maxIsoDate(sourceDocuments.map((document) => document.asOf));
    if (!asOf) {
      throw new Error(`${source.id}: manifest用の基準日がありません`);
    }

    return {
      id: source.id,
      bureauName: source.bureauName,
      pageUrl: source.pageUrl,
      asOf,
      facilityCount: sourceRecords.length,
      documents: sourceDocuments
        .map((document) => ({
          url: document.documentUrl,
          sha256: document.sha256,
        }))
        .sort((a, b) => a.url.localeCompare(b.url)),
    };
  });

  const asOf = maxIsoDate(sourceEntries.map((source) => source.asOf));
  if (!asOf) {
    throw new Error("全体の基準日を決定できません");
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    shardPrefixLength: SHARD_PREFIX_LENGTH,
    facilityCount: records.length,
    standardCount: records.reduce(
      (total, record) => total + record.standards.length,
      0,
    ),
    sources: sourceEntries,
  };
}

function validateResult(
  records: FacilityRecord[],
  documents: DownloadedDocument[],
  sources: SourceDefinition[],
  minimumFacilityCount: number,
): void {
  if (records.length < minimumFacilityCount) {
    throw new Error(
      `施設数が安全下限を下回りました: ${records.length} < ${minimumFacilityCount}`,
    );
  }

  for (const source of sources) {
    const documentCount = documents.filter(
      (document) => document.sourceId === source.id,
    ).length;
    const facilityCount = records.filter((record) =>
      record.sources.some((item) => item.bureauId === source.id),
    ).length;

    if (documentCount === 0) {
      throw new Error(`${source.bureauName}: 配布ファイルがありません`);
    }
    if (facilityCount === 0) {
      throw new Error(`${source.bureauName}: 施設を1件も解析できません`);
    }
  }

  for (const category of ["medical", "dental", "pharmacy"] as const) {
    if (!records.some((record) => record.category === category)) {
      throw new Error(`${category}: 施設を1件も解析できません`);
    }
  }
}

export async function updateData(options: UpdateOptions): Promise<UpdateResult> {
  const sources = options.sources ?? SOURCES;
  const minimumFacilityCount = options.minimumFacilityCount ?? 100_000;
  const previousSnapshot = await loadPreviousSnapshot(options.outputDirectory);

  progress(options, "公式掲載ページから最新ファイルを検出");
  const discovered = await discoverAllSources(sources, (message) =>
    progress(options, message),
  );

  progress(options, `${discovered.length}件の配布ファイルを取得`);
  const documents = await mapWithConcurrency(discovered, 3, async (document) => {
    progress(options, `${document.bureauName}: ${document.documentUrl}`);
    return downloadDocument(document);
  });

  const workbookGroups = await Promise.all(
    documents.map((document) => extractWorkbooks(document)),
  );
  const workbooks = workbookGroups.flat();
  progress(options, `${workbooks.length}件のワークブックを解析`);

  const parsed = await mapWithConcurrency(workbooks, 2, async (workbook) => {
    progress(options, `${workbook.source.bureauName}: ${workbook.fileName}`);
    return parseWorkbook(workbook);
  });
  const records = mergeFacilityRecords(
    parsed.flatMap((result) => result.records),
  );
  const warnings = parsed.flatMap((result) => result.warnings);

  validateResult(
    records,
    documents,
    sources,
    minimumFacilityCount,
  );
  validateMonthlyData(records, previousSnapshot, {
    expectedPrefectureCodes: [...new Set(sources.flatMap((source) =>
      SOURCE_PREFECTURE_CODES[source.id] ?? []
    ))],
  });
  const manifest = buildManifest(records, documents, sources);
  await writeStaticData(records, manifest, options.outputDirectory);

  progress(
    options,
    `${manifest.facilityCount}施設・${manifest.standardCount}施設基準を出力`,
  );
  return { manifest, warnings };
}
