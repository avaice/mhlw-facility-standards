import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./workbook.js";
import type { WorkbookDocument } from "../types.js";

async function fixtureWorkbook(): Promise<WorkbookDocument> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("医科");
  sheet.addRow(["[ 福井県 ] 届出受理医療機関名簿 医科"]);
  sheet.addRow([]);
  sheet.addRow([
    "項番",
    "医療機関番号",
    "医療機関名称",
    "医療機関所在地",
    "受理届出名称",
    "受理記号",
    "受理番号",
    "算定開始年月日",
  ]);
  sheet.addRow([
    1,
    "01-15202",
    "公益財団法人 福井県予防医学協会附属診療所",
    "福井県福井市和田2-1006",
    "外来感染対策向上加算",
    "外来感染",
    "第109号",
    "令和7年1月1日",
  ]);
  sheet.addRow([
    "",
    "",
    "",
    "",
    "連携強化加算",
    "連携強化",
    "第50号",
    "令和6年6月1日",
  ]);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    source: {
      sourceId: "kinki",
      bureauName: "近畿厚生局",
      pageUrl: "https://kouseikyoku.mhlw.go.jp/kinki/example.html",
      documentUrl: "https://kouseikyoku.mhlw.go.jp/kinki/example.zip",
      asOf: "2026-07-01",
      categoryHint: "medical",
      context: "施設基準の届出受理状況（全体） 医科",
      sha256: "a".repeat(64),
    },
    fileName: "fukui_ika.xlsx",
    bytes: buffer,
  };
}

describe("parseWorkbook", () => {
  it("医療機関コードを10桁化し、複数の施設基準を束ねる", async () => {
    const parsed = await parseWorkbook(await fixtureWorkbook());

    expect(parsed.records).toHaveLength(1);
    const record = parsed.records[0];
    expect(record?.medicalInstitutionCode).toBe("1810115202");
    expect(record?.category).toBe("medical");
    expect(record?.standards).toHaveLength(2);
    expect(record?.standards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abbreviation: "外来感染",
          name: "外来感染対策向上加算",
          acceptanceNumber: "第109号",
          effectiveFrom: "2025-01-01",
        }),
        expect.objectContaining({
          abbreviation: "連携強化",
          name: "連携強化加算",
          acceptanceNumber: "第50号",
          effectiveFrom: "2024-06-01",
        }),
      ]),
    );
  });
});
