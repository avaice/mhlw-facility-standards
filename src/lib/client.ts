import type {
  DataManifest,
  FacilityLookupResult,
  FacilitySearchIndex,
  FacilitySearchTuple,
  FacilityShard,
  StandardCatalog,
} from "./types";

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
  #catalog: Promise<StandardCatalog> | null = null;
  #manifest: Promise<DataManifest> | null = null;
  #searchIndex: Promise<FacilitySearchIndex> | null = null;

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
    const [shard, catalog] = await Promise.all([
      this.#getShard(prefix),
      this.#getCatalog(),
    ]);
    const compact = shard.facilities[code];
    if (!compact) {
      return null;
    }

    return {
      medicalInstitutionCode: code,
      localCode: code.slice(3),
      prefectureCode: code.slice(0, 2),
      category: compact.category,
      facility: {
        name: compact.name,
        address: compact.address,
      },
      standards: compact.standards.map(
        ([standardId, acceptanceNumber, effectiveFrom]) => {
          const definition = catalog.standards[standardId] ?? {
            abbreviation: null,
            name: null,
          };
          return {
            ...definition,
            acceptanceNumber,
            effectiveFrom,
          };
        },
      ),
      asOf: shard.asOf,
      sourceIds: compact.sourceIds,
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

  async searchByName(
    query: string,
    options: FacilityNameSearchOptions = {},
  ): Promise<FacilityNameSearchResult> {
    const normalized = normalizeFacilityName(query);
    const index = await this.#getSearchIndex();
    if (!normalized) {
      return { matches: [], totalMatchCount: 0, asOf: index.asOf };
    }

    const matches = index.facilities
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
      asOf: index.asOf,
    };
  }

  clearCache(): void {
    this.#shards.clear();
    this.#catalog = null;
    this.#manifest = null;
    this.#searchIndex = null;
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

  async #fetchJson<T>(path: string, label: string): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(
        `${label}の取得に失敗しました: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  }
}
