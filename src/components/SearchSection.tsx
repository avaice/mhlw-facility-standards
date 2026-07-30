import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  extractMedicalInstitutionCode,
  type FacilityStandardsClient,
} from "../lib/client";
import { formatNumber } from "../lib/format";
import type {
  FacilityLookupResult,
  FacilitySearchTuple,
  SourceManifestEntry,
} from "../lib/types";
import { FacilityDetail } from "./FacilityDetail";
import { ResultCard } from "./ResultCard";

const RESULT_LIMIT = 50;

type SearchView =
  | { kind: "idle" }
  | { kind: "names"; matches: FacilitySearchTuple[] }
  | { kind: "facility"; facility: FacilityLookupResult }
  | { kind: "empty"; message: string }
  | { kind: "error"; message: string };

interface SearchSectionProps {
  client: FacilityStandardsClient;
  sources: SourceManifestEntry[];
}

export function SearchSection({ client, sources }: SearchSectionProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<SearchView>({ kind: "idle" });
  const [status, setStatus] = useState(
    "医療機関名またはコードを入力してください。",
  );
  const [busy, setBusy] = useState(false);
  const initialised = useRef(false);

  async function showFacility(code: string): Promise<void> {
    setStatus("施設基準を読み込んでいます…");
    try {
      const facility = await client.get(code);
      if (!facility) {
        setView({
          kind: "empty",
          message:
            "一致する医療機関が見つかりませんでした。基準日以降の新規届出は原資料もご確認ください。",
        });
        setStatus(`医療機関コード ${code} に一致する施設はありません。`);
        return;
      }
      setView({ kind: "facility", facility });
      setStatus(`${facility.facility.name}の施設基準を表示しています。`);
    } catch (error) {
      console.error(error);
      setView({
        kind: "error",
        message:
          "施設基準データを取得できませんでした。時間をおいて再度お試しください。",
      });
      setStatus("検索できませんでした。");
    }
  }

  async function searchByName(rawQuery: string): Promise<void> {
    setStatus("全国の名称検索索引を読み込んでいます…");
    try {
      const result = await client.searchByName(rawQuery, {
        limit: RESULT_LIMIT,
      });
      if (result.totalMatchCount === 0) {
        setView({
          kind: "empty",
          message: "一致する医療機関が見つかりませんでした。",
        });
        setStatus(`「${rawQuery}」に一致する施設はありません。`);
        return;
      }
      setView({ kind: "names", matches: result.matches });
      const suffix =
        result.totalMatchCount > RESULT_LIMIT
          ? `（先頭${RESULT_LIMIT}件を表示）`
          : "";
      setStatus(
        `「${rawQuery}」に一致する施設は${formatNumber(result.totalMatchCount)}件です${suffix}。`,
      );
    } catch (error) {
      console.error(error);
      setView({
        kind: "error",
        message:
          "名称検索索引を取得できませんでした。データ更新後に再度お試しください。",
      });
      setStatus("検索できませんでした。");
    }
  }

  async function runSearch(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setView({ kind: "idle" });
      setStatus("医療機関名またはコードを入力してください。");
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("q", trimmed);
    window.history.replaceState(null, "", url);

    setBusy(true);
    try {
      const code = extractMedicalInstitutionCode(trimmed);
      if (code) {
        await showFacility(code);
      } else {
        await searchByName(trimmed);
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialised.current) {
      return;
    }
    initialised.current = true;
    const initialQuery = new URL(window.location.href).searchParams.get("q");
    if (initialQuery) {
      setQuery(initialQuery);
      void runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runSearch(query);
  }

  return (
    <section className="search-section" aria-labelledby="search-heading">
      <div className="search-copy">
        <p className="section-kicker">SEARCH</p>
        <h2 id="search-heading">施設を検索</h2>
        <p>
          コード検索は該当データだけを取得します。名称検索では初回のみ全国の検索索引を読み込みます。
        </p>
      </div>

      <form className="search-form" role="search" onSubmit={handleSubmit}>
        <label htmlFor="search-input">医療機関名・医療機関コード</label>
        <div className="search-control">
          <input
            id="search-input"
            name="q"
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="例：さくら診療所 / 1310123456"
            aria-describedby="search-hint"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={busy}>
            検索する
          </button>
        </div>
        <p id="search-hint" className="hint">
          医療機関コードは都道府県番号2桁＋点数表番号1桁＋機関コード7桁の10桁です。
        </p>
      </form>

      <p className="search-state" role="status" aria-live="polite">
        {status}
      </p>
      <div className="results" aria-live="polite">
        {view.kind === "names" &&
          view.matches.map((tuple) => (
            <ResultCard
              key={tuple[0]}
              tuple={tuple}
              onSelect={(code) => void showFacility(code)}
            />
          ))}
        {view.kind === "facility" && (
          <FacilityDetail facility={view.facility} sources={sources} />
        )}
        {view.kind === "empty" && (
          <div className="empty-state">{view.message}</div>
        )}
        {view.kind === "error" && (
          <div className="error-state">{view.message}</div>
        )}
      </div>
    </section>
  );
}
