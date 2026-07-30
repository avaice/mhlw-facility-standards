import { describe, expect, it, vi } from "vitest";
import { extractMedicalInstitutionCode, FacilityStandardsClient } from "./client";

describe("FacilityStandardsClient", () => {
  it("10桁コードからシャードを選択し、同じシャードをキャッシュする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog.json")) {
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            standards: {
              abc123: {
                abbreviation: "外来感染",
                name: "外来感染対策向上加算",
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          asOf: "2026-07-01",
          prefix: "1810",
          facilities: {
            "1810115202": {
              name: "テスト診療所",
              address: null,
              category: "medical",
              sourceIds: ["kinki"],
              standards: [["abc123", "第109号", "2025-01-01"]],
            },
          },
        }),
        { status: 200 },
      );
    });
    const client = new FacilityStandardsClient({
      baseUrl: "https://example.test",
      fetch: fetchMock,
    });

    expect((await client.get("1810115202"))?.facility.name).toBe(
      "テスト診療所",
    );
    await client.get("1810115999");
    expect((await client.get("1810115202"))?.standards[0]?.name).toBe(
      "外来感染対策向上加算",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/facilities/1810.json",
    );
  });

  it("名称検索索引を一度だけ取得し、前方一致を優先して返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          generatedAt: "2026-07-10T00:00:00.000Z",
          asOf: "2026-07-01",
          facilityCount: 3,
          facilities: [
            ["1310123456", "中央さくら病院", "東京都", "medical"],
            ["1810115202", "さくら診療所", "福井県福井市", "medical"],
            ["2710123456", "うめだ薬局", "大阪府", "pharmacy"],
          ],
        }),
        { status: 200 },
      );
    });
    const client = new FacilityStandardsClient({
      baseUrl: "https://example.test",
      fetch: fetchMock,
    });

    const result = await client.searchByName("さくら", { limit: 1 });
    expect(result.totalMatchCount).toBe(2);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.[1]).toBe("さくら診療所");

    await client.searchByName("うめだ");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/search.json");
  });
});

describe("extractMedicalInstitutionCode", () => {
  it("区切り文字や全角数字を吸収して10桁コードを取り出す", () => {
    expect(extractMedicalInstitutionCode("18-1011-5202")).toBe("1810115202");
    expect(extractMedicalInstitutionCode("１８１０１１５２０２")).toBe(
      "1810115202",
    );
  });

  it("10桁コードとして不正な入力にはnullを返す", () => {
    expect(extractMedicalInstitutionCode("さくら診療所")).toBeNull();
    expect(extractMedicalInstitutionCode("1820115202")).toBeNull();
    expect(extractMedicalInstitutionCode("181011520")).toBeNull();
  });
});
