import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import { useManifest } from "../lib/useManifest";

export function UpdatesPage() {
  const state = useManifest();

  if (state.status !== "ready") {
    return (
      <>
        <title>データ更新日時 - 医療機関 施設基準検索</title>
        <p className="text-sm text-slate-500">
          {state.status === "loading" ? "読み込み中" : "データを取得できません。"}
        </p>
      </>
    );
  }

  const { manifest } = state;

  return (
    <>
      <title>データ更新日時 - 医療機関 施設基準検索</title>

      <h1 className="text-xl font-bold">データ更新日時</h1>

      <dl className="mt-4 border-t border-slate-200 text-sm">
        <div className="flex gap-4 border-b border-slate-200 px-1 py-1.5">
          <dt className="w-32 shrink-0 text-slate-500">最終取得日時</dt>
          <dd>{formatDateTime(manifest.generatedAt)}</dd>
        </div>
        <div className="flex gap-4 border-b border-slate-200 px-1 py-1.5">
          <dt className="w-32 shrink-0 text-slate-500">収録医療機関数</dt>
          <dd>{formatNumber(manifest.facilityCount)}件</dd>
        </div>
        <div className="flex gap-4 border-b border-slate-200 px-1 py-1.5">
          <dt className="w-32 shrink-0 text-slate-500">収録施設基準数</dt>
          <dd>{formatNumber(manifest.standardCount)}件</dd>
        </div>
      </dl>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-2 py-1.5 font-medium">地方厚生（支）局</th>
              <th className="px-2 py-1.5 font-medium">基準日</th>
              <th className="px-2 py-1.5 font-medium">施設数</th>
              <th className="px-2 py-1.5 font-medium">取得元URL</th>
            </tr>
          </thead>
          <tbody>
            {manifest.sources.map((source) => (
              <tr key={source.id} className="border-b border-slate-200">
                <td className="px-2 py-1.5 align-top whitespace-nowrap">
                  {source.bureauName}
                </td>
                <td className="px-2 py-1.5 align-top whitespace-nowrap">
                  {formatDate(source.asOf)}
                </td>
                <td className="px-2 py-1.5 align-top whitespace-nowrap">
                  {formatNumber(source.facilityCount)}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <ul className="space-y-1">
                    <li>
                      <a
                        href={source.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent text-xs break-all hover:underline"
                      >
                        {source.pageUrl}
                      </a>
                    </li>
                    {source.documents.map((document) => (
                      <li key={document.url}>
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent text-xs break-all hover:underline"
                        >
                          {document.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
