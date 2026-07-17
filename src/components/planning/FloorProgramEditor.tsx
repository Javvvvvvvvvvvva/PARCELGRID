"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addBasementFloor,
  addGroundFloor,
  addZoneToFloor,
  duplicateFloorProgram,
  removeFloorProgram,
  removeFloorZone,
  updateFloorProgram,
  updateFloorZone,
} from "@/lib/planning/floor-program-editor";
import {
  defaultRevenueModelForUse,
  sortFloorPrograms,
} from "@/lib/planning/scenario-utils";
import type {
  FloorProgram,
  FloorUseType,
  PlanningParking,
  PlanningRevenueModel,
  PlanningScenario,
} from "@/lib/planning/types";
import { num } from "@/lib/utils/format";

const USE_OPTIONS: Array<{ value: FloorUseType; label: string }> = [
  { value: "residential", label: "주거" },
  { value: "retail", label: "상가" },
  { value: "office", label: "업무" },
  { value: "parking", label: "주차" },
  { value: "piloti", label: "필로티" },
  { value: "common", label: "공용" },
  { value: "mechanical", label: "기계실" },
  { value: "storage", label: "창고" },
  { value: "other", label: "기타" },
];

const REVENUE_OPTIONS: Array<{
  value: PlanningRevenueModel;
  label: string;
}> = [
  { value: "sale", label: "매각" },
  { value: "lease", label: "임대" },
  { value: "non-revenue", label: "비수익" },
];

const PARKING_OPTIONS: Array<{
  value: PlanningParking["strategy"];
  label: string;
}> = [
  { value: "none", label: "계획 없음" },
  { value: "surface", label: "지상 주차" },
  { value: "piloti", label: "필로티 주차" },
  { value: "basement", label: "지하 주차" },
  { value: "mechanical", label: "기계식 주차" },
  { value: "mixed", label: "혼합형" },
];

function safeNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floorArea(floor: FloorProgram): number {
  return floor.zones.reduce(
    (sum, zone) => sum + Math.max(0, zone.areaSqm),
    0
  );
}

function useLabel(useType: FloorUseType): string {
  return (
    USE_OPTIONS.find((option) => option.value === useType)?.label ?? useType
  );
}

interface FloorProgramEditorProps {
  scenario: PlanningScenario;
  onChange: (
    patch: Partial<
      Pick<PlanningScenario, "floorPrograms" | "parking" | "primaryUse">
    >
  ) => void;
}

export function FloorProgramEditor({
  scenario,
  onChange,
}: FloorProgramEditorProps) {
  const sortedFloors = useMemo(
    () => sortFloorPrograms(scenario.floorPrograms),
    [scenario.floorPrograms]
  );
  const [expandedFloorId, setExpandedFloorId] = useState<string | null>(
    sortedFloors[0]?.id ?? null
  );
  const [newZoneUse, setNewZoneUse] = useState<
    Record<string, FloorUseType>
  >({});
  const previousScenarioIdRef = useRef(scenario.id);

  useEffect(() => {
    const scenarioChanged = previousScenarioIdRef.current !== scenario.id;
    if (scenarioChanged) {
      previousScenarioIdRef.current = scenario.id;
      setExpandedFloorId(sortedFloors[0]?.id ?? null);
      return;
    }

    // 사용자가 직접 접은 null 상태는 유지한다. 실제로 열린 층이 삭제된 경우에만
    // 남아 있는 첫 번째 층으로 이동한다.
    if (
      expandedFloorId &&
      !scenario.floorPrograms.some((floor) => floor.id === expandedFloorId)
    ) {
      setExpandedFloorId(sortedFloors[0]?.id ?? null);
    }
  }, [
    scenario.id,
    scenario.floorPrograms,
    sortedFloors,
    expandedFloorId,
  ]);

  const setFloors = (floorPrograms: FloorProgram[]) =>
    onChange({ floorPrograms });

  const addBasement = () => {
    const next = addBasementFloor(scenario.floorPrograms);
    setFloors(next);
    const lowest = [...next]
      .filter((floor) => floor.level < 0)
      .sort((a, b) => a.level - b.level)[0];
    setExpandedFloorId(lowest?.id ?? null);
  };

  const addGround = () => {
    const next = addGroundFloor(scenario.floorPrograms);
    setFloors(next);
    const highest = [...next]
      .filter((floor) => floor.level > 0)
      .sort((a, b) => b.level - a.level)[0];
    setExpandedFloorId(highest?.id ?? null);
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="editor-heading">
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 750 }}>
            층별 프로그램 편집
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 10.5,
              color: "var(--fg-faint)",
            }}
          >
            수정 내용은 건폐율·용적률·주차·개략 사업성에 즉시 반영됩니다.
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button
            type="button"
            style={secondaryButtonStyle}
            onClick={addBasement}
          >
            ＋ 지하층
          </button>
          <button type="button" style={primaryButtonStyle} onClick={addGround}>
            ＋ 지상층
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 9 }}>
        {sortedFloors.map((floor) => {
          const expanded = expandedFloorId === floor.id;
          return (
            <section
              key={floor.id}
              style={{
                border: expanded
                  ? "1.5px solid var(--fg)"
                  : "1px solid var(--border)",
                borderRadius: 11,
                background: "var(--bg-elev)",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`floor-program-${floor.id}`}
                onClick={() =>
                  setExpandedFloorId((current) =>
                    current === floor.id ? null : floor.id
                  )
                }
                style={{
                  width: "100%",
                  border: 0,
                  background: expanded ? "var(--bg-sunken)" : "transparent",
                  color: "var(--fg)",
                  padding: "11px 12px",
                  display: "grid",
                  gridTemplateColumns: "62px minmax(0, 1fr) auto",
                  gap: 10,
                  alignItems: "center",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <strong style={{ fontSize: 12.5 }}>{floor.label}</strong>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {floor.zones.length > 0 ? (
                      floor.zones.slice(0, 4).map((zone) => (
                        <span key={zone.id} className="ui-tag">
                          {useLabel(zone.useType)} {num(zone.areaSqm, 0)}㎡
                          {zone.unitCount > 0
                            ? ` · ${zone.unitCount}${
                                zone.useType === "residential" ? "세대" : "실"
                              }`
                            : ""}
                        </span>
                      ))
                    ) : (
                      <span
                        style={{ fontSize: 10.5, color: "var(--fg-faint)" }}
                      >
                        용도 미입력
                      </span>
                    )}
                    {floor.zones.length > 4 && (
                      <span className="ui-tag">+{floor.zones.length - 4}</span>
                    )}
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    color: "var(--fg-faint)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {num(floorArea(floor), 1)}㎡ · {expanded ? "접기" : "편집"}
                </span>
              </button>

              {expanded && (
                <div
                  id={`floor-program-${floor.id}`}
                  style={{ padding: 12, borderTop: "1px solid var(--border)" }}
                >
                  <div className="floor-settings-grid">
                    <NumberField
                      label="층고"
                      value={floor.floorHeightM}
                      min={2}
                      max={10}
                      step={0.1}
                      suffix="m"
                      onChange={(value) =>
                        setFloors(
                          updateFloorProgram(
                            scenario.floorPrograms,
                            floor.id,
                            { floorHeightM: Math.max(2, value) }
                          )
                        )
                      }
                    />
                    <NumberField
                      label="외곽선 비율"
                      value={floor.footprintScalePct}
                      min={10}
                      max={100}
                      step={1}
                      suffix="%"
                      onChange={(value) =>
                        setFloors(
                          updateFloorProgram(
                            scenario.floorPrograms,
                            floor.id,
                            {
                              footprintScalePct: Math.min(
                                100,
                                Math.max(10, value)
                              ),
                            }
                          )
                        )
                      }
                    />
                    <NumberField
                      label="북측 후퇴"
                      value={floor.northSetbackM}
                      min={0}
                      max={30}
                      step={0.1}
                      suffix="m"
                      onChange={(value) =>
                        setFloors(
                          updateFloorProgram(
                            scenario.floorPrograms,
                            floor.id,
                            { northSetbackM: Math.max(0, value) }
                          )
                        )
                      }
                    />
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
                    {floor.zones.map((zone) => {
                      const countable = [
                        "residential",
                        "retail",
                        "office",
                      ].includes(zone.useType);
                      return (
                        <div key={zone.id} className="zone-edit-row">
                          <label>
                            <span>용도</span>
                            <select
                              value={zone.useType}
                              onChange={(event) => {
                                const useType = event.target
                                  .value as FloorUseType;
                                const nextCountable = [
                                  "residential",
                                  "retail",
                                  "office",
                                ].includes(useType);
                                setFloors(
                                  updateFloorZone(
                                    scenario.floorPrograms,
                                    floor.id,
                                    zone.id,
                                    {
                                      useType,
                                      revenueModel:
                                        defaultRevenueModelForUse(useType),
                                      unitCount: nextCountable
                                        ? Math.max(1, zone.unitCount)
                                        : 0,
                                    }
                                  )
                                );
                              }}
                              style={fieldStyle}
                            >
                              {USE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>면적</span>
                            <div style={{ position: "relative" }}>
                              <input
                                type="number"
                                min={0}
                                step={0.1}
                                value={zone.areaSqm}
                                onChange={(event) =>
                                  setFloors(
                                    updateFloorZone(
                                      scenario.floorPrograms,
                                      floor.id,
                                      zone.id,
                                      {
                                        areaSqm: Math.max(
                                          0,
                                          safeNumber(event.target.value)
                                        ),
                                      }
                                    )
                                  )
                                }
                                style={{ ...fieldStyle, paddingRight: 28 }}
                              />
                              <span style={suffixStyle}>㎡</span>
                            </div>
                          </label>

                          <label>
                            <span>
                              {zone.useType === "residential"
                                ? "세대수"
                                : "호실수"}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              disabled={!countable}
                              value={zone.unitCount}
                              onChange={(event) =>
                                setFloors(
                                  updateFloorZone(
                                    scenario.floorPrograms,
                                    floor.id,
                                    zone.id,
                                    {
                                      unitCount: Math.max(
                                        0,
                                        Math.floor(
                                          safeNumber(event.target.value)
                                        )
                                      ),
                                    }
                                  )
                                )
                              }
                              style={{
                                ...fieldStyle,
                                opacity: countable ? 1 : 0.45,
                              }}
                            />
                          </label>

                          <label>
                            <span>수익 방식</span>
                            <select
                              value={
                                zone.revenueModel ??
                                defaultRevenueModelForUse(zone.useType)
                              }
                              onChange={(event) =>
                                setFloors(
                                  updateFloorZone(
                                    scenario.floorPrograms,
                                    floor.id,
                                    zone.id,
                                    {
                                      revenueModel: event.target
                                        .value as PlanningRevenueModel,
                                    }
                                  )
                                )
                              }
                              style={fieldStyle}
                            >
                              {REVENUE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <button
                            type="button"
                            aria-label="구역 삭제"
                            title="구역 삭제"
                            style={dangerIconButtonStyle}
                            onClick={() =>
                              setFloors(
                                removeFloorZone(
                                  scenario.floorPrograms,
                                  floor.id,
                                  zone.id
                                )
                              )
                            }
                          >
                            삭제
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="floor-actions">
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <select
                        value={newZoneUse[floor.id] ?? "residential"}
                        onChange={(event) =>
                          setNewZoneUse((current) => ({
                            ...current,
                            [floor.id]: event.target.value as FloorUseType,
                          }))
                        }
                        style={{ ...fieldStyle, width: 120 }}
                      >
                        {USE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() =>
                          setFloors(
                            addZoneToFloor(
                              scenario.floorPrograms,
                              floor.id,
                              newZoneUse[floor.id] ?? "residential"
                            )
                          )
                        }
                      >
                        ＋ 용도 구역 추가
                      </button>
                    </div>

                    <div style={{ display: "flex", gap: 7 }}>
                      <button
                        type="button"
                        style={secondaryButtonStyle}
                        onClick={() => {
                          const next = duplicateFloorProgram(
                            scenario.floorPrograms,
                            floor.id
                          );
                          setFloors(next);
                          const created = next.find(
                            (candidate) =>
                              !scenario.floorPrograms.some(
                                (existing) => existing.id === candidate.id
                              )
                          );
                          setExpandedFloorId(created?.id ?? floor.id);
                        }}
                      >
                        층 복제
                      </button>
                      <button
                        type="button"
                        disabled={scenario.floorPrograms.length <= 1}
                        style={{
                          ...secondaryButtonStyle,
                          color: "var(--neg-fg)",
                          opacity:
                            scenario.floorPrograms.length <= 1 ? 0.45 : 1,
                          cursor:
                            scenario.floorPrograms.length <= 1
                              ? "not-allowed"
                              : "pointer",
                        }}
                        onClick={() => {
                          const next = removeFloorProgram(
                            scenario.floorPrograms,
                            floor.id
                          );
                          setFloors(next);
                          setExpandedFloorId(
                            sortFloorPrograms(next)[0]?.id ?? null
                          );
                        }}
                      >
                        층 삭제
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="parking-panel">
        <div style={{ fontSize: 12, fontWeight: 750 }}>주차 계획</div>
        <div className="parking-settings-grid">
          <label>
            <span>주차 방식</span>
            <select
              value={scenario.parking.strategy}
              onChange={(event) =>
                onChange({
                  parking: {
                    ...scenario.parking,
                    strategy: event.target
                      .value as PlanningParking["strategy"],
                  },
                })
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
            <div style={{ position: "relative" }}>
              <input
                type="number"
                min={0}
                step={1}
                value={scenario.parking.providedCars}
                onChange={(event) =>
                  onChange({
                    parking: {
                      ...scenario.parking,
                      providedCars: Math.max(
                        0,
                        Math.floor(safeNumber(event.target.value))
                      ),
                    },
                  })
                }
                style={{ ...fieldStyle, paddingRight: 28 }}
              />
              <span style={suffixStyle}>대</span>
            </div>
          </label>

          <label style={{ gridColumn: "span 2" }}>
            <span>주차 메모</span>
            <input
              value={scenario.parking.notes ?? ""}
              placeholder="예: 1층 필로티 2대 + 옥외 1대"
              onChange={(event) =>
                onChange({
                  parking: {
                    ...scenario.parking,
                    notes: event.target.value,
                  },
                })
              }
              style={fieldStyle}
            />
          </label>
        </div>
      </section>

      <style jsx>{`
        .editor-heading,
        .floor-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .floor-actions {
          margin-top: 11px;
          padding-top: 11px;
          border-top: 1px dashed var(--border-faint);
        }
        .floor-settings-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(120px, 1fr));
          gap: 8px;
        }
        .zone-edit-row {
          display: grid;
          grid-template-columns: minmax(105px, 1.15fr) minmax(90px, 0.9fr) minmax(76px, 0.7fr) minmax(100px, 0.95fr) auto;
          gap: 7px;
          align-items: end;
          padding: 9px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: var(--bg-elev);
        }
        .zone-edit-row label,
        .parking-settings-grid label {
          min-width: 0;
          display: grid;
          gap: 4px;
        }
        .zone-edit-row label > span,
        .parking-settings-grid label > span {
          font-size: 9.5px;
          color: var(--fg-faint);
        }
        .parking-panel {
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 11px;
          background: var(--bg-sunken);
        }
        .parking-settings-grid {
          display: grid;
          grid-template-columns: minmax(140px, 1fr) minmax(120px, 0.7fr);
          gap: 8px;
          margin-top: 9px;
        }
        @media (max-width: 760px) {
          .floor-settings-grid,
          .parking-settings-grid {
            grid-template-columns: 1fr;
          }
          .parking-settings-grid label {
            grid-column: auto !important;
          }
          .zone-edit-row {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 9.5, color: "var(--fg-faint)" }}>
        {label}
      </span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) =>
            onChange(safeNumber(event.target.value, value))
          }
          style={{ ...fieldStyle, paddingRight: 29 }}
        />
        <span style={suffixStyle}>{suffix}</span>
      </div>
    </label>
  );
}

const fieldStyle = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 7,
  padding: "7px 8px",
  background: "var(--bg-elev)",
  color: "var(--fg)",
  fontFamily: "inherit",
  fontSize: 11,
} as const;

const suffixStyle = {
  position: "absolute",
  right: 8,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 9.5,
  color: "var(--fg-faint)",
  pointerEvents: "none",
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 9px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontSize: 10.5,
  fontWeight: 650,
  cursor: "pointer",
} as const;

const primaryButtonStyle = {
  border: "1px solid var(--fg)",
  borderRadius: 8,
  padding: "7px 10px",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 10.5,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const dangerIconButtonStyle = {
  ...secondaryButtonStyle,
  color: "var(--neg-fg)",
  whiteSpace: "nowrap",
} as const;
