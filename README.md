# 医療機関施設基準データセット

地方厚生（支）局が公開する「届出受理医療機関名簿」のExcel/ZIPを集約し、医療機関名または10桁の保険医療機関コードから施設基準を検索できる静的サイトとJSONを生成するプロジェクトです。

**現在ベータ版です。データの正確性・完全性は保証しません。データ利用時は、必ず併せて出典元を確認するようにしてください。**

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
│   ├── parser/         # Excel解析
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
```

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
