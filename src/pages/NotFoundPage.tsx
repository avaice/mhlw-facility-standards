import { Link } from "neouter";
import { searchHref } from "../lib/routes";

export function NotFoundPage() {
  return (
    <>
      <title>医療機関 施設基準検索</title>
      <p className="text-sm text-slate-500">ページが見つかりません。</p>
      <p className="mt-4 text-sm">
        <Link href={searchHref()} className="text-accent hover:underline">
          検索に戻る
        </Link>
      </p>
    </>
  );
}
