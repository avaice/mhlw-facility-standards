import type {
  DataManifest,
  FacilityCategory,
  FacilityRecord,
  FacilitySearchIndex,
} from "./types.js";

const CATEGORY_POINT_TABLE: Record<FacilityCategory, string> = {
  medical: "1",
  dental: "3",
  pharmacy: "4",
};

export interface MonthlyQualityBaseline {
  manifest: DataManifest;
  search: FacilitySearchIndex;
}

export interface MonthlyQualityOptions {
  expectedPrefectureCodes: readonly string[];
  maximumDecreaseRatio?: number;
}

function cellKey(
  prefectureCode: string,
  category: FacilityCategory,
): string {
  return `${prefectureCode}:${category}`;
}

function categoryCounts(
  facilities: Iterable<readonly [string, FacilityCategory]>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [code, category] of facilities) {
    const key = cellKey(code.slice(0, 2), category);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function assertNoLargeDecrease(
  label: string,
  current: number,
  previous: number,
  maximumDecreaseRatio: number,
): void {
  if (previous === 0 || current >= previous) {
    return;
  }
  const decreaseRatio = (previous - current) / previous;
  if (decreaseRatio > maximumDecreaseRatio) {
    throw new Error(
      `${label}が前回比${(decreaseRatio * 100).toFixed(1)}%減少しました: ` +
        `${previous} -> ${current}`,
    );
  }
}

export function validateMonthlyData(
  records: FacilityRecord[],
  baseline: MonthlyQualityBaseline | null,
  options: MonthlyQualityOptions,
): void {
  const maximumDecreaseRatio = options.maximumDecreaseRatio ?? 0.05;
  if (
    !Number.isFinite(maximumDecreaseRatio) ||
    maximumDecreaseRatio < 0 ||
    maximumDecreaseRatio >= 1
  ) {
    throw new Error(`不正な減少許容率です: ${maximumDecreaseRatio}`);
  }

  const codes = new Set<string>();
  for (const record of records) {
    const code = record.medicalInstitutionCode;
    if (!/^\d{2}[134]\d{7}$/u.test(code)) {
      throw new Error(`不正な医療機関コードです: ${code}`);
    }
    if (codes.has(code)) {
      throw new Error(`医療機関コードが重複しています: ${code}`);
    }
    codes.add(code);
    if (
      record.prefectureCode !== code.slice(0, 2) ||
      code[2] !== CATEGORY_POINT_TABLE[record.category]
    ) {
      throw new Error(`${code}: 都道府県または区分がコードと一致しません`);
    }
    if (!record.facility.name.trim()) {
      throw new Error(`${code}: 施設名がありません`);
    }
    if (/〒\s*\d{3}\s*[-ー－]?\s*\d{4}/u.test(record.facility.name)) {
      throw new Error(`${code}: 施設名へ郵便番号が混入しています`);
    }
    if (!record.facility.address?.trim()) {
      throw new Error(`${code}: 所在地がありません`);
    }
    if (record.standards.length === 0) {
      throw new Error(`${code}: 施設基準がありません`);
    }
    for (const standard of record.standards) {
      if (!standard.abbreviation || !standard.name) {
        throw new Error(`${code}: 施設基準の略称または名称がありません`);
      }
      if (!standard.acceptanceNumber) {
        throw new Error(`${code}: 受理番号がありません`);
      }
      if (!standard.effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/u.test(
        standard.effectiveFrom,
      )) {
        throw new Error(`${code}: 算定開始日がありません`);
      }
    }
    if (record.sources.length === 0) {
      throw new Error(`${code}: 原資料への来歴がありません`);
    }
    for (const source of record.sources) {
      if (!/^https:\/\//u.test(source.documentUrl)) {
        throw new Error(`${code}: 原資料URLが不正です`);
      }
      if (!/^[a-f0-9]{64}$/u.test(source.documentSha256)) {
        throw new Error(`${code}: 原資料SHA-256が不正です`);
      }
    }
  }

  const currentCounts = categoryCounts(
    records.map((record) => [record.medicalInstitutionCode, record.category]),
  );
  for (const prefectureCode of options.expectedPrefectureCodes) {
    for (const category of ["medical", "dental", "pharmacy"] as const) {
      const key = cellKey(prefectureCode, category);
      if ((currentCounts.get(key) ?? 0) === 0) {
        throw new Error(`${key}: 施設を1件も解析できません`);
      }
    }
  }

  if (!baseline) {
    return;
  }
  if (
    baseline.search.facilityCount !== baseline.search.facilities.length ||
    baseline.manifest.facilityCount !== baseline.search.facilityCount
  ) {
    throw new Error("前回スナップショットの施設件数が整合していません");
  }
  const previousCounts = categoryCounts(
    baseline.search.facilities.map(([code, , , category]) => [code, category]),
  );
  assertNoLargeDecrease(
    "施設総数",
    records.length,
    baseline.manifest.facilityCount,
    maximumDecreaseRatio,
  );
  for (const [key, previous] of previousCounts) {
    assertNoLargeDecrease(
      `${key}の施設数`,
      currentCounts.get(key) ?? 0,
      previous,
      maximumDecreaseRatio,
    );
  }
  const standardCount = records.reduce(
    (sum, record) => sum + record.standards.length,
    0,
  );
  assertNoLargeDecrease(
    "施設基準総数",
    standardCount,
    baseline.manifest.standardCount,
    maximumDecreaseRatio,
  );
}
