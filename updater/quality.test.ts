import { describe, expect, it } from "vitest";
import { validateMonthlyData } from "./quality.js";
import type {
  DataManifest,
  FacilityCategory,
  FacilityRecord,
  FacilitySearchIndex,
} from "./types.js";

const POINT: Record<FacilityCategory, string> = {
  medical: "1",
  dental: "3",
  pharmacy: "4",
};

function record(
  category: FacilityCategory,
  sequence: number,
  name = `施設${sequence}`,
): FacilityRecord {
  const localCode = String(sequence).padStart(7, "0");
  const medicalInstitutionCode = `18${POINT[category]}${localCode}`;
  return {
    schemaVersion: 1,
    medicalInstitutionCode,
    localCode,
    prefectureCode: "18",
    category,
    facility: { name, address: "福井県福井市" },
    standards: [{
      abbreviation: "外来感染",
      name: "外来感染対策向上加算",
      acceptanceNumber: `第${sequence}号`,
      effectiveFrom: "2026-07-01",
    }],
    asOf: "2026-07-01",
    sources: [{
      bureauId: "kinki",
      bureauName: "近畿厚生局",
      pageUrl: "https://example.test/source.html",
      documentUrl: "https://example.test/source.xlsx",
      documentSha256: "a".repeat(64),
      workbook: "source.xlsx",
      worksheet: "医科",
    }],
  };
}

function baseline(records: FacilityRecord[]) {
  const manifest: DataManifest = {
    schemaVersion: 1,
    generatedAt: "2026-07-01T00:00:00.000Z",
    asOf: "2026-07-01",
    shardPrefixLength: 4,
    facilityCount: records.length,
    standardCount: records.reduce(
      (sum, item) => sum + item.standards.length,
      0,
    ),
    sources: [],
  };
  const search: FacilitySearchIndex = {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    asOf: manifest.asOf,
    facilityCount: records.length,
    facilities: records.map((item) => [
      item.medicalInstitutionCode,
      item.facility.name,
      item.facility.address,
      item.category,
    ]),
  };
  return { manifest, search };
}

describe("validateMonthlyData", () => {
  it("全区分を含む整合した月次データを受理する", () => {
    const records = [
      record("medical", 1),
      record("dental", 2),
      record("pharmacy", 3),
    ];
    expect(() =>
      validateMonthlyData(records, baseline(records), {
        expectedPrefectureCodes: ["18"],
      })
    ).not.toThrow();
  });

  it("施設名への郵便番号混入を拒否する", () => {
    const records = [
      record("medical", 1, "誤読施設 〒910-0000"),
      record("dental", 2),
      record("pharmacy", 3),
    ];
    expect(() =>
      validateMonthlyData(records, null, {
        expectedPrefectureCodes: ["18"],
      })
    ).toThrow("施設名へ郵便番号が混入しています");
  });

  it("都道府県・区分セルが前回比5%を超えて減少したら停止する", () => {
    const previous = [
      ...Array.from({ length: 100 }, (_, index) =>
        record("medical", index + 1)),
      ...Array.from({ length: 100 }, (_, index) =>
        record("dental", index + 1)),
      ...Array.from({ length: 100 }, (_, index) =>
        record("pharmacy", index + 1)),
    ];
    const current = [
      ...previous.slice(0, 94),
      ...previous.slice(100),
    ];
    expect(() =>
      validateMonthlyData(current, baseline(previous), {
        expectedPrefectureCodes: ["18"],
      })
    ).toThrow("18:medicalの施設数が前回比6.0%減少しました");
  });
});
