# 医療機関施設基準 Static API

地方厚生（支）局が公開する「届出受理医療機関名簿」のExcel/ZIPを集約し、医療機関名または10桁の保険医療機関コードから施設基準を検索できる静的サイトとJSONを生成するNode.js + TypeScriptプロジェクトです。

## できること

- 全国8地域の公式掲載ページから最新のExcel/ZIPを自動検出
- 医科・歯科・薬局の7桁機関番号を10桁コードへ正規化
- 同一医療機関の施設基準、受理番号、算定開始日を集約
- 公式ファイルの基準日・URL・SHA-256を出力へ記録
- 住所を表示（電話番号は収録しない）
- 医療機関名の全国検索索引を生成
- GitHub Actionsで毎月15日に更新
- GitHub Pagesへ検索ページと静的JSONをデプロイ

## 必要環境

- Node.js 22以上
- npm

## セットアップ

```bash
npm ci
npm run check
npm test
npm run build
```

公式ページからリンクだけを確認する場合:

```bash
npm run discover
```

データを更新する場合:

```bash
npm run update
```

出力先はデフォルトで `public/v1` です。全国集計後の施設数が10万件未満の場合は、誤った空データを公開しないため処理を失敗させます。開発用フィクスチャなどで下限を変える場合は次のように指定できます。

```bash
npm run update -- --out public/v1 --min-facilities 1
```

## 静的APIの構造

Gitで数十万個のファイルを管理しないよう、コード先頭4桁ごとのJSONシャードにしています。

```text
public/
└── v1/
    ├── catalog.json
    ├── manifest.json
    ├── search.json
    └── facilities/
        ├── 0110.json
        ├── 1310.json
        └── 1810.json
```

`search.json` は `[医療機関コード, 医療機関名, 住所, 区分]` のタプルを収録した名称検索用索引です。検索ページは10桁コード検索ではこの大きな索引を取得せず、該当する施設シャードだけを取得します。名称検索を行ったときだけ索引を遅延取得します。

10桁コード `1810115202` の場合、取得先は次のとおりです。

```text
GET /v1/facilities/1810.json
```

レスポンス内の `facilities["1810115202"]` が対象施設です。配信量とGit差分を抑えるため、シャードはコンパクト形式です。

```json
{
  "schemaVersion": 1,
  "asOf": "2026-07-01",
  "prefix": "1810",
  "facilities": {
    "1810115202": {
      "name": "公益財団法人 福井県予防医学協会附属診療所",
      "address": "福井市和田2-1006",
      "category": "medical",
      "sourceIds": ["kinki"],
      "standards": [
        ["e5733452ef3df157", "第76号", "2002-04-01"]
      ]
    }
  }
}
```

`standards` の各要素は `[standardId, acceptanceNumber, effectiveFrom]` です。`standardId` の名称・略称は `/v1/catalog.json` に一度だけ収録されます。通常は次のTypeScriptクライアントを使えば、これらを結合した結果を取得できます。

## TypeScriptクライアント

10桁コードの検証、シャードの選択、カタログとの結合、キャッシュは `FacilityStandardsClient` が処理します。

```ts
import { FacilityStandardsClient } from "./src/client.js";

const client = new FacilityStandardsClient({
  baseUrl: "https://example.github.io/your-repository",
});

const facility = await client.get("1810115202");
console.log(facility?.standards);
```

戻り値には、医療機関コード、医科・歯科・薬局の区分、施設名・住所、施設基準の略称・名称・受理番号・算定開始日、基準日、取得元IDが含まれます。該当コードがない場合は `null` です。同じ先頭4桁のコードを続けて検索した場合、JSONシャードは再取得しません。

## GitHub Actions

### データ更新

`.github/workflows/update-data.yml` は毎月15日の09:00（日本時間）に実行されます。各厚生局が月初から10日頃に公開する月次データを待ってから取得する設定です。

1. 型チェックとテスト
2. 各厚生局から最新ファイルを取得
3. JSONを再生成
4. `public/v1` に差分がある場合だけコミット・push

手動実行も可能です。

### GitHub Pages

`.github/workflows/pages.yml` がTypeScript製の検索画面をビルドし、`public` ディレクトリをデプロイします。リポジトリの Settings → Pages → Source で `GitHub Actions` を選択してください。

## 取得元

- [北海道厚生局](https://kouseikyoku.mhlw.go.jp/hokkaido/gyomu/gyomu/hoken_kikan/todokede_juri_ichiran.html)
- [東北厚生局](https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/hoken_kikan/documents/201805koushin.html)
- [関東信越厚生局](https://kouseikyoku.mhlw.go.jp/kantoshinetsu/chousa/kijyun.html)
- [東海北陸厚生局](https://kouseikyoku.mhlw.go.jp/tokaihokuriku/newpage_00349.html)
- [近畿厚生局](https://kouseikyoku.mhlw.go.jp/kinki/gyomu/gyomu/hoken_kikan/shitei_jokyo_00004.html)
- [中国四国厚生局](https://kouseikyoku.mhlw.go.jp/chugokushikoku/chousaka/shisetsukijunjuri.html)
- [四国厚生支局](https://kouseikyoku.mhlw.go.jp/shikoku/gyomu/gyomu/hoken_kikan/shitei/)
- [九州厚生局](https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/index_00007.html)

## 安全策と制約

- ページ構造、Excel見出し、施設数が想定から外れた場合は更新を停止します。
- `.xlsx`、`.xlsm`、およびそれらを含むZIPに対応します。旧式の`.xls`が配布された場合は更新を停止します。
- `asOf` は公式ファイルの「○年○月○日現在」であり、リアルタイム情報ではありません。
- `generatedAt` は取得・JSON生成を実行した日時です。検索画面では両方を区別して表示します。
- 公開データを加工したものであり、診療上・請求上の最終確認には必ず各地方厚生（支）局の原資料を利用してください。
- 出典URLとファイルハッシュは `manifest.json` に保持し、各施設レコードは取得元IDを保持します。
- 電話番号はデータセット・検索索引・画面のいずれにも収録しません。

## ライセンスと出典

コードのライセンスは、利用形態に合わせてリポジトリ作成者が設定してください。検索画面には、各地方厚生（支）局の原資料へのリンク、加工して作成した旨、国による作成・保証・推奨ではない旨、および[厚生労働省「利用規約・リンク・著作権等」](https://www.mhlw.go.jp/chosakuken/index.html)へのリンクを表示します。
