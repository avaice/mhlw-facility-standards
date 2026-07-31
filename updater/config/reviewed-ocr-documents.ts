import { createChangeEventId, createStandardId } from "../standard.js";
import type {
  DownloadedRecentDocument,
  FacilityChangeRecord,
  StandardRecord,
} from "../types.js";

interface ReviewedStandard extends StandardRecord {
  page: number;
}

interface ReviewedFacility {
  medicalInstitutionCode: string;
  name: string;
  address: string;
  standards: ReviewedStandard[];
}

interface ReviewedOcrDocument {
  documentUrl: string;
  sha256: string;
  reviewedAt: string;
  facilities: ReviewedFacility[];
}

// Image-only source documents must be transcribed and reviewed against the
// rendered official PDF. The exact SHA-256 makes the approval invalid as soon
// as the bureau replaces the file at the same URL.
const REVIEWED_OCR_DOCUMENTS: ReviewedOcrDocument[] = [{
  documentUrl: "https://kouseikyoku.mhlw.go.jp/kyushu/000492894.pdf",
  sha256: "bf3d8e2fb8360dbb55d127006b1bae0f8a04afb16cf697fd48b4b81b25c8d2d6",
  reviewedAt: "2026-07-31",
  facilities: [
    {
      medicalInstitutionCode: "4440148015",
      name: "さとかん薬局日赤前店",
      address: "大分市千代町1丁目2-20",
      standards: [
        {
          abbreviation: "調基3ハ",
          name: "調剤基本料3ハ",
          acceptanceNumber: "第89号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "在薬",
          name: "在宅患者訪問薬剤管理指導料",
          acceptanceNumber: "第9351号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "地支体1",
          name: "地域支援・医薬品供給対応体制加算1",
          acceptanceNumber: "第877号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "調剤ベ",
          name: "調剤ベースアップ評価料",
          acceptanceNumber: "第443号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "薬DX",
          name: "電子的調剤情報連携体制整備加算",
          acceptanceNumber: "第584号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "薬連強",
          name: "連携強化加算",
          acceptanceNumber: "第539号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
      ],
    },
    {
      medicalInstitutionCode: "4440148023",
      name: "あき調剤薬局",
      address: "大分市日吉町17番1号",
      standards: [
        {
          abbreviation: "在薬総1",
          name: "在宅薬学総合体制加算1",
          acceptanceNumber: "第292号",
          effectiveFrom: "2026-05-24",
          page: 1,
        },
        {
          abbreviation: "服管か薬",
          name: "服薬管理指導料の注1",
          acceptanceNumber: "第320号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "調基1",
          name: "調剤基本料1",
          acceptanceNumber: "第748号",
          effectiveFrom: "2026-05-24",
          page: 1,
        },
        {
          abbreviation: "薬連強",
          name: "連携強化加算",
          acceptanceNumber: "第540号",
          effectiveFrom: "2026-05-24",
          page: 1,
        },
        {
          abbreviation: "薬DX",
          name: "電子的調剤情報連携体制整備加算",
          acceptanceNumber: "第585号",
          effectiveFrom: "2026-05-24",
          page: 1,
        },
        {
          abbreviation: "地支体3",
          name: "地域支援・医薬品供給対応体制加算3",
          acceptanceNumber: "第133号",
          effectiveFrom: "2026-06-01",
          page: 1,
        },
        {
          abbreviation: "在薬",
          name: "在宅患者訪問薬剤管理指導料",
          acceptanceNumber: "第9352号",
          effectiveFrom: "2026-05-24",
          page: 1,
        },
      ],
    },
  ],
}];

export function reviewedOcrDocumentCount(): number {
  return REVIEWED_OCR_DOCUMENTS.length;
}

export function getReviewedOcrRecords(
  document: DownloadedRecentDocument,
): FacilityChangeRecord[] | null {
  const reviewed = REVIEWED_OCR_DOCUMENTS.find(
    (candidate) =>
      candidate.documentUrl === document.documentUrl &&
      candidate.sha256 === document.sha256,
  );
  if (!reviewed) {
    return null;
  }
  if (document.action !== "upsert") {
    throw new Error(
      `${document.documentUrl}: OCR承認データの操作種別が一致しません`,
    );
  }

  return reviewed.facilities.map((facility) => ({
    medicalInstitutionCode: facility.medicalInstitutionCode,
    name: facility.name,
    address: facility.address,
    category: "pharmacy",
    events: facility.standards.map((standard) => ({
      id: createChangeEventId(
        document,
        standard.page,
        facility.medicalInstitutionCode,
        standard,
      ),
      action: "upsert",
      standardId: createStandardId(standard),
      standard: {
        abbreviation: standard.abbreviation,
        name: standard.name,
      },
      acceptanceNumber: standard.acceptanceNumber,
      effectiveFrom: standard.effectiveFrom,
      publishedAt: document.asOf,
      sourceId: document.sourceId,
      sourcePageUrl: document.pageUrl,
      documentUrl: document.documentUrl,
      documentSha256: document.sha256,
      page: standard.page,
      extractionMethod: "ocr-reviewed",
      reviewStatus: "manual-reviewed",
    })),
  }));
}
