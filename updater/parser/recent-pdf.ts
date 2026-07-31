import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import jpnData from "@tesseract.js-data/jpn";
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import Tesseract from "tesseract.js";
import { PREFECTURES } from "../config/prefectures.js";
import { createStandardId } from "../standard.js";
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

const CIRCLED_DIGITS: Record<string, string> = {
  "⓪": "0",
  "①": "1",
  "②": "2",
  "③": "3",
  "④": "4",
  "⑤": "5",
  "⑥": "6",
  "⑦": "7",
  "⑧": "8",
  "⑨": "9",
};

function normalizeOcrText(value: string): string {
  return value
    .replace(/[⓪①②③④⑤⑥⑦⑧⑨]/gu, (digit) => CIRCLED_DIGITS[digit] ?? digit)
    .replace(/[．。]/gu, ".")
    .replace(/[，]/gu, ",");
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

function defaultOcrColumns(
  action: DownloadedRecentDocument["action"],
): ColumnPositions {
  return action === "remove"
    ? {
        code: 65,
        name: 135,
        address: 225,
        addressEnd: 370,
        content: 485,
        contentEnd: 580,
      }
    : {
        code: 25,
        name: 100,
        address: 220,
        addressEnd: 350,
        content: 380,
        contentEnd: null,
      };
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

async function recognizePage(
  pdfPage: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>,
  worker: Tesseract.Worker,
): Promise<PositionedText[]> {
  const scale = 3;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  await pdfPage.render({
    canvasContext: context as never,
    viewport,
    canvas: canvas as never,
  }).promise;
  const result = await worker.recognize(
    canvas.toBuffer("image/png"),
    {},
    { blocks: true, text: true },
  );
  return (result.data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) =>
        line.words
          .filter((word) => word.confidence >= 25)
          .map((word) => ({
            x: word.bbox.x0 / scale,
            y: line.bbox.y0 / scale,
            text: normalizeOcrText(word.text),
          }))
      )
    )
  );
}

function eventId(
  document: DownloadedRecentDocument,
  page: number,
  code: string,
  standard: {
    abbreviation: string | null;
    name: string | null;
    acceptanceNumber: string;
    effectiveFrom: string | null;
  },
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        document.sha256,
        page,
        code,
        document.action,
        standard.abbreviation,
        standard.name,
        standard.acceptanceNumber,
        standard.effectiveFrom,
      ]),
    )
    .digest("hex")
    .slice(0, 24);
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
  const columns =
    detectColumns(page.items, document.action) ??
    (page.ocr ? defaultOcrColumns(document.action) : null);
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
          id: eventId(document, page.page, fullCode, standard),
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
        id: eventId(document, page.page, fullCode, standard),
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

  for (const page of pages) {
    const parsed = parsePage(document, page);
    acceptanceCount += parsed.acceptanceCount;
    parsedEventCount += parsed.records.reduce(
      (sum, record) => sum + record.events.length,
      0,
    );
    if (parsed.records.length === 0) {
      warnings.push(`${document.documentUrl} ${page.page}ページ: 対象行なし`);
    }
    if (page.ocr) {
      warnings.push(
        `${document.documentUrl} ${page.page}ページ: 画像PDFのためOCRで解析`,
      );
    }
    for (const record of parsed.records) {
      mergeRecord(records, record);
    }
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
  const task = getDocument({
    data: new Uint8Array(document.bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages: PdfTextPage[] = [];
  let ocrWorker: Tesseract.Worker | null = null;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const pdfPage = await pdf.getPage(pageNumber);
      const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      let items = content.items.flatMap((item) => {
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
      let ocr = false;
      if (!detectColumns(items, document.action)) {
        await mkdir(".cache/tesseract", { recursive: true });
        ocrWorker ??= await Tesseract.createWorker(
          "jpn",
          Tesseract.OEM.LSTM_ONLY,
          {
            ...jpnData,
            cachePath: ".cache/tesseract",
          },
        );
        await ocrWorker.setParameters({
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        });
        items = await recognizePage(pdfPage, ocrWorker);
        ocr = true;
      }
      pages.push({ page: pageNumber, items, ocr });
      pdfPage.cleanup();
    }
  } finally {
    await ocrWorker?.terminate();
    await task.destroy();
  }
  return parseRecentPdfPages(document, pages);
}
