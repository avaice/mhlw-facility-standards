import { describe, expect, it } from "vitest";
import { discoverRecentDocuments } from "./recent-discovery.js";
import type { RecentSourceDefinition } from "./types.js";

const source: RecentSourceDefinition = {
  sourceId: "fixture",
  bureauName: "テスト厚生局",
  pageUrl: "https://kouseikyoku.mhlw.go.jp/test/recent.html",
  prefectureCodeHint: "13",
};

describe("discoverRecentDocuments", () => {
  it("基準日より後の医歯薬PDFを区分・操作付きで検出する", () => {
    const html = `
      <html><body>
        <h1>施設基準の届出受理状況</h1>
        <h2>令和8年7月15日掲載</h2>
        <table>
          <tr><th>医科</th><th>歯科</th><th>薬局</th><th>訪問看護</th></tr>
          <tr>
            <td><a href="./new_ika.pdf">新規・変更</a></td>
            <td><a href="./remove_shika.pdf">辞退</a></td>
            <td><a href="./new_yakkyoku.pdf">新規・変更</a></td>
            <td><a href="./houkan.pdf">訪問看護</a></td>
          </tr>
        </table>
        <p><a href="./search.pdf">PDFファイル内を検索する方法</a></p>
        <h2>令和8年7月1日掲載</h2>
        <p><a href="./old_ika.pdf">医科 新規・変更</a></p>
      </body></html>
    `;

    const result = discoverRecentDocuments(source, html, "2026-07-01");
    expect(result.map((document) => [
      document.documentUrl,
      document.categoryHint,
      document.action,
      document.asOf,
    ])).toEqual([
      [
        "https://kouseikyoku.mhlw.go.jp/test/new_ika.pdf",
        "medical",
        "upsert",
        "2026-07-15",
      ],
      [
        "https://kouseikyoku.mhlw.go.jp/test/new_yakkyoku.pdf",
        "pharmacy",
        "upsert",
        "2026-07-15",
      ],
      [
        "https://kouseikyoku.mhlw.go.jp/test/remove_shika.pdf",
        "dental",
        "remove",
        "2026-07-15",
      ],
    ]);
  });
});
