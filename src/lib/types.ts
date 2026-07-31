// public/v1 に配信される静的JSONの契約型。
// 生成側の定義は updater/types.ts にあり、schemaVersion で互換性を管理する。

export type FacilityCategory = "medical" | "dental" | "pharmacy";

export interface StandardRecord {
  abbreviation: string | null;
  name: string | null;
  acceptanceNumber: string;
  effectiveFrom: string | null;
}

export type CompactStandardTuple = [
  standardId: string,
  acceptanceNumber: string,
  effectiveFrom: string | null,
];

export interface CompactFacilityRecord {
  name: string;
  address: string | null;
  category: FacilityCategory;
  sourceIds: string[];
  sourceDocuments?: string[];
  standards: CompactStandardTuple[];
}

export interface FacilityShard {
  schemaVersion: 1;
  asOf: string;
  prefix: string;
  facilities: Record<string, CompactFacilityRecord>;
}

export interface StandardCatalog {
  schemaVersion: 1;
  standards: Record<
    string,
    {
      abbreviation: string | null;
      name: string | null;
    }
  >;
}

export type FacilitySearchTuple = [
  medicalInstitutionCode: string,
  name: string,
  address: string | null,
  category: FacilityCategory,
];

export interface FacilitySearchIndex {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  facilityCount: number;
  facilities: FacilitySearchTuple[];
}

export interface SourceManifestEntry {
  id: string;
  bureauName: string;
  pageUrl: string;
  asOf: string;
  facilityCount: number;
  documents: Array<{
    url: string;
    sha256: string;
  }>;
}

export interface DataManifest {
  schemaVersion: 1;
  generatedAt: string;
  asOf: string;
  shardPrefixLength: number;
  facilityCount: number;
  standardCount: number;
  sources: SourceManifestEntry[];
}

export type ChangeAction = "upsert" | "remove";

export interface FacilityChangeEvent {
  id: string;
  action: ChangeAction;
  standardId: string;
  standard: {
    abbreviation: string | null;
    name: string | null;
  };
  acceptanceNumber: string;
  effectiveFrom: string | null;
  publishedAt: string;
  sourceId: string;
  sourcePageUrl: string;
  documentUrl: string;
  documentSha256: string;
  page: number;
  extractionMethod: "text" | "ocr";
}

export interface CompactFacilityChangeRecord {
  name: string;
  address: string | null;
  category: FacilityCategory;
  events: FacilityChangeEvent[];
}

export interface FacilityChangeShard {
  schemaVersion: 1;
  baseAsOf: string;
  latestAsOf: string;
  prefix: string;
  facilities: Record<string, CompactFacilityChangeRecord>;
}

export interface ChangeSearchIndex {
  schemaVersion: 1;
  generatedAt: string;
  baseAsOf: string;
  latestAsOf: string;
  facilities: FacilitySearchTuple[];
}

export interface ChangeManifest {
  schemaVersion: 1;
  generatedAt: string;
  baseAsOf: string;
  latestAsOf: string;
  facilityCount: number;
  eventCount: number;
  sources: Array<{
    id: string;
    bureauName: string;
    pageUrls: string[];
    documents: Array<{
      url: string;
      sha256: string;
      publishedAt: string;
      action: ChangeAction;
    }>;
  }>;
}

export interface FacilitySourceDocument {
  url: string;
  kind: "snapshot" | "change";
  publishedAt: string | null;
  page: number | null;
  extractionMethod: "text" | "ocr" | null;
}

export interface FacilityLookupResult {
  medicalInstitutionCode: string;
  localCode: string;
  prefectureCode: string;
  category: FacilityCategory;
  facility: {
    name: string;
    address: string | null;
  };
  standards: StandardRecord[];
  asOf: string;
  sourceIds: string[];
  sourceDocuments: FacilitySourceDocument[];
  recentChangeCount: number;
}
