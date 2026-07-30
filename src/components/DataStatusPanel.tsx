import { formatDate, formatDateTime, formatNumber } from "../lib/format";
import type { DataManifest } from "../lib/types";

export type ManifestLoadState = "loading" | "ready" | "error";

interface DataStatusPanelProps {
  manifest: DataManifest | null;
  state: ManifestLoadState;
}

const stateLabels: Record<ManifestLoadState, string> = {
  loading: "更新情報を読み込んでいます",
  ready: "読み込み済み",
  error: "データ未生成",
};

const stateClasses: Record<ManifestLoadState, string> = {
  loading: "load-state",
  ready: "load-state is-ready",
  error: "load-state is-error",
};

export function DataStatusPanel({ manifest, state }: DataStatusPanelProps) {
  return (
    <section className="data-panel" aria-labelledby="data-heading">
      <div className="section-heading">
        <div>
          <p className="section-kicker">DATA STATUS</p>
          <h2 id="data-heading">データの更新状況</h2>
        </div>
        <p className={stateClasses[state]} role="status">
          {stateLabels[state]}
        </p>
      </div>

      <dl className="status-grid">
        <div className="status-item">
          <dt>全体の基準日</dt>
          <dd>{manifest ? formatDate(manifest.asOf) : "—"}</dd>
        </div>
        <div className="status-item">
          <dt>取得・生成日時</dt>
          <dd>{manifest ? formatDateTime(manifest.generatedAt) : "—"}</dd>
        </div>
        <div className="status-item">
          <dt>収録施設</dt>
          <dd>{manifest ? `${formatNumber(manifest.facilityCount)}件` : "—"}</dd>
        </div>
        <div className="status-item">
          <dt>届出項目</dt>
          <dd>{manifest ? `${formatNumber(manifest.standardCount)}件` : "—"}</dd>
        </div>
      </dl>

      <details className="source-details" open>
        <summary>地域別の基準日と公式ソース</summary>
        <div className="source-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">公開元</th>
                <th scope="col">基準日</th>
                <th scope="col">収録施設</th>
                <th scope="col">原資料</th>
              </tr>
            </thead>
            <tbody>
              {state === "loading" && (
                <tr>
                  <td colSpan={4}>読み込み中です</td>
                </tr>
              )}
              {state === "error" && (
                <tr>
                  <td colSpan={4}>
                    公開データがまだ生成されていません。更新ワークフローの完了後に表示されます。
                  </td>
                </tr>
              )}
              {manifest?.sources.map((source) => (
                <tr key={source.id}>
                  <td>{source.bureauName}</td>
                  <td>{formatDate(source.asOf)}</td>
                  <td>{formatNumber(source.facilityCount)}</td>
                  <td>
                    <a href={source.pageUrl} target="_blank" rel="noreferrer">
                      公式ページ
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <aside className="credit" aria-labelledby="credit-heading">
        <h3 id="credit-heading">出典・利用上の注意</h3>
        <p>
          出典：地方厚生（支）局が公開する「施設基準の届出受理状況（全体）」
          （上記各公式ページ）。公開されたExcel・ZIPを本プロジェクトが加工して作成しています。
        </p>
        <p>
          本ページは厚生労働省および地方厚生（支）局が作成、保証または推奨するものではありません。
          データには公表・集約までの時間差があり得るため、請求や届出の最終確認には必ず原資料をご確認ください。
        </p>
        <a
          href="https://www.mhlw.go.jp/chosakuken/index.html"
          target="_blank"
          rel="noreferrer"
        >
          厚生労働省「利用規約・リンク・著作権等」
        </a>
      </aside>
    </section>
  );
}
