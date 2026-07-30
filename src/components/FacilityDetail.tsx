import { useEffect, useRef } from "react";
import { formatDate, formatNumber } from "../lib/format";
import { categoryLabels } from "../lib/labels";
import type { FacilityLookupResult, SourceManifestEntry } from "../lib/types";

interface FacilityDetailProps {
  facility: FacilityLookupResult;
  sources: SourceManifestEntry[];
}

export function FacilityDetail({ facility, sources }: FacilityDetailProps) {
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    articleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [facility.medicalInstitutionCode]);

  const linkedSources = facility.sourceIds
    .map((sourceId) => sources.find((source) => source.id === sourceId))
    .filter((source) => source !== undefined);

  return (
    <article className="facility-detail" ref={articleRef}>
      <div className="facility-head">
        <div>
          <span className="category-badge">
            {categoryLabels[facility.category]}
          </span>
          <h3>{facility.facility.name}</h3>
          <p className="facility-meta">
            <span>医療機関コード {facility.medicalInstitutionCode}</span>
            <span>{facility.facility.address ?? "住所情報なし"}</span>
            <span>基準日 {formatDate(facility.asOf)}</span>
          </p>
        </div>
      </div>

      <h4>
        届出受理済みの施設基準（{formatNumber(facility.standards.length)}件）
      </h4>
      {facility.standards.length === 0 ? (
        <p className="empty-state">収録された施設基準はありません。</p>
      ) : (
        <ul className="standard-list">
          {facility.standards.map((standard, index) => (
            <li key={`${standard.acceptanceNumber}-${index}`}>
              <div>
                <div className="standard-name">
                  {standard.name ?? standard.abbreviation ?? "名称未収録"}
                </div>
                {standard.abbreviation && (
                  <div className="standard-abbr">
                    略称：{standard.abbreviation}
                  </div>
                )}
              </div>
              <div>
                <div>受理番号：{standard.acceptanceNumber}</div>
                <div className="standard-date">
                  {standard.effectiveFrom
                    ? `算定開始：${formatDate(standard.effectiveFrom)}`
                    : "算定開始：記載なし"}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {linkedSources.length > 0 && (
        <>
          <h4>この施設の取得元</h4>
          <ul className="source-links">
            {linkedSources.map((source) => (
              <li key={source.id}>
                <a href={source.pageUrl} target="_blank" rel="noreferrer">
                  {source.bureauName}の原資料
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
