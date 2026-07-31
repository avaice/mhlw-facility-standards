export const FACILITY_CATEGORIES = ["medical", "dental", "pharmacy"] as const;

export type FacilityCategory = (typeof FACILITY_CATEGORIES)[number];

export interface SourceDefinition {
  id: string;
  bureauName: string;
  pageUrl: string;
  targetSection: RegExp;
  excludedSection: RegExp;
}

export type ChangeAction = "upsert" | "remove";

export interface RecentSourceDefinition {
  sourceId: string;
  bureauName: string;
  pageUrl: string;
  prefectureCodeHint: string | null;
  documentUrlPattern?: RegExp;
  documentContextPattern?: RegExp;
}

export interface DiscoveredDocument {
  sourceId: string;
  bureauName: string;
  pageUrl: string;
  documentUrl: string;
  asOf: string;
  categoryHint: FacilityCategory | null;
  context: string;
}

export interface DiscoveredRecentDocument extends DiscoveredDocument {
  action: ChangeAction;
  prefectureCodeHint: string | null;
}

export interface DownloadedDocument extends DiscoveredDocument {
  bytes: Buffer;
  sha256: string;
}

export interface DownloadedRecentDocument extends DiscoveredRecentDocument {
  bytes: Buffer;
  sha256: string;
}

export interface WorkbookDocument {
  source: Omit<DownloadedDocument, "bytes">;
  fileName: string;
  bytes: Buffer;
}

export interface StandardRecord {
  abbreviation: string | null;
  name: string | null;
  acceptanceNumber: string;
  effectiveFrom: string | null;
}

export interface RecordProvenance {
  bureauId: string;
  bureauName: string;
  pageUrl: string;
  documentUrl: string;
  documentSha256: string;
  workbook: string;
  worksheet: string;
}

export interface FacilityRecord {
  schemaVersion: 1;
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
  sources: RecordProvenance[];
}

export interface ParsedWorkbook {
  records: FacilityRecord[];
  warnings: string[];
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

export interface FacilityShard {
  schemaVersion: 1;
  asOf: string;
  prefix: string;
  facilities: Record<string, CompactFacilityRecord>;
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

export interface FacilityChangeRecord {
  medicalInstitutionCode: string;
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
  facilities: Record<
    string,
    Omit<FacilityChangeRecord, "medicalInstitutionCode">
  >;
}

export interface ChangeSearchIndex {
  schemaVersion: 1;
  generatedAt: string;
  baseAsOf: string;
  latestAsOf: string;
  facilities: FacilitySearchTuple[];
}

export interface ChangeManifestSource {
  id: string;
  bureauName: string;
  pageUrls: string[];
  documents: Array<{
    url: string;
    sha256: string;
    publishedAt: string;
    action: ChangeAction;
  }>;
}

export interface ChangeManifest {
  schemaVersion: 1;
  generatedAt: string;
  baseAsOf: string;
  latestAsOf: string;
  facilityCount: number;
  eventCount: number;
  sources: ChangeManifestSource[];
}
