import type {
  ChangeManifest,
  ChangeSearchIndex,
  DataManifest,
  FacilityChangeShard,
  FacilityLookupResult,
  FacilitySearchIndex,
  FacilitySearchTuple,
  FacilityShard,
  StandardCatalog,
} from "./types";
import { applyChangeEvent } from "../../shared/apply-change-event.js";

export interface FacilityStandardsClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export interface FacilityNameSearchOptions {
  limit?: number;
}

export interface FacilityNameSearchResult {
  matches: FacilitySearchTuple[];
  totalMatchCount: number;
  asOf: string;
}

export function normalizeMedicalInstitutionCode(value: string): string {
  const code = extractMedicalInstitutionCode(value);
  if (!code) {
    throw new Error(
      "医療機関コードは都道府県番号2桁＋点数表番号1桁＋機関コード7桁の10桁で指定してください",
    );
  }
  return code;
}

export function extractMedicalInstitutionCode(value: string): string | null {
  const code = value.normalize("NFKC").replace(/\D/gu, "");
  return /^\d{2}[134]\d{7}$/u.test(code) ? code : null;
}

export function normalizeFacilityName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\s　・･\-ー―‐()（）［\]\[\]]/gu, "");
}

export class FacilityStandardsClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #shards = new Map<string, Promise<FacilityShard>>();
  readonly #changeShards = new Map<string, Promise<FacilityChangeShard>>();
  #catalog: Promise<StandardCatalog> | null = null;
  #manifest: Promise<DataManifest> | null = null;
  #searchIndex: Promise<FacilitySearchIndex> | null = null;
  #changeSearchIndex: Promise<ChangeSearchIndex> | null = null;
  #changeManifest: Promise<ChangeManifest | null> | null = null;

  constructor(options: FacilityStandardsClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    // fetchはthisを束縛しないと、ブラウザでIllegal invocationになる
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async get(
    medicalInstitutionCode: string,
  ): Promise<FacilityLookupResult | null> {
    const code = normalizeMedicalInstitutionCode(medicalInstitutionCode);
    const prefix = code.slice(0, 4);
    const [shard, catalog, changes] = await Promise.all([
      this.#getShard(prefix),
      this.#getCatalog(),
      this.#getChangeShard(prefix),
    ]);
    const compact = shard.facilities[code];
    const changeRecord = changes.facilities[code];
    if (!compact && !changeRecord) {
      return null;
    }

    const standardEntries = (compact?.standards ?? []).map(
      ([standardId, acceptanceNumber, effectiveFrom]) => {
        const definition = catalog.standards[standardId] ?? {
          abbreviation: null,
          name: null,
        };
        return {
          standardId,
          record: {
            ...definition,
            acceptanceNumber,
            effectiveFrom,
          },
        };
      },
    );
    const recentEvents = [...(changeRecord?.events ?? [])].sort(
      (a, b) =>
        a.publishedAt.localeCompare(b.publishedAt) ||
        (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1) ||
        a.id.localeCompare(b.id),
    );
    let recentChangeCount = 0;
    let unresolvedChangeCount = 0;
    for (const event of recentEvents) {
      const result = applyChangeEvent(standardEntries, event);
      if (result === "applied") {
        recentChangeCount += 1;
      } else if (result === "unresolved") {
        unresolvedChangeCount += 1;
      }
    }

    const sourceIds = new Set(compact?.sourceIds ?? []);
    const sourceDocuments = new Map<
      string,
      FacilityLookupResult["sourceDocuments"][number]
    >();
    for (const url of compact?.sourceDocuments ?? []) {
      sourceDocuments.set(url, {
        url,
        kind: "snapshot",
        publishedAt: shard.asOf || null,
        page: null,
        extractionMethod: null,
      });
    }
    for (const event of recentEvents) {
      sourceIds.add(event.sourceId);
      sourceDocuments.set(event.documentUrl, {
        url: event.documentUrl,
        kind: "change",
        publishedAt: event.publishedAt,
        page: event.page,
        extractionMethod: event.extractionMethod,
      });
    }
    const asOf = [
      shard.asOf,
      ...recentEvents.map((event) => event.publishedAt),
    ].filter(Boolean).sort().at(-1) ?? "";

    return {
      medicalInstitutionCode: code,
      localCode: code.slice(3),
      prefectureCode: code.slice(0, 2),
      category: compact?.category ?? changeRecord!.category,
      facility: {
        name: compact?.name ?? changeRecord!.name,
        address: compact ? compact.address : changeRecord?.address ?? null,
      },
      standards: standardEntries.map((entry) => entry.record),
      asOf,
      sourceIds: [...sourceIds].sort(),
      sourceDocuments: [...sourceDocuments.values()].sort((a, b) =>
        a.url.localeCompare(b.url)
      ),
      recentChangeCount,
      unresolvedChangeCount,
    };
  }

  async getManifest(): Promise<DataManifest> {
    if (!this.#manifest) {
      this.#manifest = this.#fetchJson<DataManifest>(
        "/v1/manifest.json",
        "データ更新情報",
      );
      this.#manifest.catch(() => {
        this.#manifest = null;
      });
    }
    return this.#manifest;
  }

  async getChangeManifest(): Promise<ChangeManifest | null> {
    if (!this.#changeManifest) {
      this.#changeManifest = this.#fetchOptionalJson<ChangeManifest | null>(
        "/v1/changes/manifest.json",
        null,
        "月内差分の更新情報",
      );
      this.#changeManifest.catch(() => {
        this.#changeManifest = null;
      });
    }
    return this.#changeManifest;
  }

  async searchByName(
    query: string,
    options: FacilityNameSearchOptions = {},
  ): Promise<FacilityNameSearchResult> {
    const normalized = normalizeFacilityName(query);
    const [index, changes] = await Promise.all([
      this.#getSearchIndex(),
      this.#getChangeSearchIndex(),
    ]);
    if (!normalized) {
      return {
        matches: [],
        totalMatchCount: 0,
        asOf: [index.asOf, changes.latestAsOf].sort().at(-1) ?? index.asOf,
      };
    }

    const facilities = new Map(
      index.facilities.map((facility) => [facility[0], facility]),
    );
    for (const facility of changes.facilities) {
      if (!facilities.has(facility[0])) {
        facilities.set(facility[0], facility);
      }
    }
    const matches = [...facilities.values()]
      .filter(([, name]) => normalizeFacilityName(name).includes(normalized))
      .sort((a, b) => {
        const aStarts = normalizeFacilityName(a[1]).startsWith(normalized);
        const bStarts = normalizeFacilityName(b[1]).startsWith(normalized);
        if (aStarts !== bStarts) {
          return aStarts ? -1 : 1;
        }
        return a[1].localeCompare(b[1], "ja");
      });

    return {
      matches:
        options.limit === undefined ? matches : matches.slice(0, options.limit),
      totalMatchCount: matches.length,
      asOf: [index.asOf, changes.latestAsOf].sort().at(-1) ?? index.asOf,
    };
  }

  clearCache(): void {
    this.#shards.clear();
    this.#changeShards.clear();
    this.#catalog = null;
    this.#manifest = null;
    this.#searchIndex = null;
    this.#changeSearchIndex = null;
    this.#changeManifest = null;
  }

  #getCatalog(): Promise<StandardCatalog> {
    if (!this.#catalog) {
      this.#catalog = this.#fetchJson<StandardCatalog>(
        "/v1/catalog.json",
        "施設基準カタログ",
      );
      this.#catalog.catch(() => {
        this.#catalog = null;
      });
    }
    return this.#catalog;
  }

  #getSearchIndex(): Promise<FacilitySearchIndex> {
    if (!this.#searchIndex) {
      this.#searchIndex = this.#fetchJson<FacilitySearchIndex>(
        "/v1/search.json",
        "名称検索索引",
      );
      this.#searchIndex.catch(() => {
        this.#searchIndex = null;
      });
    }
    return this.#searchIndex;
  }

  #getChangeSearchIndex(): Promise<ChangeSearchIndex> {
    if (!this.#changeSearchIndex) {
      this.#changeSearchIndex = this.#fetchOptionalJson<ChangeSearchIndex>(
        "/v1/changes/search.json",
        {
          schemaVersion: 1,
          generatedAt: "",
          baseAsOf: "",
          latestAsOf: "",
          facilities: [],
        },
        "月内差分の名称検索索引",
      );
      this.#changeSearchIndex.catch(() => {
        this.#changeSearchIndex = null;
      });
    }
    return this.#changeSearchIndex;
  }

  #getShard(prefix: string): Promise<FacilityShard> {
    const cached = this.#shards.get(prefix);
    if (cached) {
      return cached;
    }

    const request = this.#fetch(
      `${this.#baseUrl}/v1/facilities/${prefix}.json`,
    ).then(async (response) => {
      if (response.status === 404) {
        return {
          schemaVersion: 1,
          asOf: "",
          prefix,
          facilities: {},
        } satisfies FacilityShard;
      }
      if (!response.ok) {
        throw new Error(
          `施設基準データの取得に失敗しました: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as FacilityShard;
    });

    this.#shards.set(prefix, request);
    request.catch(() => this.#shards.delete(prefix));
    return request;
  }

  #getChangeShard(prefix: string): Promise<FacilityChangeShard> {
    const cached = this.#changeShards.get(prefix);
    if (cached) {
      return cached;
    }
    const request = this.#fetchOptionalJson<FacilityChangeShard>(
      `/v1/changes/facilities/${prefix}.json`,
      {
        schemaVersion: 1,
        baseAsOf: "",
        latestAsOf: "",
        prefix,
        facilities: {},
      },
      "月内差分データ",
    );
    this.#changeShards.set(prefix, request);
    request.catch(() => this.#changeShards.delete(prefix));
    return request;
  }

  async #fetchJson<T>(path: string, label: string): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(
        `${label}の取得に失敗しました: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }

  async #fetchOptionalJson<T>(
    path: string,
    fallback: T,
    label: string,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`);
    if (response.status === 404) {
      return fallback;
    }
    if (!response.ok) {
      throw new Error(
        `${label}の取得に失敗しました: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }
}
