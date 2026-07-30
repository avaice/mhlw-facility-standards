import { describe, expect, it } from "vitest";
import {
  extractAsOfDates,
  parseJapaneseDate,
} from "../src/utils/date.js";

describe("parseJapaneseDate", () => {
  it("和暦をISO日付へ変換する", () => {
    expect(parseJapaneseDate("令和8年7月1日")).toBe("2026-07-01");
    expect(parseJapaneseDate("平成30年4月1日")).toBe("2018-04-01");
    expect(parseJapaneseDate("令和元年5月1日")).toBe("2019-05-01");
  });

  it("掲載基準日を抽出する", () => {
    expect(
      extractAsOfDates("令和8年7月1日現在 / 令和8年6月1日現在"),
    ).toEqual(["2026-07-01", "2026-06-01"]);
  });
});
