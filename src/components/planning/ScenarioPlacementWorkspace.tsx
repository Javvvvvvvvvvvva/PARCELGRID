"use client";

import { useMemo } from "react";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import {
  analyzeFrontage,
  edgeSetbacksFromFrontage,
} from "@/lib/geo/road-frontage";
import {
  assessPlanningPlacement,
  type PlanningPlacementAssessment,
} from "@/lib/planning/placement-assessment";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  type LocalPlanPoint,
  type PlanningEnvelopeStep,
  type PlanningMassModel,
} from "@/lib/planning/planning-massing";
import type {
  PlanningPlacement,
  PlanningScenario,
} from "@/lib/planning/types";
import { useProjectStore } from "@/lib/stores/project-store";
import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import { num } from "@/lib/utils/format";

interface PlacementPreviewData {
  groundShape: LocalPlanPoint[];
  envelopeSteps: PlanningEnvelopeStep[];
  model: PlanningMassModel;
  assessment: PlanningPlacementAssessment;
  frontageRoadName: string | null;
  frontEdge: [LocalPlanPoint, LocalPlanPoint] | null;
  frontEdgeAngleDeg: number | null;
  warnings: string[];
}

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

function ringToLocalMeters(
  ring: LngLat[],
  origin: LngLat
): LocalPlanPoint[] {
  const [originLng, originLat] = origin;
  const longitudeScale = Math.cos((originLat * Math.PI) / 180);
  return openRing(ring).map(([lng, lat]) => ({
    x: (lng - originLng) * 111_000 * longitudeScale,
    z: -(lat - originLat) * 111_000,
  }));
}

function buildPlacementPreviewData(
  boundary: LngLat[],
  zoning: string,
  scenario: PlanningScenario,
  roads?: RoadLine[],
  setback?: SetbackSpec
): PlacementPreviewData {
  const origin = ringCentroid(boundary);
  const groundShape = ringToLocalMeters(boundary, origin);
  const groundFloors = scenario.floorPrograms.filter((floor) => floor.level > 0);
  const maxFloor = Math.max(1, ...groundFloors.map((floor) => floor.level));
  const averageFloorHeight =
    groundFloors.length > 0
      ? groundFloors.reduce(
          (sum, floor) => sum + Math.max(2, floor.floorHeightM),
          0
        ) / groundFloors.length
      : 3;

  const frontage =
    roads && roads.length > 0 ? analyzeFrontage(boundary, roads) : null;
  const edgeSetbacks = edgeSetbacksFromFrontage(
    frontage,
    setback ?? { road: 0.5, side: 0.5, rear: 0.5 }
  );

  const buildable = calcBuildableArea(
    boundary,
    0.5,
    maxFloor,
    averageFloorHeight,
    /주거/.test(zoning),
    edgeSetbacks
  );
  const basementBuildable = calcBuildableArea(
    boundary,
    0.5,
    1,
    3,
    false,
    edgeSetbacks
  );

  const fallbackRing = buildable.buildable2DRing ?? boundary;
  const firstStep = buildable.stepped3D.find((step) => step.ringLngLat);
  const basementRing = basementBuildable.buildable2DRing ?? boundary;

  const envelopeSteps: PlanningEnvelopeStep[] = scenario.floorPrograms.map(
    (floor) => {
      const step =
        floor.level > 0
          ? buildable.stepped3D.find(
              (candidate) => candidate.floor === floor.level
            )
          : undefined;
      const ring =
        floor.level < 0
          ? basementRing
          : step?.ringLngLat ?? firstStep?.ringLngLat ?? fallbackRing;
      const shape = ringToLocalMeters(ring, origin);
      return {
        level: floor.level,
        shape,
        envelopeAreaSqm:
          floor.level < 0
            ? polygonAreaSqm(shape)
            : step?.floorPlateSqm ?? polygonAreaSqm(shape),
        requiredSetbackM:
          floor.level < 0 ? 0 : step?.requiredSetbackM ?? 0,
        envelopeAvailable:
          floor.level < 0
            ? Boolean(basementBuildable.buildable2DRing)
            : Boolean(step?.ringLngLat ?? buildable.buildable2DRing),
      };
    }
  );

  const model = buildPlanningMassModel(
    scenario.floorPrograms,
    envelopeSteps,
    scenario.placement
  );
  const assessment = assessPlanningPlacement(model, envelopeSteps);

  const frontEdge =
    frontage &&
    frontage.frontIndex >= 0 &&
    groundShape.length > frontage.frontIndex
      ? ([
          groundShape[frontage.frontIndex],
          groundShape[(frontage.frontIndex + 1) % groundShape.length],
        ] as [LocalPlanPoint, LocalPlanPoint])
      : null;
  const frontEdgeAngleDeg = frontEdge
    ? (Math.atan2(
        frontEdge[1].z - frontEdge[0].z,
        frontEdge[1].x - frontEdge[0].x
      ) *
        180) /
      Math.PI
    : null;

  return {
    groundShape,
    envelopeSteps,
    model,
    assessment,
    frontageRoadName: frontage?.roadName ?? null,
    frontEdge,
    frontEdgeAngleDeg,
    warnings: [...buildable.warnings, ...basementBuildable.warnings],
  };
}

function previewBounds(shapes: LocalPlanPoint[][]) {
  const points = shapes.flat().filter(Boolean);
  if (points.length === 0) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxZ - minZ);
  return {
    minX: minX - width * 0.12,
    maxX: maxX + width * 0.12,
    minZ: minZ - height * 0.12,
    maxZ: maxZ + height * 0.12,
  };
}

function svgPoints(
  points: LocalPlanPoint[],
  bounds: ReturnType<typeof previewBounds>,
  width = 440,
  height = 260
): string {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
  return points
    .map((point) => {
      const x = ((point.x - bounds.minX) / spanX) * width;
      const y = ((point.z - bounds.minZ) / spanZ) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function statusTone(assessment: PlanningPlacementAssessment) {
  if (assessment.allFloorsFit) {
    return {
      label: "배치 가능",
      border: "var(--pos-fg)",
      background: "var(--pos-soft)",
      color: "var(--pos-fg)",
    };
  }
  return {
    label: assessment.outsideFloorCount > 0 ? "법규 외곽선 이탈" : "면적 초과",
    border: "var(--neg-fg)",
    background: "var(--neg-soft)",
    color: "var(--neg-fg)",
  };
}

export function ScenarioPlacementWorkspace({
  projectId,
}: {
  projectId: string;
}) {
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

  const preview = useMemo(() => {
    if (!parcel?.boundary || parcel.boundary.length < 3 || !scenario) return null;
    return buildPlacementPreviewData(
      parcel.boundary,
      parcel.zoning ?? "",
      scenario,
      parcel.roads,
      parcel.setback
    );
  }, [parcel, scenario]);

  if (!parcel || !scenario || !preview) return null;

  const updatePlacement = (patch: Partial<PlanningPlacement>) => {
    editPlanningScenarioDraft(scenario.id, {
      placement: { ...scenario.placement, ...patch },
    });
  };

  const status = statusTone(preview.assessment);
  const previewMass =
    preview.model.aboveGroundFloors[0] ?? preview.model.basementFloors[0] ?? null;
  const previewEnvelope = previewMass
    ? preview.envelopeSteps.find((step) => step.level === previewMass.level) ?? null
    : null;
  const previewFloorAssessment = previewMass
    ? preview.assessment.floors.find((floor) => floor.floorId === previewMass.id) ?? null
    : null;
  const bounds = previewBounds([
    preview.groundShape,
    previewEnvelope?.shape ?? [],
    previewMass?.shape ?? [],
  ]);

  const nudge = (x: number, z: number) =>
    updatePlacement({
      offsetXM: Number((scenario.placement.offsetXM + x).toFixed(1)),
      offsetZM: Number((scenario.placement.offsetZM + z).toFixed(1)),
    });

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
            padding: "15px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 780 }}>건물 배치 편집</div>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 10.5,
                color: "var(--fg-muted)",
              }}
            >
              선택한 계획안을 이동·회전하고 층별 법규 외곽선 안에 들어오는지 확인합니다.
            </p>
          </div>
          <div
            style={{
              padding: "6px 9px",
              borderRadius: 999,
              border: `1px solid ${status.border}`,
              background: status.background,
              color: status.color,
              fontSize: 10.5,
              fontWeight: 750,
            }}
          >
            {status.label}
          </div>
        </header>

        <div className="placement-workspace-grid">
          <div style={{ padding: 18, borderRight: "1px solid var(--border)" }}>
            <div className="placement-field-grid">
              <PlacementNumberField
                label="좌우 이동"
                value={scenario.placement.offsetXM}
                suffix="m"
                min={-30}
                max={30}
                step={0.1}
                onChange={(offsetXM) => updatePlacement({ offsetXM })}
              />
              <PlacementNumberField
                label="남북 이동"
                value={scenario.placement.offsetZM}
                suffix="m"
                min={-30}
                max={30}
                step={0.1}
                onChange={(offsetZM) => updatePlacement({ offsetZM })}
              />
              <PlacementNumberField
                label="회전각"
                value={scenario.placement.rotationDeg}
                suffix="°"
                min={-180}
                max={180}
                step={1}
                onChange={(rotationDeg) => updatePlacement({ rotationDeg })}
              />
              <PlacementNumberField
                label="전체 북측 후퇴"
                value={scenario.placement.northSetbackM}
                suffix="m"
                min={0}
                max={30}
                step={0.1}
                onChange={(northSetbackM) => updatePlacement({ northSetbackM })}
              />
            </div>

            <div className="placement-control-row">
              <div>
                <div style={smallLabelStyle}>0.5m 미세 이동</div>
                <div className="nudge-grid">
                  <span />
                  <button type="button" onClick={() => nudge(0, -0.5)}>↑</button>
                  <span />
                  <button type="button" onClick={() => nudge(-0.5, 0)}>←</button>
                  <button
                    type="button"
                    onClick={() => updatePlacement({ offsetXM: 0, offsetZM: 0 })}
                    title="중앙 배치"
                  >
                    •
                  </button>
                  <button type="button" onClick={() => nudge(0.5, 0)}>→</button>
                  <span />
                  <button type="button" onClick={() => nudge(0, 0.5)}>↓</button>
                  <span />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={smallLabelStyle}>전면도로 기준</div>
                <div
                  style={{
                    padding: "9px 10px",
                    borderRadius: 9,
                    background: "var(--bg-sunken)",
                    fontSize: 10.5,
                    lineHeight: 1.55,
                    color: "var(--fg-muted)",
                  }}
                >
                  <strong style={{ color: "var(--fg)" }}>
                    {preview.frontageRoadName ?? "도로명 미확인"}
                  </strong>
                  <br />
                  전면 경계각 {preview.frontEdgeAngleDeg != null
                    ? `${preview.frontEdgeAngleDeg.toFixed(1)}°`
                    : "미확인"}
                  <br />
                  법규 외곽선이 이미 전면·측면·후면 이격을 반영합니다.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() =>
                  updatePlacement({ offsetXM: 0, offsetZM: 0 })
                }
              >
                중앙 배치
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() =>
                  updatePlacement({ rotationDeg: 0, offsetXM: 0, offsetZM: 0 })
                }
              >
                전면도로 기준 정렬
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() =>
                  updatePlacement({
                    rotationDeg: 0,
                    offsetXM: 0,
                    offsetZM: 0,
                    roadSetbackM: 0,
                    northSetbackM: 0,
                  })
                }
              >
                배치 초기화
              </button>
            </div>
          </div>

          <div style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 750 }}>평면 배치 미리보기</div>
                <div style={{ marginTop: 3, fontSize: 10, color: "var(--fg-faint)" }}>
                  대지 · 법규 외곽선 · {previewMass?.label ?? "계획층"}
                </div>
              </div>
              {previewFloorAssessment && (
                <span
                  style={{
                    color: previewFloorAssessment.fits
                      ? "var(--pos-fg)"
                      : "var(--neg-fg)",
                    fontSize: 10.5,
                    fontWeight: 750,
                  }}
                >
                  {previewFloorAssessment.fits ? "외곽선 내부" : "배치 조정 필요"}
                </span>
              )}
            </div>

            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 11,
                overflow: "hidden",
                background: "var(--bg-sunken)",
              }}
            >
              <svg viewBox="0 0 440 260" style={{ width: "100%", display: "block" }}>
                <polygon
                  points={svgPoints(preview.groundShape, bounds)}
                  fill="#e2e8f0"
                  stroke="#64748b"
                  strokeWidth="1.5"
                />
                {previewEnvelope && (
                  <polygon
                    points={svgPoints(previewEnvelope.shape, bounds)}
                    fill="rgba(14, 116, 144, 0.08)"
                    stroke="#0e7490"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                )}
                {preview.frontEdge && (
                  <line
                    x1={Number(svgPoints([preview.frontEdge[0]], bounds).split(",")[0])}
                    y1={Number(svgPoints([preview.frontEdge[0]], bounds).split(",")[1])}
                    x2={Number(svgPoints([preview.frontEdge[1]], bounds).split(",")[0])}
                    y2={Number(svgPoints([preview.frontEdge[1]], bounds).split(",")[1])}
                    stroke="#f59e0b"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                )}
                {previewMass && (
                  <polygon
                    points={svgPoints(previewMass.shape, bounds)}
                    fill={previewFloorAssessment?.fits
                      ? "rgba(59, 130, 246, 0.48)"
                      : "rgba(239, 68, 68, 0.48)"}
                    stroke={previewFloorAssessment?.fits ? "#2563eb" : "#dc2626"}
                    strokeWidth="2"
                  />
                )}
              </svg>
            </div>

            <div className="placement-legend">
              <span><i style={{ background: "#e2e8f0", borderColor: "#64748b" }} />대지</span>
              <span><i style={{ background: "rgba(14,116,144,.1)", borderColor: "#0e7490" }} />법규 외곽선</span>
              <span><i style={{ background: "rgba(59,130,246,.48)", borderColor: "#2563eb" }} />계획 매스</span>
              <span><i style={{ background: "#f59e0b", borderColor: "#f59e0b" }} />전면 경계</span>
            </div>

            <div style={{ marginTop: 13, display: "grid", gap: 7 }}>
              {preview.assessment.floors.map((floor) => (
                <div
                  key={floor.floorId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "55px 1fr auto",
                    gap: 9,
                    alignItems: "center",
                    padding: "8px 9px",
                    borderRadius: 8,
                    background: floor.fits ? "var(--bg-sunken)" : "var(--neg-soft)",
                    fontSize: 10.5,
                  }}
                >
                  <strong>{floor.label}</strong>
                  <span style={{ color: "var(--fg-muted)" }}>
                    {!floor.areaFits
                      ? `면적 ${num(floor.capacityShortfallSqm, 1)}㎡ 초과`
                      : !floor.placementFits
                        ? "이동·회전으로 외곽선 이탈"
                        : "면적·배치 수용 가능"}
                  </span>
                  <span
                    style={{
                      color: floor.fits ? "var(--pos-fg)" : "var(--neg-fg)",
                      fontWeight: 750,
                    }}
                  >
                    {floor.fits ? "통과" : "조정"}
                  </span>
                </div>
              ))}
            </div>

            {preview.warnings.length > 0 && (
              <p
                style={{
                  margin: "11px 0 0",
                  fontSize: 10,
                  lineHeight: 1.45,
                  color: "var(--warn-fg)",
                }}
              >
                {preview.warnings.join(" · ")}
              </p>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .placement-workspace-grid {
          display: grid;
          grid-template-columns: minmax(360px, 0.9fr) minmax(420px, 1.1fr);
        }
        .placement-field-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .placement-control-row {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          margin-top: 15px;
          flex-wrap: wrap;
        }
        .nudge-grid {
          display: grid;
          grid-template-columns: repeat(3, 34px);
          grid-template-rows: repeat(3, 34px);
          gap: 4px;
        }
        .nudge-grid button {
          border: 1px solid var(--border);
          border-radius: 7px;
          background: var(--bg-elev);
          color: var(--fg);
          cursor: pointer;
          font-size: 14px;
        }
        .placement-legend {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 8px;
          font-size: 9.5px;
          color: var(--fg-muted);
        }
        .placement-legend span {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .placement-legend i {
          display: inline-block;
          width: 11px;
          height: 11px;
          border: 1px solid;
          border-radius: 2px;
        }
        @media (max-width: 980px) {
          .placement-workspace-grid {
            grid-template-columns: 1fr;
          }
          .placement-workspace-grid > div:first-child {
            border-right: 0 !important;
            border-bottom: 1px solid var(--border);
          }
        }
        @media (max-width: 580px) {
          .placement-field-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function PlacementNumberField({
  label,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span style={smallLabelStyle}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) {
              onChange(Math.min(max, Math.max(min, parsed)));
            }
          }}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "9px 31px 9px 10px",
            background: "var(--bg-elev)",
            color: "var(--fg)",
            fontFamily: "inherit",
            fontSize: 12,
          }}
        />
        <span
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 10,
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

const smallLabelStyle = {
  display: "block",
  marginBottom: 5,
  fontSize: 10.5,
  fontWeight: 700,
  color: "var(--fg-muted)",
} as const;

const secondaryButtonStyle = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "7px 10px",
  background: "var(--bg-elev)",
  color: "var(--fg-muted)",
  fontFamily: "inherit",
  fontSize: 10.5,
  cursor: "pointer",
} as const;
