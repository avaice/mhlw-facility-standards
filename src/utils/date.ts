import { normalizeText } from "./text.js";

const ERA_BASE_YEAR: Record<string, number> = {
  令和: 2018,
  平成: 1988,
  昭和: 1925,
};

function toEraYear(value: string): number {
  return value === "元" ? 1 : Number.parseInt(value, 10);
}

function formatDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseJapaneseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDate(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
  }

  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const iso = normalized.match(
    /(?:^|\D)(\d{4})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?(?:\D|$)/,
  );
  if (iso) {
    return formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const era = normalized.match(
    /(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  if (!era) {
    return null;
  }

  const base = ERA_BASE_YEAR[era[1] ?? ""];
  if (base === undefined) {
    return null;
  }

  return formatDate(
    base + toEraYear(era[2] ?? ""),
    Number(era[3]),
    Number(era[4]),
  );
}

export function extractAsOfDates(value: string): string[] {
  const normalized = normalizeText(value);
  const matches = normalized.matchAll(
    /(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*現在/g,
  );

  const dates: string[] = [];
  for (const match of matches) {
    const date = parseJapaneseDate(match[0]);
    if (date) {
      dates.push(date);
    }
  }
  return dates;
}

export function maxIsoDate(values: Iterable<string>): string | null {
  const dates = [...values].filter(Boolean).sort();
  return dates.at(-1) ?? null;
}
