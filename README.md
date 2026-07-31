# 医療機関施設基準データセット

地方厚生（支）局が公開する「届出受理医療機関名簿」のExcel/ZIPと月内差分PDFを集約し、医療機関名または10桁の保険医療機関コードから施設基準を検索できる静的サイトとJSONを生成するプロジェクトです。

**診療・請求・届出可否などの最終判断において、本データを唯一の根拠にはしないでください。各レコードの原資料URLと更新基準日を確認し、`needs-review` の月内差分は未確定情報として扱ってください。**

## 構成

```text
.
├── index.html          # 検索ページのエントリ（Vite）
├── src/                # フロントエンド（Vite + React + TypeScript）
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/     # 画面コンポーネント
│   └── lib/            # データ検索ライブラリ（client.ts）と契約型
├── updater/            # データ取得ツール（Node.js ETL、tsxで実行）
│   ├── cli.ts
│   ├── discovery.ts    # 公式ページからの最新ファイル検出
│   ├── recent.ts       # 月内差分PDFの更新
│   ├── parser/         # Excel/PDF解析
│   └── output.ts       # public/v1 への静的JSON出力
└── public/
    └── v1/             # updaterの出力データ（Viteがそのまま配信）
```

## 必要環境

- Node.js 22以上
- npm

## セットアップ

```bash
npm ci
npm run check
npm test
npm run verify
```

月次名簿と月内差分を手動更新する場合:

```bash
npm run update
npm run update:recent
```

`update:recent` は `public/v1/manifest.json` に記録された各厚生（支）局の
基準日より後に掲載された
新規・変更および失効・辞退PDFだけを対象とし、`public/v1/changes` に
監査可能な差分レイヤーを生成します。検索クライアントは月次名簿へこの差分を
時系列順に適用します。各施設のJSONには、元のExcel/ZIPと差分PDFのURLも含まれます。

データ品質ゲートは、都道府県×区分の欠落、医療機関コードと区分の不整合、
施設属性への列ずれ、受理番号・算定開始日の欠損、前回比5%を超える急減、
原資料SHA-256の欠損を検出すると更新を停止します。画像PDFは自動OCR結果を公開せず、
原資料のSHA-256に固定した目視確認済み転記だけを取り込みます。略称だけでは一意に
特定できない失効などは `reviewStatus: "needs-review"` として隔離され、検索結果へ
自動適用されません。

GitHub Actionsでは、月次名簿を毎月15日に更新し、月内差分を
毎月2・9・16・23・28日の11:00（日本時間）に確認します。更新結果はmainへ
直接pushせず、原資料ハッシュ・件数・品質状態をレビューするためのドラフトPRを作成します。

### 月内差分の品質状態

- `automatic`: テキストPDFから抽出し、月次名簿または基準台帳へ一意に対応付け済み
- `manual-reviewed`: SHA-256固定の画像PDFを目視転記・確認済み
- `needs-review`: 曖昧さまたは必須値欠損があり、自動適用対象外

`public/v1/changes/manifest.json` の `quality` には、未解決イベント数、保持した文書数、
理由別の未解決件数、目視確認済み画像PDF数を記録します。医療機関向けプロダクトでは、取り込み時に
この状態を監視し、`needs-review` を利用者へ明示してください。

検索ページの開発サーバーを起動する場合:

```bash
npm run dev
```


## ライセンスと出典

### コード

MIT License（`LICENSE` を参照）。`src/` と `updater/` のソースコードに適用されます。

### データ（public/v1 および配信される静的JSON）

本データは、地方厚生（支）局が公開する「届出受理医療機関名簿」（厚生労働省）を
加工して作成したものです。データそのものに独自のライセンスは設定していません。
利用にあたっては、原資料である厚生労働省ホームページの
[利用規約・リンク・著作権等](https://www.mhlw.go.jp/chosakuken/index.html)
（公共データ利用規約 第1.0版 準拠）に従ってください。
