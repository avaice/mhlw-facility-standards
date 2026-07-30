import { load, type CheerioAPI } from "cheerio";
import { extractAsOfDates, maxIsoDate } from "./utils/date.js";
import { inferCategory, normalizeText } from "./utils/text.js";
import type {
  DiscoveredDocument,
  SourceDefinition,
} from "./types.js";

const DOCUMENT_EXTENSION = /\.(?:xlsx|xlsm|zip)(?:$|[?#])/i;
const HEADING_TAG = /^h([1-6])$/i;
interface Candidate {
  documentUrl: string;
  asOf: string | null;
  context: string;
  categoryHint: ReturnType<typeof inferCategory>;
}

function directText($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  return normalizeText(
    $(element)
      .contents()
      .filter((_, node) => node.type === "text")
      .text(),
  );
}

function nearestRowContext(
  $: CheerioAPI,
  element: Parameters<CheerioAPI>[0],
): string {
  const anchor = $(element);
  const container = anchor.closest("tr, li, p, dd, dt");
  return normalizeText(container.length ? container.text() : anchor.parent().text());
}

function absoluteDocumentUrl(href: string, pageUrl: string): string | null {
  try {
    const url = new URL(href, pageUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".mhlw.go.jp")) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function discoverDocuments(
  source: SourceDefinition,
  html: string,
): DiscoveredDocument[] {
  const $ = load(html);
  const headings: Array<string | undefined> = [];
  const pageDates = extractAsOfDates($.root().text());
  let currentAsOf: string | null = null;
  const candidates: Candidate[] = [];

  $("body *").each((_, element) => {
    const tagName = element.type === "tag" ? element.tagName.toLowerCase() : "";
    if (!tagName) {
      return;
    }

    const headingMatch = tagName.match(HEADING_TAG);
    if (headingMatch) {
      const level = Number.parseInt(headingMatch[1] ?? "1", 10);
      headings[level] = normalizeText($(element).text());
      headings.splice(level + 1);
    }

    const found = extractAsOfDates(directText($, element));
    if (found.length > 0) {
      currentAsOf = maxIsoDate(found);
    }

    if (tagName !== "a") {
      return;
    }

    const href = $(element).attr("href");
    if (!href || !DOCUMENT_EXTENSION.test(href)) {
      return;
    }

    const documentUrl = absoluteDocumentUrl(href, source.pageUrl);
    if (!documentUrl) {
      return;
    }

    const rowContext = nearestRowContext($, element);
    const headingContext = headings.filter(Boolean).join(" / ");
    const sectionPath = headings.slice(2).filter(Boolean).join(" / ");
    const context = normalizeText(
      `${headingContext} / ${rowContext} / ${$(element).text()}`,
    );

    if (
      !source.targetSection.test(context) ||
      source.excludedSection.test(`${sectionPath} ${rowContext}`)
    ) {
      return;
    }

    candidates.push({
      documentUrl,
      asOf: currentAsOf,
      context,
      categoryHint:
        inferCategory(`${$(element).text()} ${documentUrl}`) ??
        inferCategory(rowContext),
    });
  });

  const latestAsOf =
    maxIsoDate(candidates.flatMap((candidate) => candidate.asOf ?? [])) ??
    maxIsoDate(pageDates);
  if (!latestAsOf) {
    throw new Error(`${source.id}: 掲載基準日（○年○月○日現在）を検出できません`);
  }

  const latestCandidates = candidates.filter(
    (candidate) => (candidate.asOf ?? latestAsOf) === latestAsOf,
  );
  const deduplicated = new Map<string, DiscoveredDocument>();

  for (const candidate of latestCandidates) {
    const existing = deduplicated.get(candidate.documentUrl);
    if (existing) {
      if (!existing.categoryHint && candidate.categoryHint) {
        deduplicated.set(candidate.documentUrl, {
          ...existing,
          categoryHint: candidate.categoryHint,
        });
      }
      continue;
    }

    deduplicated.set(candidate.documentUrl, {
      sourceId: source.id,
      bureauName: source.bureauName,
      pageUrl: source.pageUrl,
      documentUrl: candidate.documentUrl,
      asOf: latestAsOf,
      categoryHint: candidate.categoryHint,
      context: candidate.context,
    });
  }

  const documents = [...deduplicated.values()].sort((a, b) =>
    a.documentUrl.localeCompare(b.documentUrl),
  );
  if (documents.length === 0) {
    throw new Error(`${source.id}: 最新のExcel/ZIPリンクを検出できません`);
  }
  return documents;
}
