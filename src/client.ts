import type {
  FacilityLookupResult,
  FacilityShard,
  StandardCatalog,
} from "./types.js";

export interface FacilityStandardsClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}

export function normalizeMedicalInstitutionCode(value: string): string {
  const code = value.normalize("NFKC").replace(/\D/g, "");
  if (!/^\d{2}[134]\d{7}$/.test(code)) {
    throw new Error(
      "医療機関コードは都道府県番号2桁＋点数表番号1桁＋機関コード7桁の10桁で指定してください",
    );
  }
  return code;
}

export class FacilityStandardsClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #shards = new Map<string, Promise<FacilityShard>>();
  #catalog: Promise<StandardCatalog> | null = null;

  constructor(options: FacilityStandardsClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
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
          const definition = catalog.standards[standardId];
          if (!definition) {
            throw new Error(`施設基準カタログに ${standardId} がありません`);
          }
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

  clearCache(): void {
    this.#shards.clear();
    this.#catalog = null;
  }

  #getCatalog(): Promise<StandardCatalog> {
    if (this.#catalog) {
      return this.#catalog;
    }

    this.#catalog = this.#fetch(`${this.#baseUrl}/v1/catalog.json`).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(
            `施設基準カタログの取得に失敗しました: ${response.status} ${response.statusText}`,
          );
        }
        return (await response.json()) as StandardCatalog;
      },
    );
    this.#catalog.catch(() => {
      this.#catalog = null;
    });
    return this.#catalog;
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
}
