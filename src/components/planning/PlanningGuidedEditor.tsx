"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addGuidedGroundFloor,
  guidedFloorArea,
  guidedFloorUseLabel,
  removeGuidedFloor,
  resizeGuidedFloor,
  type GuidedFloorActionResult,
  type GuidedPlanningParcel,
} from "@/lib/planning/guided-floor-stack";
import {
  sortFloorPrograms,
} from "@/lib/planning/scenario-utils";
import {
  updateFloorProgram,
  updateFloorZone,
} from "@/lib/planning/floor-program-editor";
import type {
  PlanningParking,
  PlanningScenario,
  PlanningScenarioCalculation,
} from "@/lib/planning/types";
import { num } from "@/lib/utils/format";

type GuidedPatch = Partial<
  Pick<
    PlanningScenario,
    "floorPrograms" | "parking" | "placement" | "primaryUse"
  >
>;

interface GuidedSnapshot {
  floorPrograms: PlanningScenario["floorPrograms"];
  parking: PlanningScenario["parking"];
  placement: PlanningScenario["placement"];
  primaryUse: PlanningScenario["primaryUse"];
}

const PRIMARY_USE_OPTIONS: Array<{
  value: PlanningScenario["primaryUse"];
  label: string;
}> = [
  { value: "single-house", label: "단독주택" },
  { value: "multi-family", label: "다가구·다세대" },
  { value: "mixed", label: "주거 + 근생" },
  { value: "retail", label: "근린생활시설" },
  { value: "office", label: "업무시설" },
];

const PARKING_OPTIONS: Array<{
  value: PlanningParking["strategy"];
  label: string;
}> = [
  { value: "none", label: "아직 정하지 않음" },
  { value: "surface", label: "지상 주차" },
  { value: "piloti", label: "필로티 주차" },
  { value: "basement", label: "지하 주차" },
  { value: "mechanical", label: "기계식 주차" },
  { value: "mixed", label: "혼합형" },
];

function cloneSnapshot(scenario: PlanningScenario): GuidedSnapshot {
  return {
    floorPrograms: scenario.floorPrograms.map((floor) => ({
      ...floor,
      zones: floor.zones.map((zone) => ({ ...zone })),
    })),
    parking: { ...scenario.parking },
    placement: { ...scenario.placement },
    primaryUse: scenario.primaryUse,
  };
}

function floorSummary(floor: PlanningScenario["floorPrograms"][number]): string {
  const labels = [
    ...new Set(floor.zones.map((zone) => guidedFloorUseLabel(zone.useType))),
  ];
  const units = floor.zones.reduce((sum, zone) => sum + zone.unitCount, 0);
  return `${labels.join(" + ") || "용도 미입력"} · ${num(
    guidedFloorArea(floor),
    1
  )}㎡${units > 0 ? ` · ${units}개` : ""}`;
}

export function PlanningGuidedEditor({
  scenario,
  calculation,
  parcel,
  onChange,
}: {
  scenario: PlanningScenario;
  calculation: PlanningScenarioCalculation;
  parcel: GuidedPlanningParcel;
  onChange: (patch: GuidedPatch) => void;
}) {
  const sortedFloors = useMemo(
    () => sortFloorPrograms(scenario.floorPrograms).reverse(),
    [scenario.floorPrograms]
  );
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(
    sortedFloors[0]?.id ?? null
  );
  const [lastSnapshot, setLastSnapshot] = useState<GuidedSnapshot | null>(null);
  const [actionMessage, setActionMessage] = useState(
    "층을 선택한 뒤 면적·층고·세대수를 간단히 조정할 수 있습니다."
  );

  useEffect(() => {
    if (
      selectedFloorId &&
      scenario.floorPrograms.some((floor) => floor.id === selectedFloorId)
    ) {
      return;
    }
    setSelectedFloorId(sortedFloors[0]?.id ?? null);
  }, [scenario.floorPrograms, selectedFloorId, sortedFloors]);

  const selectedFloor =
    scenario.floorPrograms.find((floor) => floor.id === selectedFloorId) ??
    null;
  const failCount = calculation.checks.filter(
    (check) => check.status === "fail"
  ).length;
  const reviewCount = calculation.checks.filter(
    (check) => check.status === "review" || check.status === "unknown"
  ).length;

  const applyPatch = (patch: GuidedPatch, message: string) => {
    setLastSnapshot(cloneSnapshot(scenario));
    onChange(patch);
    setActionMessage(message);
  };

  const applyFloorResult = (result: GuidedFloorActionResult) => {
    if (result.status === "blocked") {
      setActionMessage(result.message);
      return;
    }
    applyPatch({ floorPrograms: result.floorPrograms }, result.message);
    if (result.createdFloorId) setSelectedFloorId(result.createdFloorId);
  };

  const addFloor = (sourceFloorId?: string) =>
    applyFloorResult(addGuidedGroundFloor(scenario, parcel, sourceFloorId));

  const resizeFloor = (factor: number) => {
    if (!selectedFloor) return;
    applyFloorResult(
      resizeGuidedFloor(scenario, parcel, selectedFloor.id, factor)
    );
  };

  const changeFloorHeight = (delta: number) => {
    if (!selectedFloor) return;
    const nextHeight = Math.max(
      2,
      Math.round((selectedFloor.floorHeightM + delta) * 10) / 10
    );
    applyPatch(
      {
        floorPrograms: updateFloorProgram(
          scenario.floorPrograms,
          selectedFloor.id,
          { floorHeightM: nextHeight }
        ),
      },
      `${selectedFloor.label} 층고를 ${nextHeight.toFixed(1)}m로 조정했습니다. 높이 판정을 확인하세요.`
    );
  };

  const changeUnits = (delta: number) => {
    if (!selectedFloor) return;
    const target = selectedFloor.zones.find((zone) =>
      ["residential", "retail", "office"].includes(zone.useType)
    );
    if (!target) {
      setActionMessage(
        "선택한 층에는 세대·호실 수를 입력할 주거·상가·업무 구역이 없습니다."
      );
      return;
    }
    const unitCount = Math.max(0, target.unitCount + delta);
    applyPatch(
      {
        floorPrograms: updateFloorZone(
          scenario.floorPrograms,
          selectedFloor.id,
          target.id,
          { unitCount }
        ),
      },
      `${selectedFloor.label}의 계획 수를 ${unitCount}개로 조정했습니다.`
    );
  };

  const moveBuilding = (axis: "x" | "z", delta: number) => {
    const placement = {
      ...scenario.placement,
      [axis === "x" ? "offsetXM" : "offsetZM"]:
        scenario.placement[axis === "x" ? "offsetXM" : "offsetZM"] + delta,
    };
    applyPatch(
      { placement },
      `건물을 ${delta > 0 ? "+" : ""}${delta.toFixed(1)}m 이동했습니다. 3D와 배치 판정을 확인하세요.`
    );
  };

  const rotateBuilding = (delta: number) => {
    const rotationDeg =
      Math.round((scenario.placement.rotationDeg + delta) * 10) / 10;
    applyPatch(
      { placement: { ...scenario.placement, rotationDeg } },
      `건물 회전각을 ${rotationDeg.toFixed(1)}°로 조정했습니다.`
    );
  };

  const undo = () => {
    if (!lastSnapshot) return;
    onChange(lastSnapshot);
    setLastSnapshot(null);
    setActionMessage("마지막 빠른 편집을 되돌렸습니다.");
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section className="guide-status">
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 800 }}>
            빠른 계획 가이드
          </div>
          <div
            style={{ marginTop: 3, fontSize: 10.5, color: "var(--fg-muted)" }}
          >
            확정된 규제는 층 추가·확대 시 자동 차단하고, 미확정 규제는
            확인 항목으로 남깁니다.
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="ui-tag">
            {failCount > 0 ? `미충족 ${failCount}` : "필수항목 통과"}
          </span>
          {reviewCount > 0 && (
            <span className="ui-tag">확인 필요 {reviewCount}</span>
          )}
          <button
            type="button"
            disabled={!lastSnapshot}
            style={{
              ...secondaryButtonStyle,
              opacity: lastSnapshot ? 1 : 0.45,
              cursor: lastSnapshot ? "pointer" : "not-allowed",
            }}
            onClick={undo}
          >
            마지막 편집 취소
          </button>
        </div>
      </section>

      <section className="quick-settings">
        <label>
          <span>대표 용도</span>
          <select
            value={scenario.primaryUse}
            onChange={(event) =>
              applyPatch(
                {
                  primaryUse: event.target
                    .value as PlanningScenario["primaryUse"],
                },
                "대표 용도를 변경했습니다. 실제 계산은 아래 층별 용도가 기준입니다."
              )
            }
            style={fieldStyle}
          >
            {PRIMARY_USE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>주차 방식</span>
          <select
            value={scenario.parking.strategy}
            onChange={(event) =>
              applyPatch(
                {
                  parking: {
                    ...scenario.parking,
                    strategy: event.target.value as PlanningParking["strategy"],
                  },
                },
                "주차 방식을 변경했습니다. 실제 배치 가능 대수와 의무대수를 확인하세요."
              )
            }
            style={fieldStyle}
          >
            {PARKING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>계획 주차대수</span>
          <div className="counter">
            <button
              type="button"
              onClick={() =>
                applyPatch(
                  {
                    parking: {
                      ...scenario.parking,
                      providedCars: Math.max(
                        0,
                        scenario.parking.providedCars - 1
                      ),
                    },
                  },
                  "계획 주차대수를 조정했습니다."
                )
              }
            >
              −
            </button>
            <strong>{scenario.parking.providedCars}대</strong>
            <button
              type="button"
              onClick={() =>
                applyPatch(
                  {
                    parking: {
                      ...scenario.parking,
                      providedCars: scenario.parking.providedCars + 1,
                    },
                  },
                  "계획 주차대수를 조정했습니다."
                )
              }
            >
              ＋
            </button>
          </div>
        </label>
      </section>

      <section>
        <div className="section-heading">
          <div>
            <strong style={{ fontSize: 12.5 }}>층 쌓기</strong>
            <div
              style={{ marginTop: 2, fontSize: 10, color: "var(--fg-faint)" }}
            >
              위에 추가하면 최상층을 복제하고 확인된 FAR·높이·층수 안에서
              자동 조정합니다.
            </div>
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => addFloor()}
          >
            ＋ 위층 추가
          </button>
        </div>

        <div className="floor-stack">
          {sortedFloors.map((floor) => {
            const active = floor.id === selectedFloorId;
            return (
              <button
                key={floor.id}
                type="button"
                onClick={() => setSelectedFloorId(floor.id)}
                className={active ? "floor-card active" : "floor-card"}
              >
                <span className="floor-level">{floor.label}</span>
                <span className="floor-summary">{floorSummary(floor)}</span>
                <span className="floor-height">
                  층고 {floor.floorHeightM.toFixed(1)}m
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {selectedFloor && (
        <section className="selected-floor">
          <div className="section-heading">
            <div>
              <strong style={{ fontSize: 12.5 }}>
                {selectedFloor.label} 빠른 조정
              </strong>
              <div
                style={{ marginTop: 2, fontSize: 10, color: "var(--fg-faint)" }}
              >
                숫자를 직접 입력하려면 정밀 편집으로 전환하세요.
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => addFloor(selectedFloor.id)}
              >
                이 층을 위에 복제
              </button>
              <button
                type="button"
                style={{ ...secondaryButtonStyle, color: "var(--neg-fg)" }}
                onClick={() =>
                  applyFloorResult(removeGuidedFloor(scenario, selectedFloor.id))
                }
              >
                층 삭제
              </button>
            </div>
          </div>

          <div className="adjustment-grid">
            <QuickControl
              label="층 면적"
              value={`${num(guidedFloorArea(selectedFloor), 1)}㎡`}
              onMinus={() => resizeFloor(0.9)}
              onPlus={() => resizeFloor(1.1)}
            />
            <QuickControl
              label="층고"
              value={`${selectedFloor.floorHeightM.toFixed(1)}m`}
              onMinus={() => changeFloorHeight(-0.1)}
              onPlus={() => changeFloorHeight(0.1)}
            />
            <QuickControl
              label="세대·호실"
              value={`${selectedFloor.zones.reduce(
                (sum, zone) => sum + zone.unitCount,
                0
              )}개`}
              onMinus={() => changeUnits(-1)}
              onPlus={() => changeUnits(1)}
            />
          </div>
        </section>
      )}

      <section className="placement-panel">
        <div className="section-heading">
          <div>
            <strong style={{ fontSize: 12.5 }}>건물 위치</strong>
            <div
              style={{ marginTop: 2, fontSize: 10, color: "var(--fg-faint)" }}
            >
              한 번에 0.5m 이동하고 5° 회전합니다. 범위를 벗어나면 3D 배치
              판정에서 바로 표시됩니다.
            </div>
          </div>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={() =>
              applyPatch(
                {
                  placement: {
                    ...scenario.placement,
                    offsetXM: 0,
                    offsetZM: 0,
                    rotationDeg: 0,
                  },
                },
                "건물을 중앙 위치와 0° 회전으로 초기화했습니다."
              )
            }
          >
            중앙 배치
          </button>
        </div>
        <div className="placement-controls">
          <div className="direction-pad">
            <button type="button" onClick={() => moveBuilding("z", -0.5)}>
              ↑
            </button>
            <button type="button" onClick={() => moveBuilding("x", -0.5)}>
              ←
            </button>
            <span>이동</span>
            <button type="button" onClick={() => moveBuilding("x", 0.5)}>
              →
            </button>
            <button type="button" onClick={() => moveBuilding("z", 0.5)}>
              ↓
            </button>
          </div>
          <QuickControl
            label="회전"
            value={`${scenario.placement.rotationDeg.toFixed(1)}°`}
            onMinus={() => rotateBuilding(-5)}
            onPlus={() => rotateBuilding(5)}
          />
          <div className="position-readout">
            <span>좌우 {scenario.placement.offsetXM.toFixed(1)}m</span>
            <span>남북 {scenario.placement.offsetZM.toFixed(1)}m</span>
          </div>
        </div>
      </section>

      <div
        style={{
          padding: "9px 11px",
          borderRadius: 8,
          background: "var(--bg-sunken)",
          color:
            actionMessage.includes("초과") ||
            actionMessage.includes("없습니다")
              ? "var(--neg-fg)"
              : "var(--fg-muted)",
          fontSize: 10.5,
          lineHeight: 1.45,
        }}
      >
        {actionMessage}
      </div>

      <style jsx>{`
        .guide-status,
        .section-heading {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .guide-status {
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--bg-sunken);
        }
        .quick-settings {
          display: grid;
          grid-template-columns: repeat(3, minmax(150px, 1fr));
          gap: 9px;
        }
        .quick-settings label {
          display: grid;
          gap: 5px;
          font-size: 10px;
          color: var(--fg-faint);
        }
        .counter {
          min-height: 36px;
          display: grid;
          grid-template-columns: 36px 1fr 36px;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          background: var(--bg-elev);
        }
        .counter button,
        .direction-pad button {
          border: 0;
          background: var(--bg-sunken);
          color: var(--fg);
          cursor: pointer;
        }
        .counter strong {
          display: grid;
          place-items: center;
          font-size: 11.5px;
        }
        .floor-stack {
          margin-top: 10px;
          display: grid;
          gap: 7px;
        }
        .floor-card {
          width: 100%;
          display: grid;
          grid-template-columns: 58px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 10px 11px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: var(--bg-elev);
          color: var(--fg);
          text-align: left;
          cursor: pointer;
          font-family: inherit;
        }
        .floor-card.active {
          border: 1.5px solid var(--fg);
          background: var(--bg-sunken);
        }
        .floor-level {
          font-size: 12px;
          font-weight: 800;
        }
        .floor-summary {
          min-width: 0;
          font-size: 10.5px;
          color: var(--fg-muted);
        }
        .floor-height {
          font-size: 9.5px;
          color: var(--fg-faint);
          white-space: nowrap;
        }
        .selected-floor,
        .placement-panel {
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
        }
        .adjustment-grid {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(3, minmax(130px, 1fr));
          gap: 8px;
        }
        .placement-controls {
          margin-top: 11px;
          display: grid;
          grid-template-columns: auto minmax(150px, 0.7fr) minmax(130px, 0.5fr);
          gap: 12px;
          align-items: center;
        }
        .direction-pad {
          display: grid;
          grid-template-columns: repeat(3, 34px);
          grid-template-rows: repeat(3, 30px);
          gap: 3px;
        }
        .direction-pad button {
          border: 1px solid var(--border);
          border-radius: 6px;
        }
        .direction-pad button:nth-child(1) {
          grid-column: 2;
        }
        .direction-pad button:nth-child(2) {
          grid-column: 1;
          grid-row: 2;
        }
        .direction-pad span {
          grid-column: 2;
          grid-row: 2;
          display: grid;
          place-items: center;
          font-size: 9px;
          color: var(--fg-faint);
        }
        .direction-pad button:nth-child(4) {
          grid-column: 3;
          grid-row: 2;
        }
        .direction-pad button:nth-child(5) {
          grid-column: 2;
          grid-row: 3;
        }
        .position-readout {
          display: grid;
          gap: 5px;
          font-size: 10px;
          color: var(--fg-muted);
        }
        @media (max-width: 760px) {
          .quick-settings,
          .adjustment-grid,
          .placement-controls {
            grid-template-columns: 1fr;
          }
          .floor-card {
            grid-template-columns: 52px 1fr;
          }
          .floor-height {
            grid-column: 2;
          }
        }
      `}</style>
    </div>
  );
}

function QuickControl({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div>
      <div
        style={{ marginBottom: 5, fontSize: 9.5, color: "var(--fg-faint)" }}
      >
        {label}
      </div>
      <div className="quick-control">
        <button type="button" onClick={onMinus}>
          −
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={onPlus}>
          ＋
        </button>
        <style jsx>{`
          .quick-control {
            display: grid;
            grid-template-columns: 34px 1fr 34px;
            min-height: 36px;
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
          }
          button {
            border: 0;
            background: var(--bg-sunken);
            color: var(--fg);
            cursor: pointer;
          }
          strong {
            display: grid;
            place-items: center;
            font-size: 11px;
          }
        `}</style>
      </div>
    </div>
  );
}

const fieldStyle = {
  width: "100%",
  minHeight: 36,
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 11,
  boxSizing: "border-box",
} as const;

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "8px 11px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 10.5,
  fontWeight: 750,
  cursor: "pointer",
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "6px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontSize: 10,
  cursor: "pointer",
} as const;
