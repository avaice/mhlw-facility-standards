import type { RecentSourceDefinition } from "../types.js";

function source(
  sourceId: string,
  bureauName: string,
  pageUrl: string,
  prefectureCodeHint: string | null = null,
  options: Pick<
    RecentSourceDefinition,
    "documentUrlPattern" | "documentContextPattern"
  > = {},
): RecentSourceDefinition {
  return {
    sourceId,
    bureauName,
    pageUrl,
    prefectureCodeHint,
    ...options,
  };
}

export const RECENT_SOURCES: RecentSourceDefinition[] = [
  source(
    "hokkaido",
    "北海道厚生局",
    "https://kouseikyoku.mhlw.go.jp/hokkaido/iryo_shido/shisetsukijyun_jyuri_iryoukikan.html",
    "01",
  ),
  source(
    "tohoku",
    "東北厚生局",
    "https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/hoken_kikan/kijun_jurijoukyou.html",
    null,
    {
      documentUrlPattern:
        /\/(?:shinki|jitai)_[^/]+_(?:ika|shika|yakkyoku)_\d{8}\.pdf$/iu,
    },
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/ibaraki/kijun.html",
    "08",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/tochigi/kijun.html",
    "09",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/gunma/kijun.html",
    "10",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/shido_kansa/kijun.html",
    "11",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/chiba/kijun.html",
    "12",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/tokyo/kijun.html",
    "13",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/kanagawa/kijun.html",
    "14",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/niigata/kijun.html",
    "15",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/yamanashi/kijun.html",
    "19",
  ),
  source(
    "kanto-shinetsu",
    "関東信越厚生局",
    "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/gyomu/bu_ka/nagano/kijun.html",
    "20",
  ),
  source(
    "tokai-hokuriku",
    "東海北陸厚生局",
    "https://kouseikyoku.mhlw.go.jp/tokaihokuriku/newpage_00843.html",
    null,
    {
      documentUrlPattern:
        /-\d{2}-\d{2}-(?:01|03|04)(?:_\d+)?\.pdf$/iu,
    },
  ),
  source(
    "kinki",
    "近畿厚生局",
    "https://kouseikyoku.mhlw.go.jp/kinki/gyomu/gyomu/hoken_kikan/kijun_jurijoukyou.html",
    null,
    {
      documentUrlPattern:
        /todokede(?:juri|sikkou)_[^/]+_(?:ika|sika|yakkyoku)\.pdf$/iu,
    },
  ),
  source(
    "chugoku",
    "中国四国厚生局",
    "https://kouseikyoku.mhlw.go.jp/chugokushikoku/chousaka/kijunjuriichiran_shinkihenkou_shikkou_00001.html",
    null,
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "shikoku",
    "四国厚生支局",
    "https://kouseikyoku.mhlw.go.jp/shikoku/gyomu/gyomu/hoken_kikan/shitei/index_00005.html",
    null,
    {
      documentUrlPattern:
        /\/\d{2}_(?:01|03|04)_01_\d{6}\.pdf$/iu,
    },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_fukuoka.html",
    "40",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_saga.html",
    "41",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_nagasaki.html",
    "42",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_kumamoto.html",
    "43",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_ooita.html",
    "44",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_miyazaki.html",
    "45",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_kagoshima.html",
    "46",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
  source(
    "kyushu",
    "九州厚生局",
    "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/juri_okinawa.html",
    "47",
    { documentContextPattern: /新規・変更|失効|辞退/u },
  ),
];
