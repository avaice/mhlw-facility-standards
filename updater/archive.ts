import path from "node:path";
import yauzl from "yauzl";
import type { DownloadedDocument, WorkbookDocument } from "./types.js";

const MAX_WORKBOOK_BYTES = 60 * 1024 * 1024;
const SUPPORTED_WORKBOOK = /\.(?:xlsx|xlsm)$/i;
const UNSUPPORTED_WORKBOOK = /\.xls$/i;

function documentFileName(documentUrl: string): string {
  const url = new URL(documentUrl);
  return decodeURIComponent(path.posix.basename(url.pathname));
}

function decodeZipFileName(entry: yauzl.Entry): string {
  const raw = entry.fileName;
  if (typeof raw === "string") {
    return raw;
  }
  const encoding = (entry.generalPurposeBitFlag & 0x800) !== 0 ? "utf-8" : "shift_jis";
  return new TextDecoder(encoding).decode(raw);
}

function readZipEntry(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (openError, stream) => {
      if (openError || !stream) {
        reject(openError ?? new Error("ZIPエントリを開けません"));
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_WORKBOOK_BYTES) {
          stream.destroy(
            new Error(`展開後ファイルが上限 ${MAX_WORKBOOK_BYTES} bytes を超えました`),
          );
          return;
        }
        chunks.push(chunk);
      });
      stream.once("error", reject);
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
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
          reject(error ?? new Error("ZIPを開けません"));
          return;
        }
        resolve(zip);
      },
    );
  });
}

async function extractZipWorkbooks(
  document: DownloadedDocument,
): Promise<WorkbookDocument[]> {
  const zip = await openZip(document.bytes);
  const workbooks: WorkbookDocument[] = [];

  return new Promise((resolve, reject) => {
    zip.once("error", reject);
    zip.once("end", () => resolve(workbooks));
    zip.on("entry", (entry: yauzl.Entry) => {
      const fileName = decodeZipFileName(entry).replaceAll("\\", "/");
      const normalized = path.posix.normalize(fileName);

      if (
        normalized.startsWith("../") ||
        normalized.startsWith("/") ||
        normalized.includes("/../")
      ) {
        zip.close();
        reject(new Error(`危険なZIPエントリです: ${fileName}`));
        return;
      }
      if (/\/$/.test(normalized) || normalized.startsWith("__MACOSX/")) {
        zip.readEntry();
        return;
      }
      if (UNSUPPORTED_WORKBOOK.test(normalized)) {
        zip.close();
        reject(new Error(`旧式 .xls は未対応です: ${normalized}`));
        return;
      }
      if (!SUPPORTED_WORKBOOK.test(normalized)) {
        zip.readEntry();
        return;
      }
      if (entry.uncompressedSize > MAX_WORKBOOK_BYTES) {
        zip.close();
        reject(new Error(`展開後ファイルが大きすぎます: ${normalized}`));
        return;
      }

      void readZipEntry(zip, entry)
        .then((bytes) => {
          const { bytes: _documentBytes, ...source } = document;
          workbooks.push({ source, fileName: normalized, bytes });
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

export async function extractWorkbooks(
  document: DownloadedDocument,
): Promise<WorkbookDocument[]> {
  const fileName = documentFileName(document.documentUrl);
  if (UNSUPPORTED_WORKBOOK.test(fileName)) {
    throw new Error(`旧式 .xls は未対応です: ${fileName}`);
  }
  if (SUPPORTED_WORKBOOK.test(fileName)) {
    const { bytes: _documentBytes, ...source } = document;
    return [{ source, fileName, bytes: document.bytes }];
  }
  if (/\.zip$/i.test(fileName)) {
    const workbooks = await extractZipWorkbooks(document);
    if (workbooks.length === 0) {
      throw new Error(`${fileName}: ZIP内に .xlsx/.xlsm がありません`);
    }
    return workbooks;
  }
  throw new Error(`未対応の配布形式です: ${fileName}`);
}
