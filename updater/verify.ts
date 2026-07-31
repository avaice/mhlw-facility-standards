import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { applyChangeEvent } from "../shared/apply-change-event.js";
import { PREFECTURES } from "./config/prefectures.js";
import { validateRecentData } from "./recent-quality.js";
import type {
  ChangeManifest,
  ChangeSearchIndex,
  CompactFacilityRecord,
  DataManifest,
  FacilityCategory,
  FacilityChangeRecord,
  FacilityChangeShard,
  FacilitySearchIndex,
  FacilityShard,
  StandardCatalog,
} from "./types.js";
import { maxIsoDate } from "./utils/date.js";

const CATEGORY_POINT_TABLE: Record<FacilityCategory, string> = {
  medical: "1",
  dental: "3",
  pharmacy: "4",
};

export interface StaticDataVerification {
  facilityCount: number;
  standardCount: number;
  shardCount: number;
  changeFacilityCount: number;
  changeEventCount: number;
  changeShardCount: number;
  unresolvedChangeCount: number;
  appliedChangeCount: number;
  noOpChangeCount: number;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function jsonFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyDocumentUrl(url: string, sha256: string, label: string): void {
  assert(/^https:\/\//u.test(url), `${label}: 原資料URLが不正です`);
  assert(/^[a-f0-9]{64}$/u.test(sha256), `${label}: SHA-256が不正です`);
}

function facilityTuple(
  record: Pick<CompactFacilityRecord, "name" | "address" | "category">,
): string {
  return JSON.stringify([record.name, record.address, record.category]);
}

export async function verifyStaticData(
  outputDirectory: string,
): Promise<StaticDataVerification> {
  const output = path.resolve(outputDirectory);
  const [manifest, search, catalog] = await Promise.all([
    readJson<DataManifest>(path.join(output, "manifest.json")),
    readJson<FacilitySearchIndex>(path.join(output, "search.json")),
    readJson<StandardCatalog>(path.join(output, "catalog.json")),
  ]);
  assert(manifest.schemaVersion === 1, "月次manifestのschemaVersionが不正です");
  assert(search.schemaVersion === 1, "月次検索索引のschemaVersionが不正です");
  assert(catalog.schemaVersion === 1, "基準台帳のschemaVersionが不正です");
  assert(manifest.shardPrefixLength === 4, "シャード接頭辞長が不正です");
  assert(search.generatedAt === manifest.generatedAt, "月次生成時刻が不一致です");
  assert(search.asOf === manifest.asOf, "月次基準日が不一致です");
  assert(
    search.facilityCount === search.facilities.length,
    "月次検索索引の施設件数が不一致です",
  );

  const sourceIds = new Set<string>();
  const sourceFacilityCounts = new Map<string, number>();
  const sourceDocuments = new Map<string, string>();
  for (const source of manifest.sources) {
    assert(!sourceIds.has(source.id), `月次source IDが重複しています: ${source.id}`);
    sourceIds.add(source.id);
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(source.asOf), `${source.id}: 基準日が不正です`);
    assert(source.documents.length > 0, `${source.id}: 原資料がありません`);
    for (const document of source.documents) {
      verifyDocumentUrl(document.url, document.sha256, source.id);
      const existing = sourceDocuments.get(document.url);
      assert(
        !existing || existing === document.sha256,
        `${document.url}: 月次原資料ハッシュが競合しています`,
      );
      sourceDocuments.set(document.url, document.sha256);
    }
  }
  assert(
    manifest.asOf === maxIsoDate(manifest.sources.map((source) => source.asOf)),
    "月次manifestの全体基準日が地域別基準日と一致しません",
  );

  const searchFacilities = new Map<string, string>();
  for (const [code, name, address, category] of search.facilities) {
    assert(!searchFacilities.has(code), `月次検索索引のコードが重複しています: ${code}`);
    searchFacilities.set(code, JSON.stringify([name, address, category]));
  }

  const facilities = new Map<string, CompactFacilityRecord>();
  const referencedStandards = new Set<string>();
  const distribution = new Map<string, number>();
  let standardCount = 0;
  const facilityFiles = await jsonFiles(path.join(output, "facilities"));
  for (const file of facilityFiles) {
    const prefix = file.slice(0, -5);
    const shard = await readJson<FacilityShard>(
      path.join(output, "facilities", file),
    );
    assert(shard.schemaVersion === 1, `${file}: schemaVersionが不正です`);
    assert(shard.prefix === prefix, `${file}: prefixが不一致です`);
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(shard.asOf), `${file}: 基準日が不正です`);
    for (const [code, facility] of Object.entries(shard.facilities)) {
      assert(code.startsWith(prefix), `${code}: シャードが不正です`);
      assert(/^\d{2}[134]\d{7}$/u.test(code), `${code}: コードが不正です`);
      assert(!facilities.has(code), `${code}: 月次施設が重複しています`);
      assert(code[2] === CATEGORY_POINT_TABLE[facility.category], `${code}: 区分が不一致です`);
      assert(facility.name.trim(), `${code}: 施設名がありません`);
      assert(!/〒\s*\d{3}/u.test(facility.name), `${code}: 施設名へ郵便番号が混入しています`);
      assert(facility.address?.trim(), `${code}: 所在地がありません`);
      assert(facility.sourceIds.length > 0, `${code}: source IDがありません`);
      assert(facility.sourceDocuments?.length, `${code}: 原資料URLがありません`);
      for (const sourceId of new Set(facility.sourceIds)) {
        assert(sourceIds.has(sourceId), `${code}: 未知のsource IDです: ${sourceId}`);
        sourceFacilityCounts.set(
          sourceId,
          (sourceFacilityCounts.get(sourceId) ?? 0) + 1,
        );
      }
      for (const documentUrl of facility.sourceDocuments ?? []) {
        assert(sourceDocuments.has(documentUrl), `${code}: manifestにない原資料URLです`);
      }
      assert(facility.standards.length > 0, `${code}: 施設基準がありません`);
      const tuples = new Set<string>();
      for (const [standardId, acceptanceNumber, effectiveFrom] of facility.standards) {
        const tuple = JSON.stringify([standardId, acceptanceNumber, effectiveFrom]);
        assert(!tuples.has(tuple), `${code}: 施設基準タプルが重複しています`);
        tuples.add(tuple);
        const definition = catalog.standards[standardId];
        assert(definition, `${code}: 基準台帳にないstandard IDです: ${standardId}`);
        assert(definition.abbreviation && definition.name, `${standardId}: 基準定義が不完全です`);
        assert(acceptanceNumber, `${code}: 受理番号がありません`);
        assert(
          effectiveFrom && /^\d{4}-\d{2}-\d{2}$/u.test(effectiveFrom),
          `${code}: 算定開始日がありません`,
        );
        referencedStandards.add(standardId);
        standardCount += 1;
      }
      const key = `${code.slice(0, 2)}:${facility.category}`;
      distribution.set(key, (distribution.get(key) ?? 0) + 1);
      facilities.set(code, facility);
    }
  }

  assert(facilities.size === manifest.facilityCount, "月次manifestの施設件数が不一致です");
  assert(facilities.size === search.facilityCount, "月次検索索引の施設件数が不一致です");
  assert(standardCount === manifest.standardCount, "月次manifestの施設基準件数が不一致です");
  assert(
    referencedStandards.size === Object.keys(catalog.standards).length,
    "基準台帳に未参照または未収載の定義があります",
  );
  for (const [code, facility] of facilities) {
    assert(
      searchFacilities.get(code) === facilityTuple(facility),
      `${code}: 月次検索索引の施設属性が不一致です`,
    );
  }
  for (const source of manifest.sources) {
    assert(
      (sourceFacilityCounts.get(source.id) ?? 0) === source.facilityCount,
      `${source.id}: source施設件数が不一致です`,
    );
  }
  for (const [prefectureCode] of PREFECTURES) {
    for (const category of ["medical", "dental", "pharmacy"] as const) {
      assert(
        (distribution.get(`${prefectureCode}:${category}`) ?? 0) > 0,
        `${prefectureCode}:${category}: 月次施設がありません`,
      );
    }
  }

  const changesRoot = path.join(output, "changes");
  const [changeManifest, changeSearch] = await Promise.all([
    readJson<ChangeManifest>(path.join(changesRoot, "manifest.json")),
    readJson<ChangeSearchIndex>(path.join(changesRoot, "search.json")),
  ]);
  assert(changeManifest.schemaVersion === 1, "差分manifestのschemaVersionが不正です");
  assert(changeSearch.schemaVersion === 1, "差分検索索引のschemaVersionが不正です");
  assert(changeManifest.quality, "差分manifestに品質状態がありません");
  assert(changeManifest.baseAsOf === manifest.asOf, "差分の月次基準日が不一致です");
  assert(changeSearch.baseAsOf === changeManifest.baseAsOf, "差分検索の基準日が不一致です");
  assert(changeSearch.latestAsOf === changeManifest.latestAsOf, "差分検索の最新日が不一致です");
  assert(changeSearch.generatedAt === changeManifest.generatedAt, "差分生成時刻が不一致です");

  const changeSources = new Map(changeManifest.sources.map((source) => [source.id, source]));
  assert(changeSources.size === changeManifest.sources.length, "差分source IDが重複しています");
  const changeDocuments = new Map<string, {
    sourceId: string;
    sha256: string;
    publishedAt: string;
    action: "upsert" | "remove";
  }>();
  const baseSources = new Map(manifest.sources.map((source) => [source.id, source]));
  for (const source of changeManifest.sources) {
    assert(source.baseAsOf === baseSources.get(source.id)?.asOf, `${source.id}: 地域基準日が不一致です`);
    for (const document of source.documents) {
      verifyDocumentUrl(document.url, document.sha256, source.id);
      assert(!changeDocuments.has(document.url), `${document.url}: 差分文書が重複しています`);
      assert(document.publishedAt > source.baseAsOf, `${document.url}: 地域基準日以前の差分です`);
      changeDocuments.set(document.url, { sourceId: source.id, ...document });
    }
  }
  assert(
    changeManifest.latestAsOf ===
      (maxIsoDate([...changeDocuments.values()].map((document) => document.publishedAt)) ??
        changeManifest.baseAsOf),
    "差分manifestの最新日が不一致です",
  );

  const changeRecords: FacilityChangeRecord[] = [];
  const changeFacilities = new Set<string>();
  const changeFiles = await jsonFiles(path.join(changesRoot, "facilities"));
  for (const file of changeFiles) {
    const prefix = file.slice(0, -5);
    const shard = await readJson<FacilityChangeShard>(
      path.join(changesRoot, "facilities", file),
    );
    assert(shard.prefix === prefix, `${file}: 差分prefixが不一致です`);
    assert(shard.baseAsOf === changeManifest.baseAsOf, `${file}: 差分基準日が不一致です`);
    for (const [code, facility] of Object.entries(shard.facilities)) {
      assert(code.startsWith(prefix), `${code}: 差分シャードが不正です`);
      assert(!changeFacilities.has(code), `${code}: 差分施設が重複しています`);
      changeFacilities.add(code);
      const base = facilities.get(code);
      if (base) {
        assert(facilityTuple(facility) === facilityTuple(base), `${code}: 月次施設属性と差分施設属性が不一致です`);
      }
      for (const event of facility.events) {
        assert(event.reviewStatus, `${event.id}: reviewStatusがありません`);
        const document = changeDocuments.get(event.documentUrl);
        assert(document, `${event.id}: manifestにない差分文書です`);
        assert(document.sourceId === event.sourceId, `${event.id}: source IDが不一致です`);
        assert(document.sha256 === event.documentSha256, `${event.id}: 文書SHA-256が不一致です`);
        assert(document.publishedAt === event.publishedAt, `${event.id}: 掲載日が不一致です`);
        assert(document.action === event.action, `${event.id}: 操作種別が不一致です`);
      }
      changeRecords.push({ medicalInstitutionCode: code, ...facility });
    }
  }
  validateRecentData(changeRecords);
  const changeEventCount = changeRecords.reduce(
    (sum, record) => sum + record.events.length,
    0,
  );
  const unresolvedChangeCount = changeRecords.reduce(
    (sum, record) =>
      sum + record.events.filter((event) => event.reviewStatus === "needs-review").length,
    0,
  );
  let appliedChangeCount = 0;
  let noOpChangeCount = 0;
  let runtimeUnresolvedCount = 0;
  for (const record of changeRecords) {
    const base = facilities.get(record.medicalInstitutionCode);
    const standards = (base?.standards ?? []).map(
      ([standardId, acceptanceNumber, effectiveFrom]) => ({
        standardId,
        record: {
          ...(catalog.standards[standardId] ?? {
            abbreviation: null,
            name: null,
          }),
          acceptanceNumber,
          effectiveFrom,
        },
      }),
    );
    const events = [...record.events].sort(
      (a, b) =>
        a.publishedAt.localeCompare(b.publishedAt) ||
        (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1) ||
        a.id.localeCompare(b.id),
    );
    for (const event of events) {
      const result = applyChangeEvent(standards, event);
      if (result === "applied") {
        appliedChangeCount += 1;
      } else if (result === "no-op") {
        noOpChangeCount += 1;
      } else {
        runtimeUnresolvedCount += 1;
        assert(
          event.reviewStatus === "needs-review",
          `${event.id}: 確定イベントを一意に適用できません`,
        );
      }
    }
  }
  const reviewedOcrDocuments = new Set(
    changeRecords.flatMap((record) =>
      record.events.flatMap((event) =>
        event.extractionMethod === "ocr-reviewed" ? [event.documentUrl] : []
      )
    ),
  );
  const unresolvedByReason = Object.fromEntries(
    Object.keys(changeManifest.quality.unresolvedByReason).map((reason) => [
      reason,
      0,
    ]),
  ) as Record<string, number>;
  for (const record of changeRecords) {
    for (const event of record.events) {
      for (const reason of event.reviewReasons ?? []) {
        assert(
          reason in unresolvedByReason,
          `${event.id}: manifestにない要確認理由です: ${reason}`,
        );
        unresolvedByReason[reason] = (unresolvedByReason[reason] ?? 0) + 1;
      }
    }
  }
  assert(changeFacilities.size === changeManifest.facilityCount, "差分施設件数が不一致です");
  assert(changeEventCount === changeManifest.eventCount, "差分イベント件数が不一致です");
  assert(
    unresolvedChangeCount === changeManifest.quality.unresolvedEventCount,
    "差分の要確認件数が不一致です",
  );
  assert(
    runtimeUnresolvedCount === unresolvedChangeCount,
    "生成時と利用時の要確認件数が不一致です",
  );
  assert(
    reviewedOcrDocuments.size === changeManifest.quality.reviewedOcrDocumentCount,
    "目視確認済み画像PDF件数が不一致です",
  );
  assert(
    JSON.stringify(unresolvedByReason) ===
      JSON.stringify(changeManifest.quality.unresolvedByReason),
    "差分の要確認理由別件数が不一致です",
  );
  assert(
    changeManifest.quality.status ===
      (unresolvedChangeCount > 0 ? "needs-review" : "verified"),
    "差分品質状態が不一致です",
  );
  assert(
    Number.isInteger(changeManifest.quality.retainedDocumentCount) &&
      changeManifest.quality.retainedDocumentCount >= 0 &&
      changeManifest.quality.retainedDocumentCount <= changeDocuments.size,
    "保持文書件数が不正です",
  );

  const expectedChangeSearch = new Map(changeRecords.map((record) => [
    record.medicalInstitutionCode,
    JSON.stringify([record.name, record.address, record.category]),
  ]));
  assert(
    changeSearch.facilities.length === expectedChangeSearch.size,
    "差分検索索引の施設件数が不一致です",
  );
  const seenChangeSearch = new Set<string>();
  for (const [code, name, address, category] of changeSearch.facilities) {
    assert(!seenChangeSearch.has(code), `${code}: 差分検索索引が重複しています`);
    seenChangeSearch.add(code);
    assert(
      expectedChangeSearch.get(code) === JSON.stringify([name, address, category]),
      `${code}: 差分検索索引の施設属性が不一致です`,
    );
  }

  return {
    facilityCount: facilities.size,
    standardCount,
    shardCount: facilityFiles.length,
    changeFacilityCount: changeFacilities.size,
    changeEventCount,
    changeShardCount: changeFiles.length,
    unresolvedChangeCount,
    appliedChangeCount,
    noOpChangeCount,
  };
}
