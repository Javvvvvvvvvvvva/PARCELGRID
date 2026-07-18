"use client";

import { useMemo } from "react";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { analyzeFrontage } from "@/lib/geo/road-frontage";
import {
  calculateParkingLayout,
  type ParkingLayoutResult,
} from "@/lib/planning/parking-layout";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import { calculatePlanningSpatialValidation } from "@/lib/planning/scenario-spatial-validation";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import type {
  ParkingOrientation,
  ParkingStrategy,
  PlanningParking,
} from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";
import type { LngLat } from "@/lib/finance/buildable-area";

const STRATEGY_LABEL: Record<ParkingStrategy, string> = {
  none: "계획 없음",
  surface: "지상 주차",
  piloti: "필로티 주차",
  basement: "지하 주차",
  mechanical: "기계식 주차",
  mixed: "필로티 + 지상 혼합",
};

const ORIENTATION_LABEL: Record<ParkingOrientation, string> = {
  auto: "자동 최적 방향",
  "parallel-front": "전면도로 평행",
  "perpendicular-front": "전면도로 직각",
};

const ACCESS_MODE_LABEL: Record<ParkingLayoutResult["accessMode"], string> = {
  none: "배치 없음",
  "internal-aisle": "내부 차로형",
  "direct-frontage": "전면 직접진입형",
  mixed: "혼합형",
};

function openRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? ring.slice(0, -1)
    : ring;
}

function ringCentroid(ring: LngLat[]): LngLat {
  const points = openRing(ring);
  if (points.length === 0) return [0, 0];
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function ringToLocalMeters(ring: LngLat[], origin: LngLat): LocalPlanPoint[] {
  const [originLng, originLat] = origin;
  const longitudeScale = Math.cos((originLat * Math.PI) / 180);
  return openRing(ring).map(([lng, lat]) => ({
    x: (lng - originLng) * 111_000 * longitudeScale,
    z: -(lat - originLat) * 111_000,
  }));
}

function boundsForShapes(shapes: LocalPlanPoint[][]) {
  const points = shapes.flat().filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.z)
  );
  if (points.length === 0) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  return {
    minX: minX - width * 0.1,
    maxX: maxX + width * 0.1,
    minZ: minZ - depth * 0.1,
    maxZ: maxZ + depth * 0.1,
  };
}

function svgPoint(
  point: LocalPlanPoint,
  bounds: ReturnType<typeof boundsForShapes>,
  width: number,
  height: number
) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  return {
    x: ((point.x - bounds.minX) / spanX) * width,
    y: ((point.z - bounds.minZ) / spanZ) * height,
  };
}

function svgPolygon(
  shape: LocalPlanPoint[],
  bounds: ReturnType<typeof boundsForShapes>,
  width: number,
  height: number
): string {
  return shape
    .map((point) => {
      const converted = svgPoint(point, bounds, width, height);
      return `${converted.x.toFixed(1)},${converted.y.toFixed(1)}`;
    })
    .join(" ");
}

function ParkingPlanSvg({
  layout,
  frontEdge,
}: {
  layout: ParkingLayoutResult;
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
}) {
  const width = 700;
  const height = 360;
  const bounds = boundsForShapes([
    layout.targetShape,
    layout.exclusionShape,
    layout.aisleShape,
    layout.coreShape,
    ...layout.stalls.map((stall) => stall.corners),
    frontEdge ?? [],
  ]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="주차 배치 개략도"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <rect width={width} height={height} fill="var(--bg-sunken)" />
      {layout.targetShape.length >= 3 && (
        <polygon
          points={svgPolygon(layout.targetShape, bounds, width, height)}
          fill="rgba(148,163,184,0.2)"
          stroke="var(--fg-muted)"
          strokeWidth="2"
        />
      )}
      {layout.exclusionShape.length >= 3 && (
        <polygon
          points={svgPolygon(layout.exclusionShape, bounds, width, height)}
          fill="rgba(51,65,85,0.35)"
          stroke="#334155"
          strokeWidth="2"
        />
      )}
      {layout.aisleShape.length >= 3 && (
        <polygon
          points={svgPolygon(layout.aisleShape, bounds, width, height)}
          fill="rgba(59,130,246,0.09)"
          stroke="#60a5fa"
          strokeWidth="1.5"
          strokeDasharray="7 5"
        />
      )}
      {layout.coreShape.length >= 3 && (
        <polygon
          points={svgPolygon(layout.coreShape, bounds, width, height)}
          fill="rgba(245,158,11,0.28)"
          stroke="#d97706"
          strokeWidth="2"
        />
      )}
      {layout.stalls.map((stall, index) => {
        const center = svgPoint(stall.center, bounds, width, height);
        return (
          <g key={stall.id}>
            <polygon
              points={svgPolygon(stall.corners, bounds, width, height)}
              fill={
                stall.source === "piloti"
                  ? "rgba(20,184,166,0.24)"
                  : "rgba(34,197,94,0.22)"
              }
              stroke={stall.source === "piloti" ? "#0f766e" : "#15803d"}
              strokeWidth="1.6"
            />
            <text
              x={center.x}
              y={center.y + 4}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="var(--fg)"
            >
              {index + 1}
            </text>
          </g>
        );
      })}
      {layout.columns.map((column, index) => {
        const point = svgPoint(column, bounds, width, height);
        return (
          <circle
            key={`column-${index}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#475569"
            stroke="#f8fafc"
            strokeWidth="1"
          />
        );
      })}
      {frontEdge && (
        <line
          x1={svgPoint(frontEdge[0], bounds, width, height).x}
          y1={svgPoint(frontEdge[0], bounds, width, height).y}
          x2={svgPoint(frontEdge[1], bounds, width, height).x}
          y2={svgPoint(frontEdge[1], bounds, width, height).y}
          stroke="#dc2626"
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
      <g transform="translate(14 20)">
        <rect width="172" height="58" rx="8" fill="rgba(255,255,255,0.88)" />
        <text x="10" y="18" fontSize="12" fontWeight="700" fill="#0f172a">
          주차 배치 개략도
        </text>
        <text x="10" y="37" fontSize="11" fill="#475569">
          초록/청록: 주차면 · 파랑: 통로
        </text>
        <text x="10" y="52" fontSize="11" fill="#475569">
          주황: 코어 · 점: 기둥 · 빨강: 도로
        </text>
      </g>
    </svg>
  );
}

function fieldNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color =
    tone === "positive"
      ? "var(--pos-fg)"
      : tone === "negative"
        ? "var(--neg-fg)"
        : "var(--fg)";
  return (
    <div
      style={{
        padding: 11,
        border: "1px solid var(--border)",
        borderRadius: 9,
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 17, fontWeight: 750, color }}>
        {value}
      </div>
    </div>
  );
}

export function ScenarioParkingWorkspace({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const editPlanningScenarioDraft = useProjectStore(
    (state) => state.editPlanningScenarioDraft
  );

  const parcel = data?.parcel;
  const projectScenarios = planningScenarios.filter(
    (scenario) => scenario.projectId === projectId
  );
  const scenario =
    projectScenarios.find(
      (candidate) => candidate.id === selectedPlanningScenarioId
    ) ??
    projectScenarios[0] ??
    null;

  const assumptions = useMemo(() => {
    const legacy =
      data?.scenarios.find((candidate) => candidate.recommended)?._raw
        .assumptions ??
      data?.scenarios[0]?._raw.assumptions ??
      defaultAssumptions();
    return planningEconomicsAssumptionsFromLegacy(
      legacy,
      `stage2-parking-${data?.meta.version ?? "local"}`
    );
  }, [data]);

  const calculation = useMemo(() => {
    if (!parcel || !scenario) return null;
    return calculatePlanningScenario(scenario, {
      parcel: {
        lotAreaSqm: parcel.lotArea,
        maxFARPct: parcel.maxFAR,
        maxBCRPct: parcel.maxBCR,
        heightLimitM: parcel.heightLimit ?? 0,
        acquisitionCostManwon: parcel.acquiredPrice,
        demolitionCostManwon: parcel.demolitionCost ?? 0,
      },
      assumptions,
      calculatedAt: data?.meta.lastSyncedAt,
    });
  }, [parcel, scenario, assumptions, data?.meta.lastSyncedAt]);

  const preview = useMemo(() => {
    if (!parcel?.boundary || parcel.boundary.length < 3 || !scenario || !calculation) {
      return null;
    }
    const origin = ringCentroid(parcel.boundary);
    const parcelShape = ringToLocalMeters(parcel.boundary, origin);
    const spatial = calculatePlanningSpatialValidation(
      parcel.boundary,
      parcel.zoning ?? "",
      scenario,
      parcel.roads,
      parcel.setback
    );
    const firstMass = spatial?.model.aboveGroundFloors.find(
      (mass) => mass.level === 1
    );
    const firstFloor = scenario.floorPrograms.find((floor) => floor.level === 1);
    const pilotiEnabled = Boolean(
      firstFloor?.zones.some(
        (zone) =>
          zone.areaSqm > 0 &&
          (zone.useType === "piloti" || zone.useType === "parking")
      )
    );
    const frontage =
      parcel.roads && parcel.roads.length > 0
        ? analyzeFrontage(parcel.boundary, parcel.roads)
        : null;
    const frontEdge =
      frontage &&
      frontage.frontIndex >= 0 &&
      parcelShape.length > frontage.frontIndex
        ? ([
            parcelShape[frontage.frontIndex],
            parcelShape[(frontage.frontIndex + 1) % parcelShape.length],
          ] as [LocalPlanPoint, LocalPlanPoint])
        : null;
    const layoutInput = {
      parcelShape,
      buildingShape: firstMass?.shape ?? [],
      pilotiShape: firstMass?.shape ?? [],
      pilotiEnabled,
      requiredCars: calculation.parking.requiredCars,
      frontEdge,
    };
    const layout = calculateParkingLayout({
      ...layoutInput,
      strategy: scenario.parking.strategy,
      parking: scenario.parking,
    });
    const candidateStrategies: ParkingStrategy[] = pilotiEnabled
      ? ["surface", "piloti", "mixed"]
      : ["surface"];
    const alternatives = candidateStrategies.map((strategy) => ({
      strategy,
      layout: calculateParkingLayout({
        ...layoutInput,
        strategy,
        parking: {
          ...scenario.parking,
          strategy,
          orientation: "auto",
        },
      }),
    }));
    const recommendation = alternatives.reduce<(typeof alternatives)[number] | null>(
      (best, candidate) => {
        if (!candidate.layout.supportedStrategy || candidate.layout.capacityCars <= 0) {
          return best;
        }
        if (!best || candidate.layout.capacityCars > best.layout.capacityCars) {
          return candidate;
        }
        if (
          candidate.layout.capacityCars === best.layout.capacityCars &&
          candidate.strategy === scenario.parking.strategy
        ) {
          return candidate;
        }
        return best;
      },
      null
    );
    return { layout, frontEdge, pilotiEnabled, recommendation };
  }, [parcel, scenario, calculation]);

  if (!parcel || !scenario || !calculation || !preview) return null;

  const updateParking = (patch: Partial<PlanningParking>) => {
    editPlanningScenarioDraft(scenario.id, {
      parking: { ...scenario.parking, ...patch },
    });
  };

  const layout = preview.layout;
  const shortfall = Math.max(
    0,
    calculation.parking.requiredCars - layout.capacityCars
  );
  const requiredCarsConfirmed = calculation.parking.requiredCars > 0;
  const status = !layout.supportedStrategy || !requiredCarsConfirmed
    ? "review"
    : shortfall > 0
      ? "fail"
      : "pass";
  const statusColor =
    status === "pass"
      ? "var(--pos-fg)"
      : status === "fail"
        ? "var(--neg-fg)"
        : "var(--warn-fg)";
  const statusBackground =
    status === "pass"
      ? "var(--pos-soft)"
      : status === "fail"
        ? "var(--neg-soft)"
        : "var(--warn-soft)";

  return (
    <section
      style={{
        maxWidth: 1380,
        margin: "0 auto",
        padding: "0 var(--s5) var(--s6)",
      }}
    >
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 14,
          background: "var(--bg-elev)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "15px 17px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="ui-tag">PARKING</span>
              <h2 style={{ margin: 0, fontSize: 18 }}>주차 배치 검토</h2>
            </div>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 11,
                color: "var(--fg-muted)",
              }}
            >
              필로티·지상 주차면, 차량 통로, 코어와 기둥 손실을 반영해 실제 배치 가능 대수를 예비 검토합니다.
            </p>
          </div>
          <div
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: `1px solid ${statusColor}`,
              background: statusBackground,
              color: statusColor,
              fontSize: 11,
              fontWeight: 750,
            }}
          >
            {!requiredCarsConfirmed
              ? "의무주차 대수 확인 필요"
              : status === "pass"
              ? "필요 주차 충족"
              : status === "fail"
                ? `주차 ${shortfall}대 부족`
                : "상세 배치 준비 중"}
          </div>
        </header>

        <div className="parking-workspace-grid" style={{ padding: 16 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="parking-metrics">
              <Metric
                label={requiredCarsConfirmed ? "예상 의무주차" : "예상 의무주차 · 미확정"}
                value={`${calculation.parking.requiredCars}대`}
              />
              <Metric
                label="실제 배치 가능"
                value={`${layout.capacityCars}대`}
                tone={
                  !requiredCarsConfirmed
                    ? "neutral"
                    : layout.capacityCars >= calculation.parking.requiredCars
                      ? "positive"
                      : "negative"
                }
              />
              <Metric
                label="저장된 계획대수"
                value={`${scenario.parking.providedCars}대`}
              />
              <Metric
                label="배치 부족"
                value={`${shortfall}대`}
                tone={
                  !requiredCarsConfirmed
                    ? "neutral"
                    : shortfall > 0
                      ? "negative"
                      : "positive"
                }
              />
              <Metric
                label="주차 가용면적"
                value={`${num(layout.usableAreaSqm, 1)}㎡`}
              />
            </div>

            <div
              style={{
                minHeight: 360,
                border: "1px solid var(--border)",
                borderRadius: 11,
                overflow: "hidden",
              }}
            >
              <ParkingPlanSvg layout={layout} frontEdge={preview.frontEdge} />
            </div>

            {!requiredCarsConfirmed && (
              <div
                style={{
                  padding: "9px 11px",
                  borderRadius: 8,
                  background: "var(--warn-soft)",
                  color: "var(--warn-fg)",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                }}
              >
                현재 용도·세대·면적 입력으로 의무대수가 0대로 계산됐습니다. 이는 법정
                주차 면제를 확정한 값이 아니므로 용도별 설치기준을 다시 확인하세요.
              </div>
            )}

            {preview.recommendation &&
              (preview.recommendation.strategy !== scenario.parking.strategy ||
                preview.recommendation.layout.capacityCars > layout.capacityCars) && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                    padding: "10px 11px",
                    border: "1px solid var(--accent-fg)",
                    borderRadius: 9,
                    background: "var(--accent-soft)",
                  }}
                >
                  <div style={{ fontSize: 10.5, lineHeight: 1.5 }}>
                    <strong>자동 추천</strong> · {STRATEGY_LABEL[preview.recommendation.strategy]} ·{" "}
                    {ACCESS_MODE_LABEL[preview.recommendation.layout.accessMode]} ·{" "}
                    {preview.recommendation.layout.capacityCars}대
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateParking({
                        strategy: preview.recommendation!.strategy,
                        orientation: "auto",
                        providedCars: preview.recommendation!.layout.capacityCars,
                      })
                    }
                    style={{
                      border: "1px solid var(--accent-fg)",
                      borderRadius: 7,
                      padding: "7px 9px",
                      background: "var(--bg-elev)",
                      color: "var(--accent-fg)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      fontSize: 10.5,
                      fontWeight: 700,
                    }}
                  >
                    추천안 적용
                  </button>
                </div>
              )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!layout.supportedStrategy || layout.capacityCars <= 0}
                onClick={() => updateParking({ providedCars: layout.capacityCars })}
                style={{
                  border: "1px solid var(--fg)",
                  borderRadius: 8,
                  padding: "8px 11px",
                  background: "var(--fg)",
                  color: "var(--bg-elev)",
                  cursor:
                    layout.supportedStrategy && layout.capacityCars > 0
                      ? "pointer"
                      : "not-allowed",
                  opacity:
                    layout.supportedStrategy && layout.capacityCars > 0 ? 1 : 0.45,
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                실제 배치 {layout.capacityCars}대를 계획안에 적용
              </button>
              <span
                style={{
                  alignSelf: "center",
                  fontSize: 10.5,
                  color: "var(--fg-faint)",
                }}
              >
                적용 후 기존 주차·사업성 판정도 같은 대수로 다시 계산됩니다.
              </span>
            </div>
          </div>

          <aside
            style={{
              border: "1px solid var(--border)",
              borderRadius: 11,
              padding: 13,
              background: "var(--bg-sunken)",
              alignSelf: "start",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 750, marginBottom: 10 }}>
              주차 배치 조건
            </div>
            <div className="parking-fields">
              <label>
                <span>주차 방식</span>
                <select
                  value={scenario.parking.strategy}
                  onChange={(event) =>
                    updateParking({ strategy: event.target.value as ParkingStrategy })
                  }
                >
                  {Object.entries(STRATEGY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>배치 방향</span>
                <select
                  value={scenario.parking.orientation ?? "auto"}
                  onChange={(event) =>
                    updateParking({ orientation: event.target.value as ParkingOrientation })
                  }
                >
                  {Object.entries(ORIENTATION_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <NumberInput
                label="주차면 폭"
                value={scenario.parking.stallWidthM ?? 2.5}
                step={0.1}
                suffix="m"
                onChange={(value) => updateParking({ stallWidthM: value })}
              />
              <NumberInput
                label="주차면 길이"
                value={scenario.parking.stallDepthM ?? 5}
                step={0.1}
                suffix="m"
                onChange={(value) => updateParking({ stallDepthM: value })}
              />
              <NumberInput
                label="차량 통로 폭"
                value={scenario.parking.aisleWidthM ?? 6}
                step={0.1}
                suffix="m"
                onChange={(value) => updateParking({ aisleWidthM: value })}
              />
              <NumberInput
                label="진입구 폭"
                value={scenario.parking.entryWidthM ?? 3}
                step={0.1}
                suffix="m"
                onChange={(value) => updateParking({ entryWidthM: value })}
              />
              <NumberInput
                label="필로티 코어 면적"
                value={scenario.parking.coreAreaSqm ?? 10}
                step={1}
                suffix="㎡"
                onChange={(value) => updateParking({ coreAreaSqm: value })}
              />
              <NumberInput
                label="기둥·구조 손실"
                value={scenario.parking.columnLossPct ?? 8}
                step={1}
                suffix="%"
                onChange={(value) => updateParking({ columnLossPct: value })}
              />
            </div>

            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px solid var(--border)",
                display: "grid",
                gap: 6,
              }}
            >
              <InfoRow label="선택 방식" value={STRATEGY_LABEL[scenario.parking.strategy]} />
              <InfoRow label="배치 방향" value={`${num(layout.orientationDeg, 0)}°`} />
              <InfoRow label="진입 방식" value={ACCESS_MODE_LABEL[layout.accessMode]} />
              <InfoRow
                label="깊이 검토"
                value={`${num(layout.targetDepthM, 1)} / ${num(layout.requiredDepthM, 1)}m`}
              />
              <InfoRow label="원시 후보" value={`${layout.rawCandidateCars}대`} />
              <InfoRow label="코어" value={`${num(scenario.parking.coreAreaSqm ?? 10, 1)}㎡`} />
              <InfoRow label="기둥 표시" value={`${layout.columns.length}개`} />
            </div>

            {layout.warnings.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--warn-soft)",
                  color: "var(--warn-fg)",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                }}
              >
                {layout.warnings.map((warning) => (
                  <div key={warning}>• {warning}</div>
                ))}
              </div>
            )}
            {layout.capacityCars === 0 && !preview.pilotiEnabled && (
              <div
                style={{
                  marginTop: 9,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elev)",
                  color: "var(--fg-muted)",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                }}
              >
                지상 배치가 0대라면 1층 프로그램에 ‘필로티’ 또는 ‘주차’ 구역을 먼저
                지정하세요. 그러면 필로티·혼합 대안이 자동 추천에 포함됩니다.
              </div>
            )}
          </aside>
        </div>
      </div>

      <style jsx>{`
        .parking-workspace-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 300px;
          gap: 14px;
        }
        .parking-metrics {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 8px;
        }
        .parking-fields {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .parking-fields label {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .parking-fields label > span {
          font-size: 9.5px;
          color: var(--fg-faint);
        }
        .parking-fields select,
        .parking-fields input {
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 7px 8px;
          background: var(--bg-elev);
          color: var(--fg);
          font-family: inherit;
          font-size: 10.5px;
        }
        @media (max-width: 980px) {
          .parking-workspace-grid {
            grid-template-columns: 1fr;
          }
          .parking-metrics {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }
        @media (max-width: 620px) {
          .parking-metrics,
          .parking-fields {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function NumberInput({
  label,
  value,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          onChange={(event) =>
            onChange(Math.max(0, fieldNumber(event.target.value, value)))
          }
          style={{ paddingRight: 29 }}
        />
        <span
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 9.5,
            color: "var(--fg-faint)",
            pointerEvents: "none",
          }}
        >
          {suffix}
        </span>
      </div>
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        fontSize: 10.5,
      }}
    >
      <span style={{ color: "var(--fg-faint)" }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
