import { describe, expect, it, vi } from "vitest";
import { extractMedicalInstitutionCode, FacilityStandardsClient } from "./client";

describe("FacilityStandardsClient", () => {
  it("10桁コードからシャードを選択し、同じシャードをキャッシュする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/changes/")) {
        return new Response(null, { status: 404 });
      }
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/facilities/1810.json",
    );
  });

  it("名称検索索引を一度だけ取得し、前方一致を優先して返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/changes/")) {
        return new Response(null, { status: 404 });
      }
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/search.json");
  });

  it("月次名簿へ月内PDFの追加・辞退を適用し、原資料URLを返す", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog.json")) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          standards: {
            old: { abbreviation: "旧基準", name: "旧施設基準" },
            kept: { abbreviation: "継続", name: "継続施設基準" },
          },
        }));
      }
      if (url.includes("/changes/facilities/")) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          baseAsOf: "2026-07-01",
          latestAsOf: "2026-07-15",
          prefix: "1810",
          facilities: {
            "1810115202": {
              name: "テスト診療所 〒910-0000",
              address: "福井県福井市和田2-",
              category: "medical",
              events: [
                {
                  id: "remove-old",
                  action: "remove",
                  standardId: "old",
                  standard: { abbreviation: "旧基準", name: "旧施設基準" },
                  acceptanceNumber: "第1号",
                  effectiveFrom: null,
                  publishedAt: "2026-07-10",
                  sourceId: "kinki",
                  sourcePageUrl: "https://example.test/source",
                  documentUrl: "https://example.test/remove.pdf",
                  documentSha256: "a",
                  page: 1,
                },
                {
                  id: "keep-same",
                  action: "upsert",
                  standardId: "kept",
                  standard: { abbreviation: "継続", name: "継続施設基準" },
                  acceptanceNumber: "第3号",
                  effectiveFrom: "2026-06-01",
                  publishedAt: "2026-07-12",
                  sourceId: "kinki",
                  sourcePageUrl: "https://example.test/source",
                  documentUrl: "https://example.test/add.pdf",
                  documentSha256: "b",
                  page: 1,
                },
                {
                  id: "keep-another",
                  action: "upsert",
                  standardId: "kept",
                  standard: { abbreviation: "継続", name: "継続施設基準" },
                  acceptanceNumber: "第4号",
                  effectiveFrom: "2026-07-01",
                  publishedAt: "2026-07-12",
                  sourceId: "kinki",
                  sourcePageUrl: "https://example.test/source",
                  documentUrl: "https://example.test/add.pdf",
                  documentSha256: "b",
                  page: 1,
                },
                {
                  id: "add-new",
                  action: "upsert",
                  standardId: "new",
                  standard: { abbreviation: "新基準", name: "新施設基準" },
                  acceptanceNumber: "第2号",
                  effectiveFrom: "2026-07-01",
                  publishedAt: "2026-07-15",
                  sourceId: "kinki",
                  sourcePageUrl: "https://example.test/source",
                  documentUrl: "https://example.test/add.pdf",
                  documentSha256: "b",
                  page: 2,
                },
              ],
            },
          },
        }));
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        asOf: "2026-07-01",
        prefix: "1810",
        facilities: {
          "1810115202": {
            name: "テスト診療所",
            address: "福井県福井市和田2-1006",
            category: "medical",
            sourceIds: ["kinki"],
            sourceDocuments: ["https://example.test/monthly.xlsx"],
            standards: [
              ["old", "第1号", "2026-06-01"],
              ["kept", "第3号", "2026-06-01"],
            ],
          },
        },
      }));
    });
    const client = new FacilityStandardsClient({
      baseUrl: "https://example.test",
      fetch: fetchMock,
    });

    const facility = await client.get("1810115202");
    expect(facility?.standards.map((standard) => standard.name)).toEqual([
      "継続施設基準",
      "継続施設基準",
      "新施設基準",
    ]);
    expect(facility?.asOf).toBe("2026-07-15");
    expect(facility?.recentChangeCount).toBe(3);
    expect(facility?.unresolvedChangeCount).toBe(0);
    expect(facility?.facility).toEqual({
      name: "テスト診療所",
      address: "福井県福井市和田2-1006",
    });
    expect(facility?.sourceDocuments.map((document) => document.url)).toEqual([
      "https://example.test/add.pdf",
      "https://example.test/monthly.xlsx",
      "https://example.test/remove.pdf",
    ]);
  });

  it("同じ略称の基準が複数ある場合は失効を適用せず要確認にする", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/catalog.json")) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          standards: {
            first: { abbreviation: "同一略称", name: "施設基準A" },
            second: { abbreviation: "同一略称", name: "施設基準B" },
          },
        }));
      }
      if (url.includes("/changes/facilities/")) {
        return new Response(JSON.stringify({
          schemaVersion: 1,
          baseAsOf: "2026-07-01",
          latestAsOf: "2026-07-15",
          prefix: "1810",
          facilities: {
            "1810115202": {
              name: "テスト診療所",
              address: "福井県福井市",
              category: "medical",
              events: [{
                id: "ambiguous-remove",
                action: "remove",
                standardId: "unknown",
                standard: { abbreviation: "同一略称", name: null },
                acceptanceNumber: "",
                effectiveFrom: "2026-07-01",
                publishedAt: "2026-07-15",
                sourceId: "kinki",
                sourcePageUrl: "https://example.test/source",
                documentUrl: "https://example.test/remove.pdf",
                documentSha256: "a",
                page: 1,
                extractionMethod: "text",
              }],
            },
          },
        }));
      }
      return new Response(JSON.stringify({
        schemaVersion: 1,
        asOf: "2026-07-01",
        prefix: "1810",
        facilities: {
          "1810115202": {
            name: "テスト診療所",
            address: "福井県福井市",
            category: "medical",
            sourceIds: ["kinki"],
            standards: [
              ["first", "第1号", "2026-06-01"],
              ["second", "第2号", "2026-06-01"],
            ],
          },
        },
      }));
    });
    const client = new FacilityStandardsClient({
      baseUrl: "https://example.test",
      fetch: fetchMock,
    });

    const facility = await client.get("1810115202");
    expect(facility?.standards.map((standard) => standard.name)).toEqual([
      "施設基準A",
      "施設基準B",
    ]);
    expect(facility?.recentChangeCount).toBe(0);
    expect(facility?.unresolvedChangeCount).toBe(1);
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
