import path from "node:path";
import { SaxesParser, type SaxesTagPlain } from "saxes";
import yauzl from "yauzl";

const MAX_XML_ENTRY_BYTES = 512 * 1024 * 1024;

export interface TabularRow {
  number: number;
  cells: Map<number, string>;
}

export interface TabularWorksheet {
  name: string;
  rows: TabularRow[];
  maxColumn: number;
}

interface WorksheetMetadata {
  name: string;
  entryPath: string;
}

function decodeZipFileName(entry: yauzl.Entry): string {
  const raw = entry.fileName;
  if (typeof raw === "string") {
    return raw.replaceAll("\\", "/");
  }
  const encoding = (entry.generalPurposeBitFlag & 0x800) !== 0 ? "utf-8" : "shift_jis";
  return new TextDecoder(encoding).decode(raw).replaceAll("\\", "/");
}

function openZip(bytes: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      {
        lazyEntries: true,
        decodeStrings: false,
        validateEntrySizes: true,
      },
      (error, zip) => {
        if (error || !zip) {
          reject(error ?? new Error("XLSXをZIPとして開けません"));
          return;
        }
        resolve(zip);
      },
    );
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  if (entry.uncompressedSize > MAX_XML_ENTRY_BYTES) {
    throw new Error(
      `XLSX内部XMLが上限 ${MAX_XML_ENTRY_BYTES} bytes を超えました`,
    );
  }

  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error("XLSX内部XMLを開けません"));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_XML_ENTRY_BYTES) {
          stream.destroy(new Error("XLSX内部XMLが大きすぎます"));
          return;
        }
        chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

async function readSelectedEntries(
  bytes: Buffer,
  wanted: ReadonlySet<string>,
): Promise<Map<string, Buffer>> {
  const zip = await openZip(bytes);
  const result = new Map<string, Buffer>();

  return new Promise((resolve, reject) => {
    zip.once("error", reject);
    zip.once("end", () => resolve(result));
    zip.on("entry", (entry: yauzl.Entry) => {
      const entryPath = decodeZipFileName(entry);
      if (!wanted.has(entryPath)) {
        zip.readEntry();
        return;
      }

      void readEntry(zip, entry)
        .then((content) => {
          result.set(entryPath, content);
          zip.readEntry();
        })
        .catch((error: unknown) => {
          zip.close();
          reject(error);
        });
    });
    zip.readEntry();
  });
}

function parseXml(
  bytes: Buffer,
  handlers: {
    onOpenTag?: (tag: SaxesTagPlain) => void;
    onText?: (text: string) => void;
    onCloseTag?: (tag: SaxesTagPlain) => void;
  },
): void {
  const parser = new SaxesParser({ xmlns: false });
  if (handlers.onOpenTag) {
    parser.on("opentag", handlers.onOpenTag);
  }
  if (handlers.onText) {
    parser.on("text", handlers.onText);
    parser.on("cdata", handlers.onText);
  }
  if (handlers.onCloseTag) {
    parser.on("closetag", handlers.onCloseTag);
  }
  parser.write(bytes.toString("utf8")).close();
}

function attribute(tag: SaxesTagPlain, name: string): string {
  const value = tag.attributes[name];
  return typeof value === "string" ? value : "";
}

function parseRelationships(bytes: Buffer): Map<string, string> {
  const relationships = new Map<string, string>();
  parseXml(bytes, {
    onOpenTag(tag) {
      if (tag.name !== "Relationship") {
        return;
      }
      const id = attribute(tag, "Id");
      const target = attribute(tag, "Target");
      if (id && target) {
        relationships.set(id, target);
      }
    },
  });
  return relationships;
}

function parseWorksheetMetadata(
  workbookXml: Buffer,
  relationships: Map<string, string>,
): WorksheetMetadata[] {
  const worksheets: WorksheetMetadata[] = [];
  parseXml(workbookXml, {
    onOpenTag(tag) {
      if (tag.name !== "sheet") {
        return;
      }
      const name = attribute(tag, "name");
      const relationshipId = attribute(tag, "r:id");
      const target = relationships.get(relationshipId);
      if (!name || !target) {
        return;
      }
      const normalizedTarget = target.replace(/^\/+/, "");
      worksheets.push({
        name,
        entryPath: path.posix.normalize(
          normalizedTarget.startsWith("xl/")
            ? normalizedTarget
            : path.posix.join("xl", normalizedTarget),
        ),
      });
    },
  });
  return worksheets;
}

function parseSharedStrings(bytes: Buffer | undefined): string[] {
  if (!bytes) {
    return [];
  }

  const values: string[] = [];
  let inStringItem = false;
  let inText = false;
  let current = "";

  parseXml(bytes, {
    onOpenTag(tag) {
      if (tag.name === "si") {
        inStringItem = true;
        current = "";
      } else if (tag.name === "t" && inStringItem) {
        inText = true;
      }
    },
    onText(text) {
      if (inStringItem && inText) {
        current += text;
      }
    },
    onCloseTag(tag) {
      if (tag.name === "t") {
        inText = false;
      } else if (tag.name === "si") {
        values.push(current);
        inStringItem = false;
      }
    },
  });
  return values;
}

function columnNumber(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let result = 0;
  for (const character of letters) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function parseWorksheet(
  name: string,
  bytes: Buffer,
  sharedStrings: string[],
): TabularWorksheet {
  const rows: TabularRow[] = [];
  let currentRow: TabularRow | null = null;
  let currentCellColumn = 0;
  let currentCellType = "";
  let currentValue = "";
  let collectingValue = false;
  let maxColumn = 0;

  parseXml(bytes, {
    onOpenTag(tag) {
      if (tag.name === "row") {
        currentRow = {
          number: Number.parseInt(attribute(tag, "r"), 10) || rows.length + 1,
          cells: new Map(),
        };
      } else if (tag.name === "c" && currentRow) {
        currentCellColumn = columnNumber(attribute(tag, "r"));
        currentCellType = attribute(tag, "t");
        currentValue = "";
      } else if (
        (tag.name === "v" || tag.name === "t") &&
        currentCellColumn > 0
      ) {
        collectingValue = true;
      }
    },
    onText(text) {
      if (collectingValue) {
        currentValue += text;
      }
    },
    onCloseTag(tag) {
      if (tag.name === "v" || tag.name === "t") {
        collectingValue = false;
        return;
      }
      if (tag.name === "c" && currentRow && currentCellColumn > 0) {
        let value = currentValue;
        if (currentCellType === "s") {
          value = sharedStrings[Number.parseInt(currentValue, 10)] ?? "";
        } else if (currentCellType === "b") {
          value = currentValue === "1" ? "TRUE" : "FALSE";
        }
        if (value !== "") {
          currentRow.cells.set(currentCellColumn, value);
          maxColumn = Math.max(maxColumn, currentCellColumn);
        }
        currentCellColumn = 0;
        currentCellType = "";
        currentValue = "";
      } else if (tag.name === "row" && currentRow) {
        if (currentRow.cells.size > 0) {
          rows.push(currentRow);
        }
        currentRow = null;
      }
    },
  });

  return { name, rows, maxColumn };
}

export async function readXlsxWorksheets(
  bytes: Buffer,
  onWorksheet: (worksheet: TabularWorksheet) => void | Promise<void>,
): Promise<void> {
  const metadataEntries = await readSelectedEntries(
    bytes,
    new Set([
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/sharedStrings.xml",
    ]),
  );
  const workbookXml = metadataEntries.get("xl/workbook.xml");
  const relationshipsXml = metadataEntries.get("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationshipsXml) {
    throw new Error("XLSXのworkbook.xmlまたはrelationshipsがありません");
  }

  const relationships = parseRelationships(relationshipsXml);
  const worksheets = parseWorksheetMetadata(workbookXml, relationships);
  const sharedStrings = parseSharedStrings(
    metadataEntries.get("xl/sharedStrings.xml"),
  );
  const sheetEntries = await readSelectedEntries(
    bytes,
    new Set(worksheets.map((worksheet) => worksheet.entryPath)),
  );

  for (const worksheet of worksheets) {
    const sheetXml = sheetEntries.get(worksheet.entryPath);
    if (!sheetXml) {
      throw new Error(`XLSX内部に ${worksheet.entryPath} がありません`);
    }
    await onWorksheet(
      parseWorksheet(worksheet.name, sheetXml, sharedStrings),
    );
  }
}
