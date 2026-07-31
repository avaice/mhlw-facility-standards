import {
  PREFECTURES,
  SOURCE_PREFECTURE_CODES,
} from "../config/prefectures.js";
import type {
  FacilityCategory,
  FacilityRecord,
  ParsedWorkbook,
  StandardRecord,
  WorkbookDocument,
} from "../types.js";
import {
  extractAsOfDates,
  parseJapaneseDate,
} from "../utils/date.js";
import {
  compactText,
  inferCategory,
  normalizeDigits,
  normalizeText,
} from "../utils/text.js";
import {
  readXlsxWorksheets,
  type TabularRow,
  type TabularWorksheet,
} from "./xlsx-reader.js";

type ColumnField =
  | "code"
  | "prefectureCode"
  | "category"
  | "name"
  | "address"
  | "standardName"
  | "abbreviation"
  | "acceptance"
  | "effectiveFrom";

type ColumnMap = Partial<Record<ColumnField, number>>;

const HEADER_PATTERNS: Record<ColumnField, RegExp> = {
  code: /^(?!併設)(?:保険)?(?:医療機関|薬局)(?:番号|コード)$/u,
  prefectureCode: /^都道府県コード$/u,
  category: /^区分$/u,
  name: /(?:保険)?(?:医療機関|薬局)(?:名称|名)$/u,
  address: /(?:医療機関|薬局)?所在地(?:住所)?$/u,
  standardName: /(?:受理)?(?:届出|施設基準)(?:項目)?(?:名称|名)$/u,
  abbreviation: /受理(?:記号|略称)$/u,
  acceptance: /(?:届出)?受理番号$/u,
  effectiveFrom: /算定開始(?:年月日|日)$/u,
};

const CATEGORY_POINT_TABLE: Record<FacilityCategory, string> = {
  medical: "1",
  dental: "3",
  pharmacy: "4",
};

function valueAtColumn(row: TabularRow | undefined, column: number): string {
  return row?.cells.get(column) ?? "";
}

function rowText(row: TabularRow | undefined): string {
  return [...(row?.cells.values() ?? [])]
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function worksheetContext(
  document: WorkbookDocument,
  worksheet: TabularWorksheet,
): string {
  const rows = worksheet.rows
    .filter((row) => row.number <= 20)
    .map((row) => rowText(row));
  return normalizeText(
    `${document.source.context} ${document.fileName} ${worksheet.name} ${rows.join(" ")}`,
  );
}

function inferPrefectureCode(
  document: WorkbookDocument,
  worksheet: TabularWorksheet,
): string | null {
  const context = worksheetContext(document, worksheet);
  for (const [code, name] of PREFECTURES) {
    if (context.includes(name)) {
      return code;
    }
  }

  const available = SOURCE_PREFECTURE_CODES[document.source.sourceId] ?? [];
  return available.length === 1 ? available[0] ?? null : null;
}

function inferWorksheetCategory(
  document: WorkbookDocument,
  worksheet: TabularWorksheet,
): FacilityCategory | null {
  return (
    inferCategory(
      normalizeText(
        `${document.fileName} ${worksheet.name} ${rowText(worksheet.rows[0])} ${rowText(worksheet.rows[1])}`,
      ),
    ) ?? document.source.categoryHint
  );
}

function combinedHeader(
  rowsByNumber: Map<number, TabularRow>,
  rowNumber: number,
  columnNumber: number,
): string {
  const parts: string[] = [];
  for (
    let headerRow = Math.max(1, rowNumber - 2);
    headerRow <= rowNumber;
    headerRow += 1
  ) {
    const value = compactText(
      valueAtColumn(rowsByNumber.get(headerRow), columnNumber),
    );
    if (value) {
      parts.push(value);
    }
  }
  return parts.join("");
}

function detectColumns(
  worksheet: TabularWorksheet,
): { headerRow: number; columns: ColumnMap } | null {
  const rowsByNumber = new Map(
    worksheet.rows.map((row) => [row.number, row]),
  );
  const candidateRows = worksheet.rows.filter((row) => row.number <= 50);
  const maxColumns = Math.min(50, worksheet.maxColumn);

  for (const row of candidateRows) {
    const columns: ColumnMap = {};
    for (let columnNumber = 1; columnNumber <= maxColumns; columnNumber += 1) {
      const header = combinedHeader(
        rowsByNumber,
        row.number,
        columnNumber,
      );
      if (!header) {
        continue;
      }
      for (const [field, pattern] of Object.entries(HEADER_PATTERNS) as Array<
        [ColumnField, RegExp]
      >) {
        if (columns[field] === undefined && pattern.test(header)) {
          columns[field] = columnNumber;
        }
      }
    }

    if (
      columns.code !== undefined &&
      columns.name !== undefined &&
      (columns.acceptance !== undefined || columns.standardName !== undefined)
    ) {
      return { headerRow: row.number, columns };
    }
  }

  return null;
}

function normalizeLocalOrFullCode(
  value: unknown,
): { localCode: string; fullCode: string | null } | null {
  const digits = normalizeDigits(value);
  if (!digits) {
    return null;
  }
  if (digits.length === 10 && /^[0-4]\d[134]\d{7}$/.test(digits)) {
    return { localCode: digits.slice(3), fullCode: digits };
  }
  if (digits.length <= 7) {
    return { localCode: digits.padStart(7, "0"), fullCode: null };
  }
  return null;
}

function categoryFromFullCode(code: string): FacilityCategory | null {
  switch (code[2]) {
    case "1":
      return "medical";
    case "3":
      return "dental";
    case "4":
      return "pharmacy";
    default:
      return null;
  }
}

function excelSerialDate(value: string): string | null {
  if (!/^\d{4,5}(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 20_000 || serial > 80_000) {
    return null;
  }
  return parseJapaneseDate(
    new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000),
  );
}

function extractDates(value: unknown): string[] {
  if (value instanceof Date) {
    const parsed = parseJapaneseDate(value);
    return parsed ? [parsed] : [];
  }

  const text = String(value ?? "");
  const serialDate = excelSerialDate(text.trim());
  if (serialDate) {
    return [serialDate];
  }

  const segments = [
    ...text.matchAll(
      /(?:令和|平成|昭和)\s*(?:元|\d{1,2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g,
    ),
    ...text.matchAll(/\d{4}[年/\-.]\d{1,2}[月/\-.]\d{1,2}日?/g),
  ]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((match) => match[0]);

  return segments
    .map((segment) => parseJapaneseDate(segment))
    .filter((date): date is string => date !== null);
}

function splitNames(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
}

function parseStandards(
  acceptanceRaw: string,
  standardNameRaw: string,
  abbreviationRaw: string,
  effectiveRaw: unknown,
): StandardRecord[] {
  const names = splitNames(standardNameRaw);
  const dates = extractDates(effectiveRaw);
  const acceptanceMatches = [
    ...acceptanceRaw.matchAll(
      /[（(]([^（）()\r\n]+)[）)]\s*(第\s*[^第（(\r\n]*?号)?/gu,
    ),
  ];

  if (acceptanceMatches.length === 0) {
    const acceptanceNumber = normalizeText(acceptanceRaw);
    const name = names[0] ?? null;
    if (!acceptanceNumber && !name) {
      return [];
    }
    return [
      {
        abbreviation: normalizeText(abbreviationRaw) || null,
        name,
        acceptanceNumber,
        effectiveFrom: dates[0] ?? null,
      },
    ];
  }

  return acceptanceMatches.map((match, index) => ({
    abbreviation: normalizeText(match[1]) || null,
    name:
      names.length === acceptanceMatches.length
        ? names[index] ?? null
        : names.length === 1 && acceptanceMatches.length === 1
          ? names[0] ?? null
          : null,
    acceptanceNumber: normalizeText(match[2] ?? ""),
    effectiveFrom:
      dates.length === acceptanceMatches.length
        ? dates[index] ?? null
        : dates.length === 1
          ? dates[0] ?? null
          : null,
  }));
}

function standardKey(standard: StandardRecord): string {
  return [
    standard.abbreviation ?? "",
    standard.name ?? "",
    standard.acceptanceNumber,
    standard.effectiveFrom ?? "",
  ].join("\u0000");
}

function provenanceKey(record: FacilityRecord["sources"][number]): string {
  return [
    record.documentSha256,
    record.workbook,
    record.worksheet,
  ].join("\u0000");
}

function mergeFacilityRecord(
  target: Map<string, FacilityRecord>,
  incoming: FacilityRecord,
): void {
  const existing = target.get(incoming.medicalInstitutionCode);
  if (!existing) {
    target.set(incoming.medicalInstitutionCode, incoming);
    return;
  }

  if (
    existing.facility.name !== incoming.facility.name &&
    incoming.facility.name.length > existing.facility.name.length
  ) {
    existing.facility.name = incoming.facility.name;
  }
  existing.facility.address ??= incoming.facility.address;
  existing.asOf = existing.asOf > incoming.asOf ? existing.asOf : incoming.asOf;

  const standardKeys = new Set(existing.standards.map(standardKey));
  for (const standard of incoming.standards) {
    const key = standardKey(standard);
    if (!standardKeys.has(key)) {
      existing.standards.push(standard);
      standardKeys.add(key);
    }
  }

  const provenanceKeys = new Set(existing.sources.map(provenanceKey));
  for (const source of incoming.sources) {
    const key = provenanceKey(source);
    if (!provenanceKeys.has(key)) {
      existing.sources.push(source);
      provenanceKeys.add(key);
    }
  }
}

function textAt(
  row: TabularRow,
  columns: ColumnMap,
  field: ColumnField,
): string {
  const column = columns[field];
  return column === undefined ? "" : valueAtColumn(row, column);
}

function parseWorksheet(
  document: WorkbookDocument,
  worksheet: TabularWorksheet,
): ParsedWorkbook {
  const detection = detectColumns(worksheet);
  if (!detection) {
    return {
      records: [],
      warnings: [
        `${document.fileName}/${worksheet.name}: 対応する見出し行が見つかりません`,
      ],
    };
  }

  const prefectureHint = inferPrefectureCode(document, worksheet);
  const categoryHint = inferWorksheetCategory(document, worksheet);
  const records = new Map<string, FacilityRecord>();
  const warnings: string[] = [];
  let currentCode: ReturnType<typeof normalizeLocalOrFullCode> = null;
  let currentName = "";
  let currentAddress: string | null = null;

  for (const row of worksheet.rows) {
    if (row.number <= detection.headerRow) {
      continue;
    }

    const parsedCode = normalizeLocalOrFullCode(
      textAt(row, detection.columns, "code"),
    );
    if (parsedCode) {
      currentCode = parsedCode;
    }

    const name = normalizeText(textAt(row, detection.columns, "name"));
    if (name) {
      currentName = name;
    }
    const address = normalizeText(textAt(row, detection.columns, "address"));
    if (address) {
      currentAddress = address;
    }

    const standards = parseStandards(
      textAt(row, detection.columns, "acceptance"),
      textAt(row, detection.columns, "standardName"),
      textAt(row, detection.columns, "abbreviation"),
      textAt(row, detection.columns, "effectiveFrom"),
    );
    if (!currentCode || !currentName || standards.length === 0) {
      continue;
    }

    const rowCategory = inferCategory(
      textAt(row, detection.columns, "category"),
    );
    const rowPrefectureDigits = normalizeDigits(
      textAt(row, detection.columns, "prefectureCode"),
    );
    const rowPrefectureCode = /^\d{1,2}$/.test(rowPrefectureDigits)
      ? rowPrefectureDigits.padStart(2, "0")
      : null;
    const category = currentCode.fullCode
      ? categoryFromFullCode(currentCode.fullCode)
      : rowCategory ?? categoryHint;
    const prefectureCode = currentCode.fullCode
      ? currentCode.fullCode.slice(0, 2)
      : rowPrefectureCode
        ? rowPrefectureCode
        : prefectureHint;

    if (!category || !prefectureCode) {
      warnings.push(
        `${document.fileName}/${worksheet.name}:${row.number}: 都道府県または区分を特定できません`,
      );
      continue;
    }

    const fullCode =
      currentCode.fullCode ??
      `${prefectureCode}${CATEGORY_POINT_TABLE[category]}${currentCode.localCode}`;
    const source = {
      bureauId: document.source.sourceId,
      bureauName: document.source.bureauName,
      pageUrl: document.source.pageUrl,
      documentUrl: document.source.documentUrl,
      documentSha256: document.source.sha256,
      workbook: document.fileName,
      worksheet: worksheet.name,
    };

    mergeFacilityRecord(records, {
      schemaVersion: 1,
      medicalInstitutionCode: fullCode,
      localCode: currentCode.localCode,
      prefectureCode,
      category,
      facility: {
        name: currentName,
        address: currentAddress,
      },
      standards,
      asOf: document.source.asOf,
      sources: [source],
    });
  }

  return { records: [...records.values()], warnings };
}

export async function parseWorkbook(
  document: WorkbookDocument,
): Promise<ParsedWorkbook> {
  const records = new Map<string, FacilityRecord>();
  const warnings: string[] = [];

  await readXlsxWorksheets(document.bytes, (worksheet) => {
    const workbookAsOfDates = extractAsOfDates(
      worksheetContext(document, worksheet),
    );
    if (
      workbookAsOfDates.length > 0 &&
      !workbookAsOfDates.includes(document.source.asOf)
    ) {
      throw new Error(
        `${document.fileName}/${worksheet.name}: 掲載ページの基準日 ` +
          `${document.source.asOf} とワークブック内の基準日 ` +
          `${[...new Set(workbookAsOfDates)].join(", ")} が一致しません`,
      );
    }
    const parsed = parseWorksheet(document, worksheet);
    warnings.push(...parsed.warnings);
    for (const record of parsed.records) {
      mergeFacilityRecord(records, record);
    }
  });

  for (const record of records.values()) {
    record.standards.sort((a, b) =>
      standardKey(a).localeCompare(standardKey(b), "ja"),
    );
    record.sources.sort((a, b) =>
      provenanceKey(a).localeCompare(provenanceKey(b)),
    );
  }

  return {
    records: [...records.values()].sort((a, b) =>
      a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode),
    ),
    warnings,
  };
}

export function mergeFacilityRecords(
  records: Iterable<FacilityRecord>,
): FacilityRecord[] {
  const merged = new Map<string, FacilityRecord>();
  for (const record of records) {
    mergeFacilityRecord(merged, record);
  }
  return [...merged.values()].sort((a, b) =>
    a.medicalInstitutionCode.localeCompare(b.medicalInstitutionCode),
  );
}
