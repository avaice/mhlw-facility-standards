import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadExistingRecentData,
  normalizeRecentData,
  sourceBaseDates,
  validateRecentData,
} from "./recent-quality.js";
import type {
  ChangeManifest,
  DataManifest,
  FacilityChangeEvent,
  FacilityChangeRecord,
  FacilityChangeShard,
  FacilityShard,
  StandardCatalog,
} from "./types.js";

function changeEvent(
  overrides: Partial<FacilityChangeEvent> = {},
): FacilityChangeEvent {
  return {
    id: "fixture-event",
    action: "upsert",
    standardId: "untrusted",
    standard: {
      abbreviation: "外来感染",
      name: "OCR誤読名",
    },
    acceptanceNumber: "第10号",
    effectiveFrom: "2026-07-01",
    publishedAt: "2026-07-15",
    sourceId: "kanto",
    sourcePageUrl: "https://example.test/recent.html",
    documentUrl: "https://example.test/recent.pdf",
    documentSha256: "fixture-sha256",
    page: 1,
    extractionMethod: "text",
    ...overrides,
  };
}

describe("sourceBaseDates", () => {
  it("地域ごとの月次基準日を維持する", () => {
    const manifest: DataManifest = {
      schemaVersion: 1,
      generatedAt: "2026-07-01T00:00:00.000Z",
      asOf: "2026-07-01",
      shardPrefixLength: 4,
      facilityCount: 2,
      standardCount: 1,
      sources: [
        {
          id: "tohoku",
          bureauName: "東北厚生局",
          pageUrl: "https://example.test/tohoku",
          asOf: "2026-06-01",
          facilityCount: 1,
          documents: [],
        },
        {
          id: "kinki",
          bureauName: "近畿厚生局",
          pageUrl: "https://example.test/kinki",
          asOf: "2026-07-01",
          facilityCount: 1,
          documents: [],
        },
      ],
    };

    expect(Object.fromEntries(sourceBaseDates(manifest))).toEqual({
      tohoku: "2026-06-01",
      kinki: "2026-07-01",
    });
  });
});

describe("normalizeRecentData", () => {
  it("月次名簿の施設属性と基準台帳を優先し、曖昧な失効を隔離する", async () => {
    const root = await mkdtemp(path.join(process.cwd(), "test-recent-quality-"));
    try {
      const output = path.join(root, "v1");
      await mkdir(path.join(output, "facilities"), { recursive: true });
      const shard: FacilityShard = {
        schemaVersion: 1,
        asOf: "2026-07-01",
        prefix: "1310",
        facilities: {
          "1310123456": {
            name: "正しい施設名",
            address: "東京都千代田区千代田1番",
            category: "medical",
            sourceIds: ["kanto"],
            standards: [
              ["duplicate-a", "第1号", "2026-06-01"],
              ["duplicate-b", "第2号", "2026-06-01"],
            ],
          },
        },
      };
      await writeFile(
        path.join(output, "facilities", "1310.json"),
        JSON.stringify(shard),
      );
      const catalog: StandardCatalog = {
        schemaVersion: 1,
        standards: {
          infection: {
            abbreviation: "外来感染",
            name: "外来感染対策向上加算",
          },
          "duplicate-a": {
            abbreviation: "同一略称",
            name: "施設基準A",
          },
          "duplicate-b": {
            abbreviation: "同一略称",
            name: "施設基準B",
          },
        },
      };
      const input: FacilityChangeRecord[] = [{
        medicalInstitutionCode: "1310123456",
        name: "誤読した施設名 〒100-0001",
        address: "東京都千代田区千代田1-",
        category: "pharmacy",
        events: [
          changeEvent(),
          changeEvent({
            id: "ambiguous-remove",
            action: "remove",
            standard: { abbreviation: "同一略称", name: null },
            standardId: "",
            acceptanceNumber: "",
            documentUrl: "https://example.test/remove.pdf",
            documentSha256: "remove-sha256",
          }),
        ],
      }];

      const normalized = await normalizeRecentData(input, output, catalog);

      expect(normalized.records[0]).toMatchObject({
        name: "正しい施設名",
        address: "東京都千代田区千代田1番",
        category: "medical",
      });
      const upsert = normalized.records[0]?.events.find(
        (event) => event.action === "upsert",
      );
      const remove = normalized.records[0]?.events.find(
        (event) => event.action === "remove",
      );
      expect(upsert).toMatchObject({
        standardId: "infection",
        standard: {
          abbreviation: "外来感染",
          name: "外来感染対策向上加算",
        },
        reviewStatus: "automatic",
      });
      expect(remove).toMatchObject({
        action: "remove",
        reviewStatus: "needs-review",
        reviewReasons: ["ambiguous-standard"],
      });
      expect(normalized.unresolvedEventCount).toBe(1);
      expect(() => validateRecentData(normalized.records)).not.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("loadExistingRecentData", () => {
  it("掲載ページから消えた地域基準日後の文書を保持し、旧OCRは破棄する", async () => {
    const root = await mkdtemp(path.join(process.cwd(), "test-recent-retain-"));
    try {
      const output = path.join(root, "v1");
      const changes = path.join(output, "changes");
      await mkdir(path.join(changes, "facilities"), { recursive: true });
      const retainedUrl = "https://example.test/retained.pdf";
      const oldUrl = "https://example.test/old.pdf";
      const ocrUrl = "https://example.test/unreviewed-ocr.pdf";
      const events = [
        changeEvent({ id: "retained", documentUrl: retainedUrl }),
        changeEvent({
          id: "old",
          publishedAt: "2026-06-01",
          documentUrl: oldUrl,
        }),
        changeEvent({
          id: "ocr",
          documentUrl: ocrUrl,
          extractionMethod: "ocr",
        }),
      ];
      const shard: FacilityChangeShard = {
        schemaVersion: 1,
        baseAsOf: "2026-07-01",
        latestAsOf: "2026-07-15",
        prefix: "1310",
        facilities: {
          "1310123456": {
            name: "テスト診療所",
            address: "東京都千代田区",
            category: "medical",
            events,
          },
        },
      };
      await writeFile(
        path.join(changes, "facilities", "1310.json"),
        JSON.stringify(shard),
      );
      const manifest: ChangeManifest = {
        schemaVersion: 1,
        generatedAt: "2026-07-15T00:00:00.000Z",
        baseAsOf: "2026-07-01",
        latestAsOf: "2026-07-15",
        facilityCount: 1,
        eventCount: 3,
        quality: {
          status: "needs-review",
          retainedDocumentCount: 0,
          reviewedOcrDocumentCount: 0,
          unresolvedEventCount: 1,
          unresolvedByReason: {
            "unverified-facility-identity": 0,
            "missing-standard-abbreviation": 0,
            "unknown-standard": 0,
            "ambiguous-standard": 1,
            "multiple-base-records": 0,
            "missing-effective-date": 0,
            "missing-acceptance-number": 0,
            "unreviewed-ocr": 0,
          },
        },
        sources: [{
          id: "kanto",
          bureauName: "関東信越厚生局",
          baseAsOf: "2026-06-01",
          pageUrls: ["https://example.test/recent.html"],
          documents: [retainedUrl, oldUrl, ocrUrl].map((url) => ({
            url,
            sha256: "fixture-sha256",
            publishedAt: url === oldUrl ? "2026-06-01" : "2026-07-15",
            action: "upsert" as const,
          })),
        }],
      };
      await writeFile(
        path.join(changes, "manifest.json"),
        JSON.stringify(manifest),
      );

      const retained = await loadExistingRecentData(
        output,
        new Map([["kanto", "2026-06-01"]]),
        new Set(),
      );
      expect(retained.records[0]?.events.map((event) => event.id)).toEqual([
        "retained",
      ]);
      expect(retained.documents.map((document) => document.documentUrl)).toEqual([
        retainedUrl,
      ]);
      expect(retained.retainedDocumentCount).toBe(1);

      const replaced = await loadExistingRecentData(
        output,
        new Map([["kanto", "2026-06-01"]]),
        new Set([retainedUrl]),
      );
      expect(replaced.records).toEqual([]);
      expect(replaced.retainedDocumentCount).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
