import { describe, expect, it } from "vitest";
import { parseWorkbook } from "./workbook.js";
import type { WorkbookDocument } from "../types.js";

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: Record<string, string>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const fileName = Buffer.from(name, "utf8");
    const content = Buffer.from(value, "utf8");
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    localParts.push(local, fileName, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, fileName);
    offset += local.length + fileName.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function sheetXml(rows: string[][]): string {
  const cells = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const values = row.flatMap((value, columnIndex) => {
      if (!value) {
        return [];
      }
      const reference = `${String.fromCharCode(65 + columnIndex)}${rowNumber}`;
      return [
        `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`,
      ];
    });
    return `<row r="${rowNumber}">${values.join("")}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet><sheetData>${cells.join("")}</sheetData></worksheet>`;
}

function fixtureWorkbook(): WorkbookDocument {
  const rows = [
    ["[令和8年7月1日 現在] [福井県] 届出受理医療機関名簿 医科"],
    [],
    [
      "項番",
      "医療機関番号",
      "医療機関名称",
      "医療機関所在地",
      "受理届出名称",
      "受理記号",
      "受理番号",
      "算定開始年月日",
    ],
    [
      "1",
      "01-15202",
      "公益財団法人 福井県予防医学協会附属診療所",
      "福井県福井市和田2-1006",
      "外来感染対策向上加算",
      "外来感染",
      "第109号",
      "令和7年1月1日",
    ],
    ["", "", "", "", "連携強化加算", "連携強化", "第50号", "令和6年6月1日"],
  ];
  const buffer = storedZip({
    "xl/workbook.xml":
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="医科" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Relationships><Relationship Id="rId1" ` +
      `Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheetXml(rows),
  });
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
    const parsed = await parseWorkbook(fixtureWorkbook());

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

  it("掲載ページとワークブック内部の基準日が異なる場合は停止する", async () => {
    const fixture = fixtureWorkbook();
    await expect(parseWorkbook({
      ...fixture,
      source: { ...fixture.source, asOf: "2026-06-01" },
    })).rejects.toThrow("掲載ページの基準日 2026-06-01");
  });
});
