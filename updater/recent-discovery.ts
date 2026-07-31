import { load, type CheerioAPI } from "cheerio";
import type {
  ChangeAction,
  DiscoveredRecentDocument,
  FacilityCategory,
  RecentSourceDefinition,
} from "./types.js";
import {
  extractJapaneseDates,
  maxIsoDate,
} from "./utils/date.js";
import { inferCategory, normalizeText } from "./utils/text.js";

const PDF_EXTENSION = /\.pdf(?:$|[?#])/iu;
const EXCLUDED_CONTEXT =
  /訪看|訪問看護|はり|きゅう|あん摩|柔道整復|コード表|略称|記号一覧|記載要領|PDFファイル内を検索する方法|検索方法/u;
const REMOVE_CONTEXT = /失効|辞退|廃止|取下げ|取り下げ/u;

interface Candidate {
  documentUrl: string;
  publishedAt: string | null;
  context: string;
  categoryHint: FacilityCategory | null;
  action: ChangeAction;
}

function categoryFromUrl(value: string): FacilityCategory | null {
  const named = inferCategory(value);
  if (named) {
    return named;
  }
  const path = new URL(value).pathname;
  const numeric =
    path.match(/\/\d{2}_(01|03|04)_/u)?.[1] ??
    path.match(/[-_](01|03|04)\.pdf$/iu)?.[1];
  switch (numeric) {
    case "01":
      return "medical";
    case "03":
      return "dental";
    case "04":
      return "pharmacy";
    default:
      return null;
  }
}

function dateFromUrl(value: string): string | null {
  const path = new URL(value).pathname;
  const western = path.match(/(20\d{2})(\d{2})(\d{2})/u);
  if (western) {
    return `${western[1]}-${western[2]}-${western[3]}`;
  }
  const shortWestern = path.match(/\/(2\d)(\d{2})(\d{2})-/u);
  if (shortWestern) {
    return `20${shortWestern[1]}-${shortWestern[2]}-${shortWestern[3]}`;
  }
  const reiwa = path.match(/(?:^|[_-])(0?\d)(\d{2})(\d{2})(?:[_.-]|$)/u);
  if (reiwa) {
    return `${2018 + Number(reiwa[1])}-${reiwa[2]}-${reiwa[3]}`;
  }
  return null;
}

function precedingTableDate(
  $: CheerioAPI,
  element: Parameters<CheerioAPI>[0],
): string | null {
  const row = $(element).closest("tr");
  if (!row.length) {
    return null;
  }
  const rows = [row.get(0), ...row.prevAll("tr").toArray()];
  for (const candidate of rows) {
    const date = maxIsoDate(extractJapaneseDates($(candidate).text()));
    if (date) {
      return date;
    }
  }
  return null;
}

function isBeforeBaseMonth(value: string, baseAsOf: string): boolean {
  const path = new URL(value).pathname;
  const month = path.match(/(20\d{2})\.(\d{1,2})-[12]_/u);
  if (!month) {
    return false;
  }
  const encodedMonth = `${month[1]}-${String(month[2]).padStart(2, "0")}`;
  return encodedMonth < baseAsOf.slice(0, 7);
}

function prefectureFromUrl(value: string): string | null {
  const path = new URL(value).pathname;
  return (
    path.match(/-(?:21|22)-(\d{2})-(?:01|03|04)/u)?.[1] ??
    path.match(/\/(\d{2})_(?:01|03|04)_/u)?.[1] ??
    path.match(/_(\d{2})[a-z]+_(?:ika|shika|yakkyoku)_/iu)?.[1] ??
    null
  );
}

function directText($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  return normalizeText(
    $(element)
      .contents()
      .filter((_, node) => node.type === "text")
      .text(),
  );
}

function absolutePdfUrl(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(href, pageUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".mhlw.go.jp") ||
      !PDF_EXTENSION.test(url.href)
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function tableColumnContext(
  $: CheerioAPI,
  element: Parameters<CheerioAPI>[0],
): string {
  const cell = $(element).closest("td, th");
  const table = cell.closest("table");
  if (!cell.length || !table.length) {
    return "";
  }
  const index = cell.parent().children("th, td").index(cell);
  const headers = table
    .find("tr")
    .first()
    .children("th, td")
    .toArray();
  return normalizeText($(headers[index]).text());
}

export function discoverRecentDocuments(
  source: RecentSourceDefinition,
  html: string,
  baseAsOf: string,
): DiscoveredRecentDocument[] {
  const $ = load(html);
  const headings: Array<string | undefined> = [];
  let currentDate: string | null = null;
  const candidates: Candidate[] = [];

  $("body *").each((_, element) => {
    const tagName = element.type === "tag" ? element.tagName.toLowerCase() : "";
    if (!tagName) {
      return;
    }

    const heading = tagName.match(/^h([1-6])$/u);
    if (heading) {
      const level = Number.parseInt(heading[1] ?? "1", 10);
      headings[level] = normalizeText($(element).text());
      headings.splice(level + 1);
    }

    const dates = extractJapaneseDates(directText($, element));
    if (dates.length > 0) {
      currentDate = maxIsoDate(dates);
    }

    if (tagName !== "a") {
      return;
    }
    const href = $(element).attr("href");
    if (!href) {
      return;
    }
    const documentUrl = absolutePdfUrl(href, source.pageUrl);
    if (!documentUrl) {
      return;
    }

    const row = $(element).closest("tr, li, p, dd, dt");
    const nearby = normalizeText(
      row.length ? row.text() : $(element).parent().text(),
    );
    const column = tableColumnContext($, element);
    const rowPdfAnchors = row
      .find("a")
      .toArray()
      .filter((anchor) => PDF_EXTENSION.test($(anchor).attr("href") ?? ""));
    const rowPdfIndex = rowPdfAnchors.indexOf(element);
    const orderedRowCategory =
      rowPdfAnchors.length === 4 && rowPdfIndex >= 0 && rowPdfIndex < 3
        ? (["medical", "dental", "pharmacy"] as const)[rowPdfIndex] ?? null
        : null;
    if (
      !categoryFromUrl(documentUrl) &&
      rowPdfAnchors.length === 4 &&
      rowPdfIndex === 3
    ) {
      return;
    }
    const context = normalizeText(
      `${headings.filter(Boolean).join(" / ")} / ${column} / ${nearby} / ${$(element).text()}`,
    );
    const deepestHeading = normalizeText(
      headings.filter(Boolean).at(-1) ?? "",
    );
    if (
      (source.documentUrlPattern &&
        !source.documentUrlPattern.test(documentUrl)) ||
      (source.documentContextPattern &&
        !source.documentContextPattern.test(context)) ||
      /訪看|訪問看護/u.test(deepestHeading) ||
      isBeforeBaseMonth(documentUrl, baseAsOf)
    ) {
      return;
    }
    const categoryHint =
      categoryFromUrl(documentUrl) ??
      orderedRowCategory ??
      inferCategory(column) ??
      [...headings]
        .reverse()
        .map((value) => inferCategory(value ?? ""))
        .find((value) => value !== null) ??
      inferCategory(nearby);
    if (
      !categoryHint ||
      EXCLUDED_CONTEXT.test(`${column} ${$(element).text()}`)
    ) {
      return;
    }
    const nearbyDate =
      maxIsoDate(extractJapaneseDates(nearby)) ??
      precedingTableDate($, element);
    const urlDate = dateFromUrl(documentUrl);
    const anchorText = normalizeText($(element).text());
    const explicitActionContext = `${anchorText} ${documentUrl}`;
    const action =
      REMOVE_CONTEXT.test(explicitActionContext) ||
        /jitai|sikkou|shikkou|sikkou/iu.test(documentUrl)
        ? "remove"
        : /新規|変更/u.test(anchorText)
          ? "upsert"
          : REMOVE_CONTEXT.test(nearby)
            ? "remove"
            : /新規|変更/u.test(nearby)
              ? "upsert"
              : REMOVE_CONTEXT.test(context)
                ? "remove"
                : "upsert";
    candidates.push({
      documentUrl,
      publishedAt: nearbyDate ?? urlDate ?? currentDate,
      context,
      categoryHint,
      action,
    });
  });

  const pageLatestDate = maxIsoDate(extractJapaneseDates($.root().text()));
  const deduplicated = new Map<string, DiscoveredRecentDocument>();
  for (const candidate of candidates) {
    const publishedAt = candidate.publishedAt ?? pageLatestDate;
    if (!publishedAt || publishedAt <= baseAsOf) {
      continue;
    }
    const existing = deduplicated.get(candidate.documentUrl);
    if (existing) {
      if (!existing.categoryHint && candidate.categoryHint) {
        existing.categoryHint = candidate.categoryHint;
      }
      if (candidate.action === "remove") {
        existing.action = "remove";
      }
      continue;
    }
    deduplicated.set(candidate.documentUrl, {
      sourceId: source.sourceId,
      bureauName: source.bureauName,
      pageUrl: source.pageUrl,
      documentUrl: candidate.documentUrl,
      asOf: publishedAt,
      categoryHint: candidate.categoryHint,
      context: candidate.context,
      action: candidate.action,
      prefectureCodeHint:
        prefectureFromUrl(candidate.documentUrl) ??
        source.prefectureCodeHint,
    });
  }

  return [...deduplicated.values()].sort((a, b) =>
    a.documentUrl.localeCompare(b.documentUrl),
  );
}
