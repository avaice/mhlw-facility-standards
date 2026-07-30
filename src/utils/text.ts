import type { FacilityCategory } from "../types.js";

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactText(value: unknown): string {
  return normalizeText(value).replace(/[\s:：・()（）［］【】]/g, "");
}

export function inferCategory(value: string): FacilityCategory | null {
  const normalized = normalizeText(value).toLowerCase().replace(/\s+/g, "");
  const matches: FacilityCategory[] = [];
  if (/歯科|しか|shika|sika/.test(normalized)) {
    matches.push("dental");
  }
  if (
    /薬局|調剤|ちょうざい|yakkyoku|chouzai|chozai|pharmacy/.test(normalized)
  ) {
    matches.push("pharmacy");
  }
  if (/医科|いか|(?:^|[_\-.])ika(?:[_\-.]|$)|medical/.test(normalized)) {
    matches.push("medical");
  }
  return matches.length === 1 ? matches[0] ?? null : null;
}

export function normalizeDigits(value: unknown): string {
  return normalizeText(value).replace(/\D/g, "");
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ja"));
}
