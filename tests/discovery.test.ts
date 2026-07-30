import { describe, expect, it } from "vitest";
import { discoverDocuments } from "../src/discovery.js";
import type { SourceDefinition } from "../src/types.js";

const source: SourceDefinition = {
  id: "fixture",
  bureauName: "テスト厚生局",
  pageUrl: "https://kouseikyoku.mhlw.go.jp/test/index.html",
  targetSection: /届出受理医療機関名簿/u,
  excludedSection: /保険外|届出項目別/u,
};

describe("discoverDocuments", () => {
  it("最新の全体版Excel/ZIPだけを検出する", () => {
    const html = `
      <html><body>
        <h1>届出受理医療機関名簿</h1>
        <p>令和8年7月1日現在</p>
        <table>
          <tr><th>医科</th><td><a href="./latest_ika.xlsx">Excel</a></td></tr>
          <tr><th>歯科</th><td><a href="./latest_shika.zip">ZIP</a></td></tr>
        </table>
        <h2>保険外併用療養費</h2>
        <p><a href="./excluded.zip">ZIP</a></p>
        <h2>届出受理医療機関名簿 過去分</h2>
        <p>令和8年6月1日現在</p>
        <p><a href="./old.zip">ZIP</a></p>
      </body></html>
    `;

    const result = discoverDocuments(source, html);
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.documentUrl)).toEqual([
      "https://kouseikyoku.mhlw.go.jp/test/latest_ika.xlsx",
      "https://kouseikyoku.mhlw.go.jp/test/latest_shika.zip",
    ]);
    expect(result[0]?.categoryHint).toBe("medical");
    expect(result[1]?.categoryHint).toBe("dental");
    expect(result.every((item) => item.asOf === "2026-07-01")).toBe(true);
  });
});
