import { Link, normalizePathname, useRouter } from "neouter";
import { useEffect, type ReactNode } from "react";
import { searchHref, updatesHref, updatesPattern } from "../lib/routes";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useRouter();
  const pathname = normalizePathname(location);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const isUpdates = pathname === normalizePathname(updatesPattern);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-300">
        <div className="mx-auto flex max-w-3xl flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
          <Link href={searchHref()} className="text-base font-bold">
            医療機関 施設基準検索
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href={searchHref()} className={navClass(!isUpdates)}>
              検索
            </Link>
            <Link href={updatesHref} className={navClass(isUpdates)}>
              データ更新日時
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>

      <footer className="border-t border-slate-300">
        <p className="mx-auto max-w-3xl px-4 py-4 text-xs leading-relaxed text-slate-500">
          本サイトは地方厚生（支）局が公開する届出受理医療機関名簿を機械的に変換した非公式の参考情報です。内容の正確性・完全性は保証しません。正式な情報は各厚生局の公開資料をご確認ください。
        </p>
      </footer>
    </div>
  );
}

function navClass(isActive: boolean): string {
  return isActive ? "text-accent" : "text-slate-600 hover:text-slate-900";
}
