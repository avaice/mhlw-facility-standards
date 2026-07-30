import { describe, expect, it, vi } from "vitest";
import { FacilityStandardsClient } from "../src/client.js";

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
});
