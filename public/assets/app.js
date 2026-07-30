"use strict";
const DATA_ROOT = "./v1";
const RESULT_LIMIT = 50;
const categoryLabels = {
    medical: "医科",
    dental: "歯科",
    pharmacy: "薬局",
};
let manifest = null;
let searchIndexPromise = null;
let catalogPromise = null;
const shardPromises = new Map();
function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`画面要素が見つかりません: ${id}`);
    }
    return element;
}
function normalizeSearchText(value) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("ja")
        .replace(/[\s\u3000・･\-ー―‐()（）［\]\[\]]/gu, "");
}
function normalizeCode(value) {
    return value.normalize("NFKC").replace(/\D/gu, "");
}
function isValidMedicalInstitutionCode(value) {
    return /^\d{2}[134]\d{7}$/u.test(value);
}
function formatDate(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(`${value}T00:00:00+09:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "long",
        timeZone: "Asia/Tokyo",
    }).format(date);
}
function formatDateTime(value) {
    if (!value) {
        return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Tokyo",
    }).format(date);
}
function formatNumber(value) {
    return new Intl.NumberFormat("ja-JP").format(value);
}
function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}
async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`${url} の取得に失敗しました（${response.status}）`);
    }
    return (await response.json());
}
function renderSources(sources) {
    const body = requiredElement("source-list");
    body.replaceChildren();
    for (const source of sources) {
        const row = document.createElement("tr");
        const bureau = element("td", undefined, source.bureauName);
        const asOf = element("td", undefined, formatDate(source.asOf));
        const count = element("td", undefined, formatNumber(source.facilityCount));
        const linkCell = document.createElement("td");
        const link = element("a", undefined, "公式ページ");
        link.href = source.pageUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        linkCell.append(link);
        row.append(bureau, asOf, count, linkCell);
        body.append(row);
    }
}
async function loadMetadata() {
    const state = requiredElement("metadata-state");
    try {
        manifest = await fetchJson(`${DATA_ROOT}/manifest.json`);
        requiredElement("overall-as-of").textContent = formatDate(manifest.asOf);
        requiredElement("generated-at").textContent = formatDateTime(manifest.generatedAt);
        requiredElement("facility-count").textContent =
            `${formatNumber(manifest.facilityCount)}件`;
        requiredElement("standard-count").textContent =
            `${formatNumber(manifest.standardCount)}件`;
        renderSources(manifest.sources);
        state.textContent = "読み込み済み";
        state.classList.add("is-ready");
    }
    catch (error) {
        state.textContent = "データ未生成";
        state.classList.add("is-error");
        const body = requiredElement("source-list");
        body.replaceChildren();
        const row = document.createElement("tr");
        const cell = element("td", undefined, "公開データがまだ生成されていません。更新ワークフローの完了後に表示されます。");
        cell.colSpan = 4;
        row.append(cell);
        body.append(row);
        console.error(error);
    }
}
function loadSearchIndex() {
    if (!searchIndexPromise) {
        searchIndexPromise = fetchJson(`${DATA_ROOT}/search.json`);
        searchIndexPromise.catch(() => {
            searchIndexPromise = null;
        });
    }
    return searchIndexPromise;
}
function loadCatalog() {
    if (!catalogPromise) {
        catalogPromise = fetchJson(`${DATA_ROOT}/catalog.json`);
        catalogPromise.catch(() => {
            catalogPromise = null;
        });
    }
    return catalogPromise;
}
function loadShard(code) {
    const prefix = code.slice(0, 4);
    const existing = shardPromises.get(prefix);
    if (existing) {
        return existing;
    }
    const request = fetchJson(`${DATA_ROOT}/facilities/${prefix}.json`);
    shardPromises.set(prefix, request);
    request.catch(() => shardPromises.delete(prefix));
    return request;
}
function setSearchState(message) {
    requiredElement("search-state").textContent = message;
}
function clearResults() {
    const results = requiredElement("results");
    results.replaceChildren();
    return results;
}
function showError(message) {
    const results = clearResults();
    results.append(element("div", "error-state", message));
    setSearchState("検索できませんでした。");
}
function sourceLinks(sourceIds) {
    const list = element("ul", "source-links");
    for (const sourceId of sourceIds) {
        const source = manifest?.sources.find((item) => item.id === sourceId);
        if (!source) {
            continue;
        }
        const item = document.createElement("li");
        const link = element("a", undefined, `${source.bureauName}の原資料`);
        link.href = source.pageUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        item.append(link);
        list.append(item);
    }
    return list;
}
async function showFacility(code) {
    const results = clearResults();
    setSearchState("施設基準を読み込んでいます…");
    try {
        const [shard, catalog] = await Promise.all([
            loadShard(code),
            loadCatalog(),
        ]);
        const facility = shard.facilities[code];
        if (!facility) {
            results.append(element("div", "empty-state", "一致する医療機関が見つかりませんでした。基準日以降の新規届出は原資料もご確認ください。"));
            setSearchState(`医療機関コード ${code} に一致する施設はありません。`);
            return;
        }
        const article = element("article", "facility-detail");
        const head = element("div", "facility-head");
        const titleGroup = document.createElement("div");
        const badge = element("span", "category-badge", categoryLabels[facility.category]);
        const title = element("h3", undefined, facility.name);
        const meta = element("p", "facility-meta");
        meta.append(document.createTextNode(`医療機関コード ${code}`), document.createTextNode(facility.address ?? "住所情報なし"), document.createTextNode(`基準日 ${formatDate(shard.asOf)}`));
        titleGroup.append(badge, title, meta);
        head.append(titleGroup);
        article.append(head);
        const heading = element("h4", undefined, `届出受理済みの施設基準（${formatNumber(facility.standards.length)}件）`);
        article.append(heading);
        if (facility.standards.length === 0) {
            article.append(element("p", "empty-state", "収録された施設基準はありません。"));
        }
        else {
            const list = element("ul", "standard-list");
            for (const [standardId, acceptanceNumber, effectiveFrom] of facility.standards) {
                const definition = catalog.standards[standardId];
                const item = document.createElement("li");
                const copy = document.createElement("div");
                copy.append(element("div", "standard-name", definition?.name ?? definition?.abbreviation ?? "名称未収録"));
                if (definition?.abbreviation) {
                    copy.append(element("div", "standard-abbr", `略称：${definition.abbreviation}`));
                }
                const dates = document.createElement("div");
                dates.append(element("div", undefined, `受理番号：${acceptanceNumber}`), element("div", "standard-date", effectiveFrom
                    ? `算定開始：${formatDate(effectiveFrom)}`
                    : "算定開始：記載なし"));
                item.append(copy, dates);
                list.append(item);
            }
            article.append(list);
        }
        if (facility.sourceIds.length > 0) {
            article.append(element("h4", undefined, "この施設の取得元"));
            article.append(sourceLinks(facility.sourceIds));
        }
        results.append(article);
        setSearchState(`${facility.name}の施設基準を表示しています。`);
        article.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    catch (error) {
        console.error(error);
        showError("施設基準データを取得できませんでした。時間をおいて再度お試しください。");
    }
}
function resultCard(tuple) {
    const [code, name, address, category] = tuple;
    const card = element("article", "result-card");
    const copy = document.createElement("div");
    const badge = element("span", "category-badge", categoryLabels[category]);
    const title = element("h3", undefined, name);
    const meta = element("p", "result-meta");
    meta.append(document.createTextNode(`医療機関コード ${code}`), document.createTextNode(address ?? "住所情報なし"));
    copy.append(badge, title, meta);
    const button = element("button", "result-button", "施設基準を見る");
    button.type = "button";
    button.addEventListener("click", () => {
        void showFacility(code);
    });
    card.append(copy, button);
    return card;
}
async function searchByName(query) {
    const results = clearResults();
    const normalized = normalizeSearchText(query);
    if (!normalized) {
        setSearchState("検索語を入力してください。");
        return;
    }
    setSearchState("全国の名称検索索引を読み込んでいます…");
    try {
        const index = await loadSearchIndex();
        await new Promise((resolve) => {
            window.requestAnimationFrame(() => resolve());
        });
        const matches = index.facilities
            .filter(([, name]) => normalizeSearchText(name).includes(normalized))
            .sort((a, b) => {
            const aStarts = normalizeSearchText(a[1]).startsWith(normalized);
            const bStarts = normalizeSearchText(b[1]).startsWith(normalized);
            if (aStarts !== bStarts) {
                return aStarts ? -1 : 1;
            }
            return a[1].localeCompare(b[1], "ja");
        });
        if (matches.length === 0) {
            results.append(element("div", "empty-state", "一致する医療機関が見つかりませんでした。"));
            setSearchState(`「${query}」に一致する施設はありません。`);
            return;
        }
        const shown = matches.slice(0, RESULT_LIMIT);
        for (const tuple of shown) {
            results.append(resultCard(tuple));
        }
        const suffix = matches.length > RESULT_LIMIT
            ? `（先頭${RESULT_LIMIT}件を表示）`
            : "";
        setSearchState(`「${query}」に一致する施設は${formatNumber(matches.length)}件です${suffix}。`);
    }
    catch (error) {
        console.error(error);
        showError("名称検索索引を取得できませんでした。データ更新後に再度お試しください。");
    }
}
async function runSearch(rawQuery) {
    const query = rawQuery.trim();
    if (!query) {
        clearResults();
        setSearchState("医療機関名またはコードを入力してください。");
        return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("q", query);
    window.history.replaceState(null, "", url);
    const code = normalizeCode(query);
    if (isValidMedicalInstitutionCode(code)) {
        await showFacility(code);
        return;
    }
    await searchByName(query);
}
async function initialise() {
    const form = requiredElement("search-form");
    const input = requiredElement("search-input");
    const button = form.querySelector("button");
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (button instanceof HTMLButtonElement) {
            button.disabled = true;
        }
        void runSearch(input.value).finally(() => {
            if (button instanceof HTMLButtonElement) {
                button.disabled = false;
            }
        });
    });
    await loadMetadata();
    const initialQuery = new URL(window.location.href).searchParams.get("q");
    if (initialQuery) {
        input.value = initialQuery;
        await runSearch(initialQuery);
    }
}
void initialise();
