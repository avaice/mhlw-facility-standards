import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeStaticData } from "./output.js";
import type {
  CompactFacilityRecord,
  DataManifest,
  FacilityRecord,
  FacilitySearchIndex,
  StandardCatalog,
} from "./types.js";

const record: FacilityRecord = {
  schemaVersion: 1,
  medicalInstitutionCode: "1810115202",
  localCode: "0115202",
  prefectureCode: "18",
  category: "medical",
  facility: {
    name: "テスト診療所",
    address: "福井県福井市",
  },
  standards: [
    {
      abbreviation: "外来感染",
      name: "外来感染対策向上加算",
      acceptanceNumber: "第109号",
      effectiveFrom: "2025-01-01",
    },
  ],
  asOf: "2026-07-01",
  sources: [{
    bureauId: "kinki",
    bureauName: "近畿厚生局",
    pageUrl: "https://kouseikyoku.mhlw.go.jp/kinki/source.html",
    documentUrl: "https://kouseikyoku.mhlw.go.jp/kinki/source.xlsx",
    documentSha256: "fixture",
    workbook: "source.xlsx",
    worksheet: "医科",
  }],
};

const manifest: DataManifest = {
  schemaVersion: 1,
  generatedAt: "2026-07-10T00:00:00.000Z",
  asOf: "2026-07-01",
  shardPrefixLength: 4,
  facilityCount: 1,
  standardCount: 1,
  sources: [],
};

describe("writeStaticData", () => {
  it("コード先頭4桁のJSONシャードを生成する", async () => {
    const root = await mkdtemp(path.join(process.cwd(), "test-output-"));
    const output = path.join(root, "v1");

    try {
      await mkdir(path.join(output, "changes"), { recursive: true });
      await writeFile(
        path.join(output, "changes", "sentinel.json"),
        "existing changes",
      );
      await writeStaticData([record], manifest, output);
      const json = JSON.parse(
        await readFile(path.join(output, "facilities", "1810.json"), "utf8"),
      ) as { facilities: Record<string, CompactFacilityRecord> };
      expect(json.facilities["1810115202"]?.name).toBe(
        "テスト診療所",
      );
      expect(json.facilities["1810115202"]?.sourceDocuments).toEqual([
        "https://kouseikyoku.mhlw.go.jp/kinki/source.xlsx",
      ]);
      const catalog = JSON.parse(
        await readFile(path.join(output, "catalog.json"), "utf8"),
      ) as StandardCatalog;
      const standardId =
        json.facilities["1810115202"]?.standards[0]?.[0] ?? "";
      expect(catalog.standards[standardId]?.name).toBe(
        "外来感染対策向上加算",
      );
      const search = JSON.parse(
        await readFile(path.join(output, "search.json"), "utf8"),
      ) as FacilitySearchIndex;
      expect(search.generatedAt).toBe("2026-07-10T00:00:00.000Z");
      expect(search.facilities).toEqual([
        ["1810115202", "テスト診療所", "福井県福井市", "medical"],
      ]);
      expect(
        await readFile(path.join(output, "changes", "sentinel.json"), "utf8"),
      ).toBe("existing changes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
