"use client";

import { useMemo } from "react";
import type { LngLat } from "@/lib/finance/buildable-area";
import {
  buildParkingSequenceRecommendation,
  type ParkingSequenceRecommendationKind,
} from "@/lib/planning/parking-sequence-advisor";
import type { PlanningGeometrySnapshot } from "@/lib/planning/planning-geometry";
import type {
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";

interface PlanningParkingSequencePanelProps {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  geometry: PlanningGeometrySnapshot;
  boundary?: LngLat[];
  roads?: Array<{ name: string | null; points: [number, number][] }>;
  onCreateAlternative: (
    strategy: "surface" | "piloti",
    capacityCars: number
  ) => void;
  onEditProgram: () => void;
}

const RECOMMENDATION_TONE: Record<
  ParkingSequenceRecommendationKind,
  { background: string; color: string }
> = {
  "keep-current": {
    background: "var(--pos-soft)",
    color: "var(--pos-fg)",
  },
  surface: { background: "var(--accent-soft)", color: "var(--accent)" },
  piloti: { background: "var(--accent-soft)", color: "var(--accent)" },
  "reduce-program": {
    background: "var(--warn-soft)",
    color: "var(--warn-fg)",
  },
  "manual-review": {
    background: "var(--warn-soft)",
    color: "var(--warn-fg)",
  },
  "preserve-reference": {
    background: "var(--pos-soft)",
    color: "var(--pos-fg)",
  },
};

function StepCard({
  number,
  title,
  value,
  detail,
  tone = "neutral",
}: {
  number: number;
  title: string;
  value: string;
  detail: string;
  tone?: "neutral" | "positive" | "warning";
}) {
  const color =
    tone === "positive"
      ? "var(--pos-fg)"
      : tone === "warning"
        ? "var(--warn-fg)"
        : "var(--fg)";
  return (
    <div
      style={{
        minHeight: 118,
        padding: 13,
        border: "1px solid var(--line)",
        borderRadius: 10,
        background: "var(--bg-surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 7,
          alignItems: "center",
          fontSize: 10,
          color: "var(--fg-muted)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-grid",
            width: 20,
            height: 20,
            placeItems: "center",
            borderRadius: "50%",
            background: "var(--bg-sunken)",
            fontWeight: 800,
          }}
        >
          {number}
        </span>
        {title}
      </div>
      <div style={{ marginTop: 9, fontSize: 14, fontWeight: 800, color }}>
        {value}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 10.5,
          lineHeight: 1.5,
          color: "var(--fg-muted)",
        }}
      >
        {detail}
      </div>
    </div>
  );
}

export function PlanningParkingSequencePanel({
  scenario,
  calculation,
  geometry,
  boundary,
  roads,
  onCreateAlternative,
  onEditProgram,
}: PlanningParkingSequencePanelProps) {
  const result = useMemo(
    () =>
      buildParkingSequenceRecommendation({
        scenario,
        calculation,
        geometry,
        boundary,
        roads,
      }),
    [scenario, calculation, geometry, boundary, roads]
  );
  const recommendedOption =
    result.kind === "surface"
      ? result.surface
      : result.kind === "piloti"
        ? result.piloti
        : null;
  const recommendationTone = RECOMMENDATION_TONE[result.kind];
  const surfaceLayout = result.surface.layout;
  const pilotiLayout = result.piloti.layout;

  return (
    <section
      aria-labelledby="parking-sequence-title"
      style={{
        marginTop: 14,
        padding: 14,
        border: "1px solid var(--line)",
        borderRadius: 12,
        background: "var(--bg-sunken)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h3
            id="parking-sequence-title"
            style={{ margin: 0, fontSize: 13, fontWeight: 800 }}
          >
            건축물 올리기 · 주차 순서 점검
          </h3>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 10.5,
              color: "var(--fg-muted)",
            }}
          >
            추천은 원안을 바꾸지 않습니다. 적용하면 편집 가능한 대안 계획안을
            별도로 만듭니다.
          </p>
        </div>
        <span className="ui-tag">실제 주차면·통로 배치 기준</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 9,
          marginTop: 12,
        }}
      >
        <StepCard
          number={1}
          title="도로 접면"
          value={
            result.road.status === "frontage-known"
              ? result.road.roadName || "접면 방향 확인"
              : "접면 미확인"
          }
          detail={result.road.message}
          tone={
            result.road.status === "frontage-known" ? "positive" : "warning"
          }
        />
        <StepCard
          number={2}
          title="요구 주차"
          value={`${result.requiredCars}대 · 주거 ${result.residentialUnits}세대`}
          detail="현재 층별 용도·면적으로 계산한 요구 대수입니다. 제공 대수를 임의 입력한 값과 구분합니다."
        />
        <StepCard
          number={3}
          title="지상주차 실제 배치"
          value={
            surfaceLayout
              ? `${surfaceLayout.capacityCars}대 / ${result.requiredCars}대`
              : "계산 불가"
          }
          detail={result.surface.message}
          tone={
            surfaceLayout?.shortfallCars === 0 ? "positive" : "warning"
          }
        />
        <StepCard
          number={4}
          title="필로티 또는 층·세대"
          value={
            pilotiLayout
              ? `${pilotiLayout.capacityCars}대 / ${result.requiredCars}대`
              : "필로티 대안 없음"
          }
          detail={
            result.kind === "piloti"
              ? `적용 시 1층 ${result.removedGroundFloorAreaSqmForPiloti.toFixed(1)}㎡와 ${result.removedGroundFloorUnitsForPiloti}세대가 비수익 필로티로 바뀝니다.`
              : result.piloti.message
          }
          tone={pilotiLayout?.shortfallCars === 0 ? "positive" : "warning"}
        />
      </div>

      <div
        role="status"
        style={{
          marginTop: 10,
          padding: "11px 12px",
          borderRadius: 9,
          background: recommendationTone.background,
          color: recommendationTone.color,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 800 }}>{result.title}</div>
        <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.5 }}>
          {result.message}
        </div>
        {recommendedOption?.layout && (
          <button
            type="button"
            onClick={() =>
              onCreateAlternative(
                recommendedOption.strategy,
                recommendedOption.layout?.capacityCars ?? 0
              )
            }
            style={{
              marginTop: 9,
              padding: "7px 11px",
              border: "1px solid currentColor",
              borderRadius: 8,
              background: "transparent",
              color: "inherit",
              fontSize: 10.5,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {recommendedOption.strategy === "piloti"
              ? "필로티 대안 계획안 만들기"
              : "지상주차 대안 계획안 만들기"}
          </button>
        )}
        {result.kind === "reduce-program" && (
          <button
            type="button"
            onClick={onEditProgram}
            style={{
              marginTop: 9,
              padding: "7px 11px",
              border: "1px solid currentColor",
              borderRadius: 8,
              background: "transparent",
              color: "inherit",
              fontSize: 10.5,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            층·세대 정밀 편집 열기
          </button>
        )}
      </div>
    </section>
  );
}
