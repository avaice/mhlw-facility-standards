import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PREFECTURES } from "../config/prefectures.js";
import { getReviewedOcrRecords } from "../config/reviewed-ocr-documents.js";
import { createChangeEventId, createStandardId } from "../standard.js";
import type {
  DownloadedRecentDocument,
  FacilityCategory,
  FacilityChangeEvent,
  FacilityChangeRecord,
} from "../types.js";
import {
  extractJapaneseDates,
  maxIsoDate,
} from "../utils/date.js";
import {
  compactText,
  inferCategory,
  normalizeDigits,
  normalizeText,
} from "../utils/text.js";

const CATEGORY_POINT_TABLE: Record<FacilityCategory, string> = {
  medical: "1",
  dental: "3",
  pharmacy: "4",
};

export interface PositionedText {
  x: number;
  y: number;
  text: string;
}

export interface PdfTextPage {
  page: number;
  items: PositionedText[];
  ocr?: boolean;
}

interface TextLine {
  y: number;
  items: PositionedText[];
  text: string;
}

interface ColumnPositions {
  code: number;
  name: number;
  address: number;
  addressEnd: number;
  content: number;
  contentEnd: number | null;
}

interface ParsedCode {
  localCode: string;
  fullCode: string | null;
}

export interface ParsedRecentPdf {
  records: FacilityChangeRecord[];
  warnings: string[];
}

function linesFromItems(items: PositionedText[]): TextLine[] {
  const groups: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const group = groups.findLast((candidate) =>
      Math.abs(candidate.y - item.y) <= 1.5
    );
    if (group) {
      group.items.push(item);
    } else {
      groups.push({ y: item.y, items: [item] });
    }
  }
  return groups.map((group) => {
    const sorted = group.items.sort((a, b) => a.x - b.x);
    return {
      y: group.y,
      items: sorted,
      text: normalizeText(sorted.map((item) => item.text).join(" ")),
    };
  });
}

function headerPosition(
  items: PositionedText[],
  pattern: RegExp,
): PositionedText | null {
  const found = items.find((item) => pattern.test(compactText(item.text)));
  return found ?? null;
}

function detectColumns(
  items: PositionedText[],
  action: DownloadedRecentDocument["action"],
): ColumnPositions | null {
  const codeHeader = headerPosition(
    items,
    /^(?:医療機関|薬局)(?:番号|コード)$/u,
  );
  const nameHeader = headerPosition(items, /^(?:医療機関|薬局)?名称$/u);
  const addressHeader = headerPosition(
    items,
    /^(?:医療機関|薬局)?所在地$/u,
  );
  if (!codeHeader || !nameHeader || !addressHeader) {
    return null;
  }
  const headerY = Math.max(codeHeader.y, nameHeader.y, addressHeader.y);
  if (action === "remove") {
    const contentHeader = headerPosition(items, /^(?:失効|辞退)内容$/u);
    if (!contentHeader) {
      return null;
    }
    const reasonHeader = headerPosition(items, /^(?:失効|辞退)事由$/u);
    const ownerHeader = headerPosition(items, /^開設者氏名$/u);
    return {
      code: codeHeader.x,
      name: nameHeader.x - 18,
      address: addressHeader.x - 25,
      addressEnd: ownerHeader
        ? ownerHeader.x - 30
        : contentHeader.x - 5,
      content: contentHeader.x - 25,
      contentEnd: reasonHeader?.x ?? null,
    };
  }

  const contentCandidates = items
    .filter(
      (item) =>
        item.y > headerY + 5 &&
        item.x > addressHeader.x + 70 &&
        !/^(?:算定開始年月日|〒|\d+$)/u.test(compactText(item.text)) &&
        !/受理内容|届出内容/u.test(compactText(item.text)),
    )
    .map((item) => item.x);
  const content = Math.min(...contentCandidates);
  if (!Number.isFinite(content)) {
    return null;
  }
  return {
    code: codeHeader.x,
    name: nameHeader.x - 18,
    address: addressHeader.x - 25,
    addressEnd:
      (headerPosition(items, /^病床数$/u)?.x ?? content) - 5,
    content,
    contentEnd: null,
  };
}

function isRecognizedEmptyTable(items: PositionedText[]): boolean {
  const headers = [
    headerPosition(items, /^(?:医療機関|薬局)(?:番号|コード)$/u),
    headerPosition(items, /^(?:医療機関|薬局)?名称$/u),
    headerPosition(items, /^(?:医療機関|薬局)?所在地$/u),
  ];
  if (headers.some((header) => header === null)) {
    return false;
  }
  const headerY = Math.max(...headers.map((header) => header!.y));
  return !items.some(
    (item) => item.y > headerY + 5 && Boolean(compactText(item.text)),
  );
}

function parseCode(value: string): ParsedCode | null {
  const normalized = normalizeText(value);
  if (/^[（(]/u.test(normalized)) {
    return null;
  }
  if (
    !/^\d{1,3}\s*[,，.\-－・]\s*\d{3,4}\s*[,，.\-－・]\s*\d$/u.test(
      normalized,
    ) &&
    !/^\d{3}\s+\d{3}\s*[.．]\s*\d$/u.test(normalized) &&
    !/^\d{2}\s*[-－]\s*\d{5}$/u.test(normalized) &&
    !/^(?:\d{7}|\d{10})$/u.test(normalized)
  ) {
    return null;
  }
  const digits = normalizeDigits(normalized);
  if (digits.length === 10 && /^\d{2}[134]\d{7}$/u.test(digits)) {
    return { localCode: digits.slice(3), fullCode: digits };
  }
  if (digits.length === 7) {
    return { localCode: digits, fullCode: null };
  }
  return null;
}

function malformedIdentityCode(
  items: PositionedText[],
  columns: ColumnPositions,
): string | null {
  const lines = linesFromItems(items);
  const headerY = Math.max(
    ...[
      headerPosition(items, /^(?:医療機関|薬局)(?:番号|コード)$/u),
      headerPosition(items, /^(?:医療機関|薬局)?名称$/u),
      headerPosition(items, /^(?:医療機関|薬局)?所在地$/u),
    ].flatMap((header) => header ? [header.y] : []),
  );
  for (const line of lines) {
    if (line.y <= headerY + 5) {
      continue;
    }
    const codeItems = line.items.filter(
      (item) =>
        item.x < columns.name - 15 &&
        Math.abs(item.x - columns.code) < 35 &&
        Boolean(compactText(item.text)) &&
        // Some official rows carry a parenthesized secondary code on the
        // wrapped name/address line; it is not a new facility row.
        !/^[（(]/u.test(normalizeText(item.text)),
    );
    const hasIdentity = line.items.some(
      (item) =>
        item.x >= columns.name &&
        item.x < columns.addressEnd &&
        Boolean(compactText(item.text)),
    );
    if (
      hasIdentity &&
      codeItems.length > 0 &&
      !codeItems.some((item) => parseCode(item.text) !== null)
    ) {
      const hasAdjacentPrimaryCode = lines.some(
        (candidate) =>
          candidate.y < line.y &&
          line.y - candidate.y <= 25 &&
          candidate.items.some(
            (item) =>
              item.x < columns.name - 15 &&
              Math.abs(item.x - columns.code) < 35 &&
              parseCode(item.text) !== null,
          ),
      );
      if (hasAdjacentPrimaryCode) {
        continue;
      }
      return normalizeText(codeItems.map((item) => item.text).join(" "));
    }
  }
  return null;
}

function inferPrefectureCode(
  context: string,
  hint: string | null,
): string | null {
  const matches = PREFECTURES.filter(([, name]) => context.includes(name));
  if (matches.length === 1) {
    return matches[0]?.[0] ?? null;
  }
  return hint;
}

function cleanAddress(value: string): string | null {
  const address = normalizeText(value)
    .replace(/〒\s*\d{3}\s*[-ー－]?\s*\d{4}/gu, "")
    .replace(/\s+/gu, "");
  return address.replace(/^[|_]+/u, "") || null;
}

function isStandardNameLine(value: string): boolean {
  const text = normalizeText(value);
  return (
    Boolean(text) &&
    !/[：:]/u.test(text) &&
    !/^(?:病床|病棟|区分|届出を行う点数|看護|配置|有$|無$)/u.test(text) &&
    !/^[\d①-⑳]/u.test(text)
  );
}

function parseAcceptance(value: string): {
  abbreviation: string;
  acceptanceNumber: string;
} | null {
  const match = normalizeText(value).match(
    /[（(]([^（）()]+)[）)]\s*[第策笠]\s*([^第策笠（）()\s]*?)\s*[号旨旭三]/u,
  );
  if (!match) {
    return null;
  }
  return {
    abbreviation: normalizeText(match[1]),
    acceptanceNumber: `第${normalizeText(match[2]).replace(/\s+/gu, "")}号`,
  };
}

function addContinuationIdentity(
  document: DownloadedRecentDocument,
  page: PdfTextPage,
  previous: FacilityChangeRecord | null,
): PdfTextPage {
  const columns = detectColumns(page.items, document.action);
  if (!columns) {
    return page;
  }
  const lines = linesFromItems(page.items);
  const headerY = Math.max(
    ...[
      headerPosition(page.items, /^(?:医療機関|薬局)(?:番号|コード)$/u),
      headerPosition(page.items, /^(?:医療機関|薬局)?名称$/u),
      headerPosition(page.items, /^(?:医療機関|薬局)?所在地$/u),
    ].flatMap((header) => header ? [header.y] : []),
  );
  if (!Number.isFinite(headerY)) {
    return page;
  }
  const firstCodeY = lines.find((line) =>
    line.items.some(
      (item) =>
        item.x < columns.name - 15 &&
        Math.abs(item.x - columns.code) < 35 &&
        parseCode(item.text) !== null,
    )
  )?.y ?? Number.POSITIVE_INFINITY;
  const candidates = lines.flatMap((line) => {
    if (line.y <= headerY + 5 || line.y >= firstCodeY) {
      return [];
    }
    const text = normalizeText(
      line.items
        .filter(
          (item) =>
            item.x >= columns.content - 5 &&
            (columns.contentEnd === null || item.x < columns.contentEnd - 5),
        )
        .map((item) => item.text)
        .join(" "),
    );
    const actionable = document.action === "upsert"
      ? parseAcceptance(text) !== null
      : Boolean(text) && !/^(?:失効|辞退)内容$/u.test(compactText(text));
    return actionable ? [{ y: line.y }] : [];
  });
  const firstContentY = candidates[0]?.y;
  if (firstContentY === undefined || !previous) {
    return page;
  }

  // A new row with a damaged code can also have acceptance text. Only carry
  // forward when the name/address cells are empty before the first parsed row.
  const hasIdentityCells = page.items.some(
    (item) =>
      item.y > headerY + 5 &&
      item.y < firstCodeY &&
      item.x >= columns.name &&
      item.x < columns.addressEnd &&
      Boolean(compactText(item.text)),
  );
  if (hasIdentityCells) {
    return page;
  }

  const syntheticY = Math.max(headerY + 2, firstContentY - 3);
  return {
    ...page,
    items: [
      ...page.items,
      { x: columns.code, y: syntheticY, text: previous.medicalInstitutionCode },
      { x: columns.name + 1, y: syntheticY, text: previous.name },
      ...(previous.address
        ? [{ x: columns.address + 1, y: syntheticY, text: previous.address }]
        : []),
    ],
  };
}

function detectedRemovalContentCount(
  items: PositionedText[],
  columns: ColumnPositions,
): number {
  return linesFromItems(items).filter((line) => {
    const text = normalizeText(
      line.items
        .filter(
          (item) =>
            item.x >= columns.content - 5 &&
            (columns.contentEnd === null || item.x < columns.contentEnd - 5),
        )
        .map((item) => item.text)
        .join(" "),
    );
    return Boolean(text) &&
      !/^(?:失効|辞退)内容$/u.test(compactText(text));
  }).length;
}

function mergeRecord(
  records: Map<string, FacilityChangeRecord>,
  incoming: FacilityChangeRecord,
): void {
  const existing = records.get(incoming.medicalInstitutionCode);
  if (!existing) {
    records.set(incoming.medicalInstitutionCode, incoming);
    return;
  }
  if (incoming.name.length > existing.name.length) {
    existing.name = incoming.name;
  }
  existing.address ??= incoming.address;
  const ids = new Set(existing.events.map((event) => event.id));
  for (const event of incoming.events) {
    if (!ids.has(event.id)) {
      existing.events.push(event);
      ids.add(event.id);
    }
  }
}

function parsePage(
  document: DownloadedRecentDocument,
  page: PdfTextPage,
): { records: FacilityChangeRecord[]; acceptanceCount: number } {
  const columns = detectColumns(page.items, document.action);
  if (!columns) {
    return { records: [], acceptanceCount: 0 };
  }
  const lines = linesFromItems(page.items);
  const context = normalizeText(
    `${document.context} ${lines.map((line) => line.text).join(" ")}`,
  );
  const category = inferCategory(context) ?? document.categoryHint;
  const prefectureCode = inferPrefectureCode(
    context,
    document.prefectureCodeHint,
  );
  if (!category || !prefectureCode) {
    return { records: [], acceptanceCount: 0 };
  }

  const starts = lines.flatMap((line, index) => {
    const codeItem = line.items.find(
      (item) =>
        item.x < columns.name - 15 &&
        Math.abs(item.x - columns.code) < 35 &&
        parseCode(item.text) !== null,
    );
    return codeItem ? [{ index, line, code: parseCode(codeItem.text)! }] : [];
  });
  const records: FacilityChangeRecord[] = [];
  let acceptanceCount = 0;

  starts.forEach((start, recordIndex) => {
    const next = starts[recordIndex + 1];
    const recordLines = lines.slice(start.index, next?.index ?? lines.length);
    const fullCode =
      start.code.fullCode ??
      `${prefectureCode}${CATEGORY_POINT_TABLE[category]}${start.code.localCode}`;
    const parsedName = normalizeText(
      recordLines
        .flatMap((line) => line.items)
        .filter(
          (item) =>
            item.x >= columns.name &&
            item.x < columns.address &&
            !/^\d+$/u.test(normalizeText(item.text)),
        )
        .map((item) => item.text)
        .join(" "),
    );
    const name = page.ocr
      ? parsedName.replace(/\s+/gu, "").replace(/[|_]/gu, "")
      : parsedName;
    const address = cleanAddress(
      recordLines
        .flatMap((line) => line.items)
        .filter(
          (item) =>
            item.x >= columns.address &&
            item.x < columns.addressEnd &&
            !/^\d+$/u.test(normalizeText(item.text)),
        )
        .map((item) => item.text)
        .join(" "),
    );

    const contentLines = recordLines.map((line) => {
      const items = line.items.filter(
        (item) =>
          item.x >= columns.content - 5 &&
          (columns.contentEnd === null || item.x < columns.contentEnd - 5),
      );
      return {
        y: line.y,
        minX: Math.min(...items.map((item) => item.x)),
        text: normalizeText(items.map((item) => item.text).join(" ")),
        fullText: line.text,
      };
    });
    const events: FacilityChangeEvent[] = [];
    if (document.action === "remove") {
      for (const line of contentLines) {
        const abbreviation = normalizeText(line.text).replace(/\s+/gu, "");
        if (
          !abbreviation ||
          /^(?:失効|辞退)内容$/u.test(compactText(abbreviation))
        ) {
          continue;
        }
        const standard = {
          abbreviation,
          name: null,
          acceptanceNumber: "",
          effectiveFrom:
            maxIsoDate(extractJapaneseDates(line.fullText)) ?? null,
        };
        events.push({
          id: createChangeEventId(document, page.page, fullCode, standard),
          action: "remove",
          standardId: createStandardId(standard),
          standard: {
            abbreviation: standard.abbreviation,
            name: null,
          },
          acceptanceNumber: "",
          effectiveFrom: standard.effectiveFrom,
          publishedAt: document.asOf,
          sourceId: document.sourceId,
          sourcePageUrl: document.pageUrl,
          documentUrl: document.documentUrl,
          documentSha256: document.sha256,
          page: page.page,
          extractionMethod: page.ocr ? "ocr" : "text",
        });
      }
      acceptanceCount += events.length;
    }
    let previousAcceptanceIndex = -1;
    if (document.action === "upsert") {
      contentLines.forEach((line, index) => {
      const acceptance = parseAcceptance(line.text);
      if (!acceptance) {
        return;
      }
      acceptanceCount += 1;
      const nameLines = contentLines
        .slice(previousAcceptanceIndex + 1, index)
        .filter(
          (candidate) =>
            candidate.minX <= columns.content + 22 &&
            isStandardNameLine(candidate.text),
        );
      const parsedStandardName =
        normalizeText(nameLines.map((candidate) => candidate.text).join("")) ||
        null;
      const standardName =
        page.ocr && parsedStandardName
          ? parsedStandardName.replace(/\s+/gu, "")
          : parsedStandardName;
      const effectiveFrom =
        maxIsoDate(
          (page.ocr
            ? contentLines.filter(
                (candidate) => Math.abs(candidate.y - line.y) <= 20,
              )
            : contentLines.slice(index, index + 1))
            .flatMap((candidate) =>
              extractJapaneseDates(candidate.fullText)
            ),
        ) ?? null;
      const standard = {
        abbreviation:
          (page.ocr
            ? acceptance.abbreviation.replace(/\s+/gu, "")
            : acceptance.abbreviation) || null,
        name: standardName,
        acceptanceNumber: acceptance.acceptanceNumber,
        effectiveFrom,
      };
      events.push({
        id: createChangeEventId(document, page.page, fullCode, standard),
        action: document.action,
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
        page: page.page,
        extractionMethod: page.ocr ? "ocr" : "text",
      });
      previousAcceptanceIndex = index;
      });
    }

    if (name && events.length > 0) {
      records.push({
        medicalInstitutionCode: fullCode,
        name,
        address,
        category,
        events,
      });
    }
  });

  return { records, acceptanceCount };
}

export function parseRecentPdfPages(
  document: DownloadedRecentDocument,
  pages: PdfTextPage[],
): ParsedRecentPdf {
  const records = new Map<string, FacilityChangeRecord>();
  const warnings: string[] = [];
  let acceptanceCount = 0;
  let parsedEventCount = 0;
  let previousRecord: FacilityChangeRecord | null = null;

  for (const page of pages) {
    const columns = detectColumns(page.items, document.action);
    const malformedCode = columns
      ? malformedIdentityCode(page.items, columns)
      : null;
    if (malformedCode) {
      throw new Error(
        `${document.documentUrl} ${page.page}ページ: ` +
          `施設コードを解析できません: ${malformedCode}`,
      );
    }
    const preparedPage = addContinuationIdentity(
      document,
      page,
      previousRecord,
    );
    const parsed = parsePage(document, preparedPage);
    const pageEventCount = parsed.records.reduce(
      (sum, record) => sum + record.events.length,
      0,
    );
    if (document.action === "upsert") {
      const detectedAcceptanceCount = linesFromItems(page.items).filter(
        (line) => parseAcceptance(line.text) !== null,
      ).length;
      if (pageEventCount !== detectedAcceptanceCount) {
        throw new Error(
          `${document.documentUrl} ${page.page}ページ: ` +
            `受理番号行と生成イベント数が一致しません ` +
            `(${detectedAcceptanceCount}/${pageEventCount})`,
        );
      }
    } else if (columns) {
      const detectedContentCount = detectedRemovalContentCount(
        page.items,
        columns,
      );
      if (pageEventCount !== detectedContentCount) {
        throw new Error(
          `${document.documentUrl} ${page.page}ページ: ` +
            `失効内容行と生成イベント数が一致しません ` +
            `(${detectedContentCount}/${pageEventCount})`,
        );
      }
    }
    acceptanceCount += parsed.acceptanceCount;
    parsedEventCount += pageEventCount;
    if (parsed.records.length === 0 && isRecognizedEmptyTable(page.items)) {
      warnings.push(`${document.documentUrl} ${page.page}ページ: 対象行なし`);
      previousRecord = null;
    } else if (parsed.records.length === 0) {
      throw new Error(
        `${document.documentUrl} ${page.page}ページ: ` +
          "行らしき内容がありますが施設基準を解析できません",
      );
    }
    if (page.ocr) {
      warnings.push(
        `${document.documentUrl} ${page.page}ページ: 画像PDFのためOCRで解析`,
      );
    }
    for (const record of parsed.records) {
      mergeRecord(records, record);
    }
    previousRecord = parsed.records.at(-1) ?? previousRecord;
  }

  if (records.size === 0 || parsedEventCount === 0) {
    throw new Error(`${document.documentUrl}: PDFから施設基準を解析できません`);
  }
  if (acceptanceCount > 0 && parsedEventCount / acceptanceCount < 0.9) {
    throw new Error(
      `${document.documentUrl}: PDF解析率が安全下限を下回りました (${parsedEventCount}/${acceptanceCount})`,
    );
  }

  for (const record of records.values()) {
    record.events.sort(
      (a, b) =>
        a.publishedAt.localeCompare(b.publishedAt) ||
        (a.action === b.action ? 0 : a.action === "remove" ? -1 : 1) ||
        a.id.localeCompare(b.id),
    );
  }
  return {
    records: [...records.values()].sort((a, b) =>
      a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode),
    ),
    warnings,
  };
}

export async function parseRecentPdf(
  document: DownloadedRecentDocument,
): Promise<ParsedRecentPdf> {
  const reviewedOcrRecords = getReviewedOcrRecords(document);
  if (reviewedOcrRecords) {
    return {
      records: reviewedOcrRecords,
      warnings: [
        `${document.documentUrl}: SHA-256固定の目視確認済み転記を使用`,
      ],
    };
  }

  const task = getDocument({
    data: new Uint8Array(document.bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages: PdfTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const pdfPage = await pdf.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      const items = content.items.flatMap((item) => {
        if (!("str" in item) || !normalizeText(item.str)) {
          return [];
        }
        const transformed = Util.transform(viewport.transform, item.transform);
        return [{
          x: transformed[4],
          y: transformed[5],
          text: item.str,
        }];
      });
      if (
        !detectColumns(items, document.action) &&
        !isRecognizedEmptyTable(items)
      ) {
        throw new Error(
          `${document.documentUrl} ${pageNumber}ページ: ` +
            "画像PDFまたは未知のレイアウトです。" +
            "自動OCR公開を停止しました。SHA-256固定の目視確認済み転記が必要です",
        );
      }
      pages.push({ page: pageNumber, items });
      pdfPage.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return parseRecentPdfPages(document, pages);
}
