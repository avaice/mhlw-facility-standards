import { Link, useQueryParams, useRouter } from "neouter";
import { useEffect, useState, type FormEvent } from "react";
import { extractMedicalInstitutionCode } from "../lib/client";
import { facilityClient } from "../lib/facilityClient";
import { formatNumber } from "../lib/format";
import { categoryLabels } from "../lib/labels";
import { facilityHref, searchHref } from "../lib/routes";
import type { FacilitySearchTuple } from "../lib/types";
import { Loader2, Search } from "lucide-react";

const RESULT_LIMIT = 50;
const QUERY_PARAMS = { q: "string" } as const;

type ResultState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "matches"; matches: FacilitySearchTuple[]; total: number }
  | { kind: "message"; message: string };

export function SearchPage() {
  const query = useQueryParams(QUERY_PARAMS).q?.trim() ?? "";
  const [, setLocation] = useRouter();
  const [input, setInput] = useState(query);
  const [state, setState] = useState<ResultState>({ kind: "idle" });

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!query) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });
    facilityClient.searchByName(query, { limit: RESULT_LIMIT }).then(
      (result) => {
        if (cancelled) {
          return;
        }
        setState(
          result.totalMatchCount === 0
            ? { kind: "message", message: "該当する医療機関はありません。" }
            : {
                kind: "matches",
                matches: result.matches,
                total: result.totalMatchCount,
              },
        );
      },
      (error: unknown) => {
        console.error(error);
        if (!cancelled) {
          setState({ kind: "message", message: "データを取得できません。" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [query]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = input.trim();
    const code = extractMedicalInstitutionCode(trimmed);
    setLocation(code ? facilityHref(code) : searchHref(trimmed));
  }

  return (
    <>
      <title>医療機関 施設基準検索</title>

      <p className="text-sm leading-relaxed">
        地方厚生（支）局が公開する届出受理医療機関名簿から、医療機関ごとに届け出られた施設基準を検索できます。医療機関名または10桁の医療機関コードで検索してください。
      </p>
      <p className="mt-2 mb-6 text-xs leading-relaxed text-slate-500">
        本サイトは内容の地方厚生（支）局が公開する届出受理医療機関名簿を加工して作成したデータを元にしています。正確性・完全性は保証しません。届出状況は基準日以降に変更される場合があるため、正式な情報は各厚生局の公開資料をご確認ください。
      </p>

      <form role="search" onSubmit={handleSubmit} className="flex">
        <input
          type="search"
          name="q"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="医療機関名または医療機関コード"
          placeholder="医療機関名 または 医療機関コード（10桁）"
          autoComplete="off"
          className="min-w-0 flex-1 border border-r-0 border-slate-400 px-3 py-2 text-base"
        />
        <button
          type="submit"
          className="bg-accent hover:bg-accent-dark active:opacity-90 px-6 py-2 text-base text-white"
        >
          <span className="flex items-center gap-1">
            <Search className="size-3" />
            検索
          </span>
        </button>
      </form>

      <div aria-live="polite" className="mt-6">
        {state.kind === "loading" && (
          <Loader2 className="size-4 text-slate-500 animate-spin" />
        )}

        {state.kind === "message" && (
          <p className="text-sm text-slate-500">{state.message}</p>
        )}

        {state.kind === "matches" && (
          <>
            <p className="text-sm text-slate-500">
              {formatNumber(state.total)}件
              {state.total > RESULT_LIMIT && `（上位${RESULT_LIMIT}件）`}
            </p>
            <ul className="mt-2 border-t border-slate-200">
              {state.matches.map(([code, name, address, category]) => (
                <li key={code} className="border-b border-slate-200">
                  <Link
                    href={facilityHref(code)}
                    className="flex items-baseline gap-3 px-1 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="hidden w-2/5 shrink-0 truncate text-xs text-slate-500 sm:block">
                      {address ?? ""}
                    </span>
                    <span className="w-8 shrink-0 text-xs text-slate-500">
                      {categoryLabels[category]}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-slate-500">
                      {code}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
