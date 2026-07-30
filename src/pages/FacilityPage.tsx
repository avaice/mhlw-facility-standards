import { Link, usePathParams } from "neouter";
import { useEffect, useState, type ReactNode } from "react";
import { facilityClient } from "../lib/facilityClient";
import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { categoryLabels } from "../lib/labels";
import { facilityPattern, searchHref } from "../lib/routes";
import { useManifest } from "../lib/useManifest";
import type { FacilityLookupResult, SourceManifestEntry } from "../lib/types";

type FacilityState =
  | { kind: "loading" }
  | { kind: "ready"; facility: FacilityLookupResult }
  | { kind: "message"; message: string };

export function FacilityPage() {
  const code = usePathParams(facilityPattern)?.code ?? "";
  const [state, setState] = useState<FacilityState>({ kind: "loading" });
  const manifestState = useManifest();

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    facilityClient.get(code).then(
      (facility) => {
        if (cancelled) {
          return;
        }
        setState(
          facility
            ? { kind: "ready", facility }
            : { kind: "message", message: "該当する医療機関はありません。" },
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
  }, [code]);

  if (state.kind !== "ready") {
    return (
      <>
        <title>医療機関 施設基準検索</title>
        <p className="text-sm text-slate-500">
          {state.kind === "loading" ? "読み込み中" : state.message}
        </p>
        <p className="mt-4 text-sm">
          <Link href={searchHref()} className="text-accent hover:underline">
            検索に戻る
          </Link>
        </p>
      </>
    );
  }

  const { facility } = state;
  const manifest =
    manifestState.status === "ready" ? manifestState.manifest : null;
  const sources = (manifest?.sources ?? []).filter((source) =>
    facility.sourceIds.includes(source.id),
  );
  const standards = [...facility.standards].sort((a, b) =>
    (a.name ?? a.abbreviation ?? "").localeCompare(
      b.name ?? b.abbreviation ?? "",
      "ja",
    ),
  );

  return (
    <>
      <title>{`${facility.facility.name} - 医療機関 施設基準検索`}</title>

      <p className="text-sm">
        <Link href={searchHref()} className="text-accent hover:underline">
          検索に戻る
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-bold">{facility.facility.name}</h1>

      <dl className="mt-4 border-t border-slate-200 text-sm">
        <MetaRow label="医療機関コード">
          <span className="font-mono">{facility.medicalInstitutionCode}</span>
        </MetaRow>
        <MetaRow label="区分">{categoryLabels[facility.category]}</MetaRow>
        <MetaRow label="所在地">{facility.facility.address ?? "—"}</MetaRow>
        <MetaRow label="データ基準日">{formatDate(facility.asOf)}</MetaRow>
        <MetaRow label="データ取得日時">
          {manifest ? formatDateTime(manifest.generatedAt) : "—"}
        </MetaRow>
        <MetaRow label="出典">
          {sources.length === 0 ? (
            "—"
          ) : (
            <ul className="space-y-1">
              {sources.map((source) => (
                <li key={source.id}>
                  <SourceLink source={source} />
                </li>
              ))}
            </ul>
          )}
        </MetaRow>
      </dl>

      <h2 className="mt-8 text-base font-bold">
        施設基準
        <span className="ml-2 text-sm font-normal text-slate-500">
          {formatNumber(standards.length)}件
        </span>
      </h2>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-2 py-1.5 font-medium">略称</th>
              <th className="px-2 py-1.5 font-medium">施設基準</th>
              <th className="px-2 py-1.5 font-medium">受理番号</th>
              <th className="px-2 py-1.5 font-medium">算定開始年月日</th>
            </tr>
          </thead>
          <tbody>
            {standards.map((standard, index) => (
              <tr
                key={`${standard.acceptanceNumber}-${index}`}
                className="border-b border-slate-200"
              >
                <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">
                  {standard.abbreviation ?? "—"}
                </td>
                <td className="px-2 py-1.5">
                  {standard.name ?? standard.abbreviation ?? "—"}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {standard.acceptanceNumber}
                </td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {standard.effectiveFrom
                    ? formatDate(standard.effectiveFrom)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-slate-200 px-1 py-1.5">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 wrap-break-word">{children}</dd>
    </div>
  );
}

function SourceLink({ source }: { source: SourceManifestEntry }) {
  return (
    <>
      <a
        href={source.pageUrl}
        target="_blank"
        rel="noreferrer"
        className="text-accent break-all hover:underline"
      >
        {source.bureauName}
      </a>
      <span className="ml-2 text-slate-500">
        基準日 {formatDate(source.asOf)}
      </span>
    </>
  );
}
