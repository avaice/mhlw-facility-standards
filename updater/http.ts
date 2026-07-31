import { createHash } from "node:crypto";
import type {
  DiscoveredDocument,
  DownloadedDocument,
} from "./types.js";

const USER_AGENT =
  "mhlw-facility-standards/0.1 (+https://github.com/your-org/mhlw-facility-standards)";
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
const MAX_ATTEMPTS = 3;

function assertAllowedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".mhlw.go.jp")) {
    throw new Error(`許可されていない取得先です: ${url.href}`);
  }
  return url;
}

async function fetchWithRetry(url: URL): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "*/*",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }

  throw new Error(`${url.href} の取得に失敗しました`, { cause: lastError });
}

export async function fetchPage(urlValue: string): Promise<string> {
  const url = assertAllowedUrl(urlValue);
  const response = await fetchWithRetry(url);
  return response.text();
}

export async function downloadDocument(
  document: DiscoveredDocument,
): Promise<DownloadedDocument> {
  const url = assertAllowedUrl(document.documentUrl);
  const response = await fetchWithRetry(url);
  const contentLength = Number(response.headers.get("content-length") ?? "0");

  if (contentLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${url.href} は上限 ${MAX_DOCUMENT_BYTES} bytes を超えています`,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${url.href} は上限 ${MAX_DOCUMENT_BYTES} bytes を超えています`,
    );
  }

  return {
    ...document,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function downloadTypedDocument<
  T extends { documentUrl: string },
>(document: T): Promise<T & { bytes: Buffer; sha256: string }> {
  const url = assertAllowedUrl(document.documentUrl);
  const response = await fetchWithRetry(url);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${url.href} は上限 ${MAX_DOCUMENT_BYTES} bytes を超えています`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(
      `${url.href} は上限 ${MAX_DOCUMENT_BYTES} bytes を超えています`,
    );
  }
  return {
    ...document,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      const value = values[index];
      if (value === undefined) {
        throw new Error(`並列処理の入力 ${index} が存在しません`);
      }
      result[index] = await mapper(value, index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  );
  return result;
}
