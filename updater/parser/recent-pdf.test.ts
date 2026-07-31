import { describe, expect, it } from "vitest";
import type { DownloadedRecentDocument } from "../types.js";
import {
  parseRecentPdf,
  parseRecentPdfPages,
  type PositionedText,
} from "./recent-pdf.js";

const document: DownloadedRecentDocument = {
  sourceId: "fixture",
  bureauName: "テスト厚生局",
  pageUrl: "https://kouseikyoku.mhlw.go.jp/test/recent.html",
  documentUrl: "https://kouseikyoku.mhlw.go.jp/test/recent.pdf",
  asOf: "2026-07-15",
  categoryHint: "medical",
  context: "東京都 医科 新規・変更",
  action: "upsert",
  prefectureCodeHint: "13",
  bytes: Buffer.alloc(0),
  sha256: "fixture-sha256",
};

function item(x: number, y: number, text: string): PositionedText {
  return { x, y, text };
}

describe("parseRecentPdfPages", () => {
  it("座標付きPDFテキストから施設・住所・複数の施設基準を解析する", () => {
    const result = parseRecentPdfPages(document, [{
      page: 1,
      items: [
        item(10, 50, "医 療 機 関 番 号"),
        item(100, 50, "医 療 機 関 名 称"),
        item(220, 50, "医 療 機 関 所 在 地"),
        item(500, 50, "受 理 内 容"),
        item(10, 80, "01,2345,6"),
        item(10, 90, "千代田医2345"),
        item(90, 80, "テスト"),
        item(90, 90, "診療所"),
        item(210, 80, "〒100-0001"),
        item(210, 90, "東京都千代田区千代田1番"),
        item(380, 80, "外来感染対策向上加算"),
        item(410, 90, "（外来感染）第10号"),
        item(600, 90, "算定開始年月日：令和8年7月1日"),
        item(380, 110, "医療DX推進体制整備加算"),
        item(410, 120, "（医療DX）第20号"),
        item(600, 120, "算定開始年月日：令和8年7月1日"),
      ],
    }]);

    expect(result.warnings).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      medicalInstitutionCode: "1310123456",
      name: "テスト 診療所",
      address: "東京都千代田区千代田1番",
      category: "medical",
    });
    expect(result.records[0]?.events.map((event) => ({
      abbreviation: event.standard.abbreviation,
      name: event.standard.name,
      effectiveFrom: event.effectiveFrom,
    })).sort((a, b) =>
      (a.abbreviation ?? "").localeCompare(b.abbreviation ?? "", "ja")
    )).toEqual([
      {
        abbreviation: "医療DX",
        name: "医療DX推進体制整備加算",
        effectiveFrom: "2026-07-01",
      },
      {
        abbreviation: "外来感染",
        name: "外来感染対策向上加算",
        effectiveFrom: "2026-07-01",
      },
    ]);
  });

  it("失効表の略称をremoveイベントとして解析する", () => {
    const result = parseRecentPdfPages({
      ...document,
      action: "remove",
      context: "東京都 医科 辞退",
    }, [{
      page: 1,
      items: [
        item(70, 50, "医療機関番号"),
        item(155, 50, "医療機関名称"),
        item(257, 50, "医療機関所在地"),
        item(400, 45, "開設者氏名"),
        item(512, 50, "失効内容"),
        item(587, 50, "失効事由"),
        item(64, 80, "01-23456"),
        item(143, 80, "テスト診療所"),
        item(233, 80, "〒100-0001"),
        item(233, 90, "東京都千代田区千代田1番"),
        item(493, 80, "外来感染"),
        item(587, 80, "届出辞退"),
        item(645, 80, "令和8年7月1日"),
      ],
    }]);

    expect(result.records[0]?.medicalInstitutionCode).toBe("1310123456");
    expect(result.records[0]?.address).toBe("東京都千代田区千代田1番");
    expect(result.records[0]?.events).toHaveLength(1);
    expect(result.records[0]?.events[0]).toMatchObject({
      action: "remove",
      standard: { abbreviation: "外来感染", name: null },
      effectiveFrom: "2026-07-01",
    });
  });

  it("認識済みヘッダーだけの空ページは警告にして他ページを処理する", () => {
    const validPage = {
      page: 1,
      items: [
        item(10, 50, "医 療 機 関 番 号"),
        item(100, 50, "医 療 機 関 名 称"),
        item(220, 50, "医 療 機 関 所 在 地"),
        item(500, 50, "受 理 内 容"),
        item(10, 80, "01,2345,6"),
        item(90, 80, "テスト診療所"),
        item(210, 80, "東京都千代田区"),
        item(380, 80, "外来感染対策向上加算"),
        item(410, 90, "（外来感染）第10号"),
        item(600, 90, "算定開始年月日：令和8年7月1日"),
      ],
    };
    const result = parseRecentPdfPages(document, [validPage, {
      page: 2,
      items: [
        item(10, 50, "医 療 機 関 番 号"),
        item(100, 50, "医 療 機 関 名 称"),
        item(220, 50, "医 療 機 関 所 在 地"),
        item(500, 50, "受 理 内 容"),
      ],
    }]);

    expect(result.records).toHaveLength(1);
    expect(result.warnings).toEqual([
      `${document.documentUrl} 2ページ: 対象行なし`,
    ]);
  });

  it("ヘッダー下に行があるのに施設コードを解析できなければ停止する", () => {
    expect(() => parseRecentPdfPages(document, [{
      page: 1,
      items: [
        item(10, 50, "医 療 機 関 番 号"),
        item(100, 50, "医 療 機 関 名 称"),
        item(220, 50, "医 療 機 関 所 在 地"),
        item(500, 50, "受 理 内 容"),
        item(10, 80, "判読不能"),
        item(90, 80, "テスト診療所"),
        item(210, 80, "東京都千代田区"),
        item(380, 80, "外来感染対策向上加算"),
      ],
    }])).toThrow("施設コードを解析できません");
  });

  it("施設名・住所欄が空の継続ページを直前の施設へ連結する", () => {
    const result = parseRecentPdfPages(document, [
      {
        page: 1,
        items: [
          item(10, 50, "医 療 機 関 番 号"),
          item(100, 50, "医 療 機 関 名 称"),
          item(220, 50, "医 療 機 関 所 在 地"),
          item(500, 50, "受 理 内 容"),
          item(10, 80, "01,2345,6"),
          item(90, 80, "テスト診療所"),
          item(210, 80, "東京都千代田区"),
          item(380, 80, "外来感染対策向上加算"),
          item(410, 90, "（外来感染）第10号"),
          item(600, 90, "算定開始年月日：令和8年7月1日"),
        ],
      },
      {
        page: 2,
        items: [
          item(10, 50, "医 療 機 関 番 号"),
          item(100, 50, "医 療 機 関 名 称"),
          item(220, 50, "医 療 機 関 所 在 地"),
          item(500, 50, "受 理 内 容"),
          item(380, 80, "医療DX推進体制整備加算"),
          item(410, 90, "（医療DX）第20号"),
          item(600, 90, "算定開始年月日：令和8年7月1日"),
        ],
      },
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      medicalInstitutionCode: "1310123456",
      name: "テスト診療所",
      address: "東京都千代田区",
    });
    expect(result.records[0]?.events).toHaveLength(2);
    expect(
      result.records[0]?.events.map((event) => event.page).sort(),
    ).toEqual([1, 2]);
  });

  it("同一ページの一部施設だけコード解析に失敗しても停止する", () => {
    expect(() => parseRecentPdfPages(document, [{
      page: 1,
      items: [
        item(10, 50, "医 療 機 関 番 号"),
        item(100, 50, "医 療 機 関 名 称"),
        item(220, 50, "医 療 機 関 所 在 地"),
        item(500, 50, "受 理 内 容"),
        item(10, 80, "01,2345,6"),
        item(90, 80, "読取成功診療所"),
        item(210, 80, "東京都千代田区"),
        item(380, 80, "外来感染対策向上加算"),
        item(410, 90, "（外来感染）第10号"),
        item(600, 90, "算定開始年月日：令和8年7月1日"),
        item(10, 120, "コード判読不能"),
        item(90, 120, "読取失敗診療所"),
        item(210, 120, "東京都中央区"),
        item(380, 120, "医療DX推進体制整備加算"),
        item(410, 130, "（医療DX）第20号"),
        item(600, 130, "算定開始年月日：令和8年7月1日"),
      ],
    }])).toThrow("施設コードを解析できません");
  });
});

describe("parseRecentPdf", () => {
  it("SHA-256固定の目視確認済み画像PDFだけを公開データへ変換する", async () => {
    const result = await parseRecentPdf({
      ...document,
      sourceId: "kyushu",
      bureauName: "九州厚生局",
      documentUrl: "https://kouseikyoku.mhlw.go.jp/kyushu/000492894.pdf",
      sha256:
        "bf3d8e2fb8360dbb55d127006b1bae0f8a04afb16cf697fd48b4b81b25c8d2d6",
      asOf: "2026-06-06",
      categoryHint: "pharmacy",
      context: "大分県 薬局 新規・変更",
    });

    expect(result.records).toHaveLength(2);
    expect(result.records.flatMap((record) => record.events)).toHaveLength(13);
    expect(result.records.map((record) => record.name)).toEqual([
      "さとかん薬局日赤前店",
      "あき調剤薬局",
    ]);
    expect(result.records.flatMap((record) => record.events).every((event) =>
      event.extractionMethod === "ocr-reviewed" &&
      event.reviewStatus === "manual-reviewed" &&
      event.effectiveFrom !== null
    )).toBe(true);
    expect(result.warnings).toEqual([
      "https://kouseikyoku.mhlw.go.jp/kyushu/000492894.pdf: SHA-256固定の目視確認済み転記を使用",
    ]);
  });
});
