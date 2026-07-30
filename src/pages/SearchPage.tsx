import { Link, useQueryParams, useRouter } from "neouter";
import { useEffect, useState, type FormEvent } from "react";
import { extractMedicalInstitutionCode } from "../lib/client";
import { facilityClient } from "../lib/facilityClient";
import { formatNumber } from "../lib/format";
import { categoryLabels } from "../lib/labels";
import { facilityHref, searchHref } from "../lib/routes";
import type { FacilitySearchTuple } from "../lib/types";

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
          className="bg-accent px-6 py-2 text-base text-white"
        >
          検索
        </button>
      </form>

      <div aria-live="polite" className="mt-6">
        {state.kind === "loading" && (
          <p className="text-sm text-slate-500">検索中</p>
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
