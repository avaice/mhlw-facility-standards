import type { Path, Routes } from "neouter";
import { FacilityPage } from "../pages/FacilityPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { SearchPage } from "../pages/SearchPage";
import { UpdatesPage } from "../pages/UpdatesPage";

export type PathPatterns = "/" | "/facility/:code" | "/updates";

declare module "neouter" {
  interface Register {
    pathPatterns: PathPatterns;
  }
}

// GitHub Pagesのサブパス配信に対応するため、実行時のパスにはViteのbaseを前置する。
// 型はbaseなしのパターンとして扱い、neouterのパス・パラメータ型支援を維持する。
const base = import.meta.env.BASE_URL.replace(/\/+$/u, "");

// neouterは末尾スラッシュを落として照合するため、ルートのパターンはbase自体になる
function withBase<T extends PathPatterns>(pattern: T): T {
  return (pattern === "/" ? base || "/" : `${base}${pattern}`) as T;
}

const searchPath = base ? `${base}/` : "/";

export const searchPattern = withBase("/");
export const facilityPattern = withBase("/facility/:code");
export const updatesPattern = withBase("/updates");

export const routes: Routes = {
  [searchPattern]: { component: SearchPage },
  [facilityPattern]: { component: FacilityPage },
  [updatesPattern]: { component: UpdatesPage },
};

export const notFoundComponent = NotFoundPage;

export function searchHref(query = ""): Path {
  return (
    query ? `${searchPath}?q=${encodeURIComponent(query)}` : searchPath
  ) as Path;
}

export function facilityHref(medicalInstitutionCode: string): Path {
  return `${base}/facility/${medicalInstitutionCode}` as Path;
}

export const updatesHref = updatesPattern as Path;
