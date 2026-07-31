import { describe, expect, it } from "vitest";
import { applyChangeEvent, type AppliedStandardEntry } from "./apply-change-event.js";

describe("applyChangeEvent", () => {
  it("同一受理番号の履歴行があっても現行行が完全一致すればno-opにする", () => {
    const standards: AppliedStandardEntry[] = [
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2024-07-01",
        },
      },
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2026-06-01",
        },
      },
    ];

    expect(applyChangeEvent(standards, {
      action: "upsert",
      standardId: "home-care",
      standard: {
        abbreviation: "在薬総2",
        name: "在宅薬学総合体制加算2",
      },
      acceptanceNumber: "第128号",
      effectiveFrom: "2026-06-01",
      reviewStatus: "automatic",
    })).toBe("no-op");
    expect(standards).toHaveLength(2);
  });

  it("同一受理番号の履歴行を維持したまま新しい適用日を追加する", () => {
    const standards: AppliedStandardEntry[] = [
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2024-07-01",
        },
      },
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2025-06-01",
        },
      },
    ];

    expect(applyChangeEvent(standards, {
      action: "upsert",
      standardId: "home-care",
      standard: {
        abbreviation: "在薬総2",
        name: "在宅薬学総合体制加算2",
      },
      acceptanceNumber: "第128号",
      effectiveFrom: "2026-06-01",
      reviewStatus: "automatic",
    })).toBe("applied");
    expect(standards).toHaveLength(3);
    expect(standards[2]?.record.effectiveFrom).toBe("2026-06-01");
  });

  it("基準IDが一致する履歴行は公式失効時にすべて除去する", () => {
    const standards: AppliedStandardEntry[] = [
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2024-07-01",
        },
      },
      {
        standardId: "home-care",
        record: {
          abbreviation: "在薬総2",
          name: "在宅薬学総合体制加算2",
          acceptanceNumber: "第128号",
          effectiveFrom: "2026-06-01",
        },
      },
    ];

    expect(applyChangeEvent(standards, {
      action: "remove",
      standardId: "home-care",
      standard: {
        abbreviation: "在薬総2",
        name: "在宅薬学総合体制加算2",
      },
      acceptanceNumber: "",
      effectiveFrom: "2026-07-01",
      reviewStatus: "automatic",
    })).toBe("applied");
    expect(standards).toEqual([]);
  });
});
