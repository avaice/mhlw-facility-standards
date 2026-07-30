import type { SourceDefinition } from "../types.js";

const TARGET_SECTION =
  /届出受理医療機関名簿|施設基準.*届出(?:受理)?状況.*全体|施設基準等の届出事項/u;

const EXCLUDED_SECTION =
  /保険外|届出項目別|主な届出|訪問看護|指定一覧|コード内容別|新規指定|廃止|辞退/u;

export const SOURCES: SourceDefinition[] = [
  {
    id: "hokkaido",
    bureauName: "北海道厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/hokkaido/gyomu/gyomu/hoken_kikan/todokede_juri_ichiran.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "tohoku",
    bureauName: "東北厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/hoken_kikan/documents/201805koushin.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "kanto-shinetsu",
    bureauName: "関東信越厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/kantoshinetsu/chousa/kijyun.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "tokai-hokuriku",
    bureauName: "東海北陸厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/tokaihokuriku/newpage_00349.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "kinki",
    bureauName: "近畿厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/kinki/gyomu/gyomu/hoken_kikan/shitei_jokyo_00004.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "chugoku",
    bureauName: "中国四国厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/chugokushikoku/chousaka/shisetsukijunjuri.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "shikoku",
    bureauName: "四国厚生支局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/shikoku/gyomu/gyomu/hoken_kikan/shitei/",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
  {
    id: "kyushu",
    bureauName: "九州厚生局",
    pageUrl:
      "https://kouseikyoku.mhlw.go.jp/kyushu/gyomu/gyomu/hoken_kikan/index_00007.html",
    targetSection: TARGET_SECTION,
    excludedSection: EXCLUDED_SECTION,
  },
];
