import { categoryLabels } from "../lib/labels";
import type { FacilitySearchTuple } from "../lib/types";

interface ResultCardProps {
  tuple: FacilitySearchTuple;
  onSelect: (medicalInstitutionCode: string) => void;
}

export function ResultCard({ tuple, onSelect }: ResultCardProps) {
  const [code, name, address, category] = tuple;
  return (
    <article className="result-card">
      <div>
        <span className="category-badge">{categoryLabels[category]}</span>
        <h3>{name}</h3>
        <p className="result-meta">
          <span>医療機関コード {code}</span>
          <span>{address ?? "住所情報なし"}</span>
        </p>
      </div>
      <button
        type="button"
        className="result-button"
        onClick={() => onSelect(code)}
      >
        施設基準を見る
      </button>
    </article>
  );
}
