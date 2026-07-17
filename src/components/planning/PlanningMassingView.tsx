"use client";

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import "@/lib/three/guard-empty-paths";
import {
  calcBuildableArea,
  type LngLat,
} from "@/lib/finance/buildable-area";
import { analyzeFrontage, edgeSetbacksFromFrontage } from "@/lib/geo/road-frontage";
import {
  buildPlanningMassModel,
  polygonAreaSqm,
  type LocalPlanPoint,
  type PlanningEnvelopeStep,
  type PlanningFloorMass,
  type PlanningMassModel,
} from "@/lib/planning/planning-massing";
import { planningPointToThreeShape } from "@/lib/planning/three-coordinate-contract";
import type {
  FloorUseType,
  PlanningScenario,
} from "@/lib/planning/types";
import type { RoadLine, SetbackSpec } from "@/components/ui/MassingView";
import { num } from "@/lib/utils/format";

const USE_LABEL: Record<FloorUseType | "mixed", string> = {
  residential: "주거",
  retail: "상가",
  office: "업무",
  parking: "주차",
  piloti: "필로티",
  common: "공용",
  mechanical: "기계",
  storage: "창고",
  other: "기타",
  mixed: "복합",
};

const USE_COLOR: Record<FloorUseType | "mixed", string> = {
  residential: "#3b82f6",
  retail: "#f59e0b",
  office: "#8b5cf6",
  parking: "#64748b",
  piloti: "#94a3b8",
  common: "#14b8a6",
  mechanical: "#475569",
  storage: "#78716c",
  other: "#64748b",
  mixed: "#0f766e",
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

function floorUseSummary(mass: PlanningFloorMass): string {
  const uses = [
    ...new Set(
      mass.zones
        .filter((zone) => zone.areaSqm > 0)
        .map((zone) => USE_LABEL[zone.useType])
    ),
  ];
  const unitParts: string[] = [];
  if (mass.residentialUnits > 0) unitParts.push(`${mass.residentialUnits}세대`);
  if (mass.commercialUnits > 0) unitParts.push(`${mass.commercialUnits}실`);
  const useText = uses.length > 0 ? uses.join("+") : "용도 미입력";
  return unitParts.length > 0
    ? `${useText} · ${unitParts.join(" · ")}`
    : useText;
}

function hasRenderableShape(points: LocalPlanPoint[]): boolean {
  return (
    points.length >= 3 &&
    points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z)) &&
    polygonAreaSqm(points) > 0.0001
  );
}

function shapeGeometry(
  points: LocalPlanPoint[],
  baseHeightM: number,
  topHeightM: number
): THREE.BufferGeometry {
  if (!hasRenderableShape(points)) return new THREE.BufferGeometry();
  const shape = new THREE.Shape();
  points.forEach((point, index) => {
    const shapePoint = planningPointToThreeShape(point);
    if (index === 0) shape.moveTo(shapePoint.x, shapePoint.y);
    else shape.lineTo(shapePoint.x, shapePoint.y);
  });
  shape.closePath();
  const depth = Math.max(0.05, topHeightM - baseHeightM);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, baseHeightM, 0);
  return geometry;
}

function FloorMassMesh({
  mass,
  selected,
  hovered,
  extent,
  onSelect,
  onHover,
}: {
  mass: PlanningFloorMass;
  selected: boolean;
  hovered: boolean;
  extent: number;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const renderable = hasRenderableShape(mass.shape);
  const geometry = useMemo(
    () => shapeGeometry(mass.shape, mass.baseHeightM, mass.topHeightM),
    [mass.shape, mass.baseHeightM, mass.topHeightM]
  );
  const labelPoint = useMemo(() => {
    if (mass.shape.length === 0) return { x: 0, z: 0 };
    return mass.shape.reduce(
      (best, point) => (point.x > best.x ? point : best),
      mass.shape[0]
    );
  }, [mass.shape]);
  const active = selected || hovered;
  const lowOpacity =
    mass.level < 0 ||
    mass.dominantUse === "piloti" ||
    mass.dominantUse === "parking";
  const overCapacity = !mass.fitsEnvelope;
  const unsupported = mass.level > 1 && !mass.supportedByLowerFloor;
  const invalid = overCapacity || unsupported;

  if (!renderable) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(mass.id);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(mass.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "default";
        }}
      >
        <meshStandardMaterial
          color={
            unsupported
              ? "#dc2626"
              : active
                ? "#ef4444"
                : overCapacity
                  ? "#dc2626"
                  : USE_COLOR[mass.dominantUse]
          }
          transparent
          opacity={
            unsupported
              ? active
                ? 0.28
                : 0.12
              : active
                ? 0.9
                : lowOpacity
                  ? 0.34
                  : 0.7
          }
          roughness={0.58}
          metalness={0.04}
          wireframe={unsupported}
          side={THREE.DoubleSide}
          depthWrite={!unsupported}
        />
      </mesh>
      <lineSegments geometry={new THREE.EdgesGeometry(geometry)}>
        <lineBasicMaterial
          color={invalid ? "#991b1b" : "#334155"}
          transparent
          opacity={unsupported ? 0.95 : 0.58}
        />
      </lineSegments>
      <Text
        position={[
          labelPoint.x + extent * 0.07,
          (mass.baseHeightM + mass.topHeightM) / 2,
          labelPoint.z,
        ]}
        fontSize={Math.max(0.65, extent * 0.055)}
        color={invalid ? "#991b1b" : "#334155"}
        anchorX="left"
        anchorY="middle"
        maxWidth={extent * 1.1}
      >
        {`${mass.label} · ${floorUseSummary(mass)}${
          unsupported
            ? " · 하부 지지면 부족"
            : overCapacity
              ? " · 면적 초과"
              : ""
        }`}
      </Text>
    </group>
  );
}

function ParcelPlate({ shape }: { shape: LocalPlanPoint[] }) {
  const geometry = useMemo(() => {
    if (!hasRenderableShape(shape)) return new THREE.BufferGeometry();
    const parcelShape = new THREE.Shape();
    shape.forEach((point, index) => {
      const shapePoint = planningPointToThreeShape(point);
      if (index === 0) parcelShape.moveTo(shapePoint.x, shapePoint.y);
      else parcelShape.lineTo(shapePoint.x, shapePoint.y);
    });
    parcelShape.closePath();
    const result = new THREE.ShapeGeometry(parcelShape);
    result.rotateX(-Math.PI / 2);
    return result;
  }, [shape]);

  return (
    <group>
      <mesh geometry={geometry} position={[0, -0.04, 0]}>
        <meshStandardMaterial
          color="#e2e8f0"
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments
        geometry={new THREE.EdgesGeometry(geometry)}
        position={[0, -0.02, 0]}
      >
        <lineBasicMaterial color="#64748b" />
      </lineSegments>
    </group>
  );
}

function NorthArrow({ extent }: { extent: number }) {
  return (
    <group position={[0, 0.08, -extent * 0.86]}>
      <Text
        fontSize={Math.max(0.9, extent * 0.1)}
        color="#dc2626"
        anchorX="center"
        anchorY="middle"
        rotation={[-Math.PI / 2, 0, 0]}
      >
        N
      </Text>
    </group>
  );
}

function PlanningScene({
  groundShape,
  model,
  extent,
  showBasements,
  selectedFloorId,
  hoveredFloorId,
  onSelect,
  onHover,
}: {
  groundShape: LocalPlanPoint[];
  model: PlanningMassModel;
  extent: number;
  showBasements: boolean;
  selectedFloorId: string | null;
  hoveredFloorId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const visibleFloors = showBasements
    ? model.floors
    : model.aboveGroundFloors;

  return (
    <>
      <ambientLight intensity={0.78} />
      <directionalLight
        position={[extent, extent * 2.2, extent]}
        intensity={1.1}
      />
      <directionalLight
        position={[-extent, extent, -extent]}
        intensity={0.35}
      />
      <ParcelPlate shape={groundShape} />
      {visibleFloors.map((mass) => (
        <FloorMassMesh
          key={mass.id}
          mass={mass}
          selected={selectedFloorId === mass.id}
          hovered={hoveredFloorId === mass.id}
          extent={extent}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      <NorthArrow extent={extent} />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={extent * 1.15}
        maxDistance={extent * 7}
        maxPolarAngle={Math.PI / 2.03}
      />
    </>
  );
}

function createPlanningMassData(
  boundary: LngLat[],
  zoning: string,
  scenario: PlanningScenario,
  roads?: RoadLine[],
  setback?: SetbackSpec
): {
  groundShape: LocalPlanPoint[];
  model: PlanningMassModel;
  extent: number;
  warnings: string[];
} {
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
    roads && roads.length > 0 && setback
      ? analyzeFrontage(boundary, roads)
      : null;
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

  let extent = 10;
  [...groundShape, ...model.floors.flatMap((floor) => floor.shape)].forEach(
    (point) => {
      extent = Math.max(extent, Math.abs(point.x), Math.abs(point.z));
    }
  );
  extent = Math.max(
    extent,
    model.totalHeightM * 0.7,
    model.basementDepthM * 0.7
  );

  return {
    groundShape,
    model,
    extent,
    warnings: buildable.warnings,
  };
}

function areaDifferenceLabel(mass: PlanningFloorMass): string {
  if (mass.level > 1 && !mass.supportedByLowerFloor) {
    return `하부 지지 중첩 ${num(mass.supportOverlapRatio * 100, 0)}% · 구조 연결 검토`;
  }
  if (!mass.fitsEnvelope) {
    return `법규 외곽선보다 ${num(mass.capacityShortfallSqm, 1)}㎡ 초과`;
  }
  if (mass.footprintScalePct < 99.5) {
    return `프로그램 면적 기준 ${mass.footprintScalePct.toFixed(0)}% 선형 축척 적용`;
  }
  const absolute = Math.abs(mass.areaDifferencePct);
  if (absolute < 2) return "프로그램 면적과 정합";
  return mass.areaDifferencePct > 0
    ? `3D 외곽선이 프로그램보다 ${absolute.toFixed(0)}% 큼`
    : `3D 외곽선이 프로그램보다 ${absolute.toFixed(0)}% 작음`;
}

function CapacityNotice({ model }: { model: PlanningMassModel }) {
  const capacity = model.capacity;
  const unsupported = model.aboveGroundFloors.filter(
    (floor) => floor.level > 1 && !floor.supportedByLowerFloor
  );
  const areaOk = capacity.allFloorsFit;
  const supportOk = unsupported.length === 0;
  const ok = areaOk && supportOk;
  const title = !areaOk
    ? "층별 프로그램 면적 초과"
    : !supportOk
      ? "상층 하부 지지면 부족"
      : "배치 면적·층간 연결 가능";
  const message = !areaOk
    ? `${capacity.overCapacityFloorCount}개 층이 법규 외곽선보다 총 ${num(capacity.totalShortfallSqm, 1)}㎡ 큽니다. 3D는 현재 가능한 면적까지만 표시합니다.`
    : !supportOk
      ? `${unsupported.map((floor) => floor.label).join(", ")}이 아래층과 충분히 겹치지 않습니다. 빨간 와이어프레임은 확정 매스가 아닌 검토 후보입니다.`
      : "각 층 프로그램 면적이 법규 외곽선 안에 있고 상층이 바로 아래층과 최소 지지 중첩을 확보합니다.";

  return (
    <div
      style={{
        marginBottom: 10,
        padding: "10px 12px",
        borderRadius: 9,
        border: `1px solid ${ok ? "var(--pos-fg)" : "var(--neg-fg)"}`,
        background: ok ? "var(--pos-soft)" : "var(--neg-soft)",
        color: ok ? "var(--pos-fg)" : "var(--neg-fg)",
        fontSize: 10.5,
        lineHeight: 1.5,
      }}
    >
      <strong>{title}</strong>
      <span style={{ marginLeft: 7 }}>{message}</span>
    </div>
  );
}

export function PlanningMassingView({
  boundary,
  zoning,
  scenario,
  roads,
  setback,
  height = 430,
}: {
  boundary?: LngLat[];
  zoning: string;
  scenario: PlanningScenario;
  roads?: RoadLine[];
  setback?: SetbackSpec;
  height?: number;
}) {
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [hoveredFloorId, setHoveredFloorId] = useState<string | null>(null);
  const [showBasements, setShowBasements] = useState(true);

  const data = useMemo(
    () =>
      boundary && boundary.length >= 3
        ? createPlanningMassData(boundary, zoning, scenario, roads, setback)
        : null,
    [boundary, zoning, scenario, roads, setback]
  );

  if (!data) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-sunken)",
          color: "var(--fg-subtle)",
          fontSize: 12,
        }}
      >
        대지 경계 데이터가 없어 계획 3D를 표시할 수 없습니다.
      </div>
    );
  }

  const selectedMass = selectedFloorId
    ? data.model.floors.find((floor) => floor.id === selectedFloorId) ?? null
    : null;
  const visibleFloors = showBasements
    ? data.model.floors
    : data.model.aboveGroundFloors;

  return (
    <div>
      <CapacityNotice model={data.model} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
          프로그램 면적 자동 맞춤 · 층고 · 평면 축척 · 북측 후퇴 · 계획 위치 반영
        </div>
        {data.model.basementFloors.length > 0 && (
          <button
            type="button"
            onClick={() => setShowBasements((value) => !value)}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "5px 8px",
              background: showBasements
                ? "var(--bg-sunken)"
                : "var(--bg-elev)",
              color: "var(--fg-muted)",
              fontSize: 10.5,
              cursor: "pointer",
            }}
          >
            {showBasements ? "지하 숨기기" : "지하 보기"}
          </button>
        )}
      </div>

      <div className="planning-massing-layout">
        <div
          style={{
            height,
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            background:
              "linear-gradient(180deg, var(--bg-elev), var(--bg-sunken))",
          }}
        >
          <Canvas
            camera={{
              position: [
                data.extent * 1.8,
                data.extent * 1.8,
                data.extent * 2.2,
              ],
              fov: 45,
              near: 0.1,
              far: data.extent * 25,
            }}
            onPointerMissed={() => setSelectedFloorId(null)}
          >
            <Suspense fallback={null}>
              <PlanningScene
                groundShape={data.groundShape}
                model={data.model}
                extent={data.extent}
                showBasements={showBasements}
                selectedFloorId={selectedFloorId}
                hoveredFloorId={hoveredFloorId}
                onSelect={(id) =>
                  setSelectedFloorId((current) =>
                    current === id ? null : id
                  )
                }
                onHover={setHoveredFloorId}
              />
            </Suspense>
          </Canvas>
        </div>

        <aside
          style={{
            height,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--bg-elev)",
            padding: 12,
          }}
        >
          {selectedMass ? (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: 15 }}>{selectedMass.label}</strong>
                <span className="ui-tag">
                  {USE_LABEL[selectedMass.dominantUse]}
                </span>
                <span
                  className="ui-tag"
                  style={{
                    color:
                      selectedMass.fitsEnvelope &&
                      selectedMass.supportedByLowerFloor
                        ? "var(--pos-fg)"
                        : "var(--neg-fg)",
                  }}
                >
                  {!selectedMass.fitsEnvelope
                    ? "면적 초과"
                    : selectedMass.level > 1 &&
                        !selectedMass.supportedByLowerFloor
                      ? "하부 지지 부족"
                      : "배치 가능"}
                </span>
              </div>
              <p
                style={{
                  margin: "5px 0 10px",
                  fontSize: 10.5,
                  color: "var(--fg-muted)",
                }}
              >
                {floorUseSummary(selectedMass)}
              </p>
              <InfoRow
                label="프로그램 면적"
                value={`${num(selectedMass.programAreaSqm, 1)}㎡`}
              />
              <InfoRow
                label="법규상 최대 외곽선"
                value={`${num(selectedMass.envelopeAreaSqm, 1)}㎡`}
              />
              <InfoRow
                label="3D 반영 면적"
                value={`${num(selectedMass.visualAreaSqm, 1)}㎡`}
              />
              <InfoRow
                label="배치 판정"
                value={areaDifferenceLabel(selectedMass)}
              />
              {selectedMass.level > 1 && (
                <InfoRow
                  label="하부 지지 중첩"
                  value={`${num(selectedMass.supportOverlapRatio * 100, 0)}%`}
                />
              )}
              <InfoRow
                label="층고"
                value={`${selectedMass.floorHeightM.toFixed(1)}m`}
              />
              <InfoRow
                label="사용자 평면 축척"
                value={`${selectedMass.footprintScalePct.toFixed(0)}%`}
              />
              <InfoRow
                label="법규 외곽선 대비 실제 축척"
                value={`${selectedMass.appliedScalePct.toFixed(0)}%`}
              />
              <InfoRow
                label="북측 후퇴"
                value={`${(
                  scenario.placement.northSetbackM +
                  selectedMass.northSetbackM
                ).toFixed(1)}m`}
              />
              <InfoRow
                label="법규 엔진 이격"
                value={
                  selectedMass.requiredSetbackM > 0
                    ? `${selectedMass.requiredSetbackM.toFixed(1)}m`
                    : "없음"
                }
              />
              <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                {selectedMass.zones.map((zone, index) => (
                  <div
                    key={`${selectedMass.id}-${zone.useType}-${index}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "7px 8px",
                      borderRadius: 7,
                      background: "var(--bg-sunken)",
                      fontSize: 10.5,
                    }}
                  >
                    <span>{USE_LABEL[zone.useType]}</span>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {num(zone.areaSqm, 0)}㎡
                      {zone.unitCount > 0
                        ? ` · ${zone.unitCount}${
                            zone.useType === "residential" ? "세대" : "실"
                          }`
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}
              >
                층 선택
              </div>
              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 10.5,
                  lineHeight: 1.5,
                  color: "var(--fg-muted)",
                }}
              >
                3D 매스 또는 아래 층 목록을 누르면 층별 프로그램과 법규 외곽선 수용 여부를 확인할 수 있습니다.
              </p>
              <div style={{ display: "grid", gap: 5 }}>
                {[...visibleFloors]
                  .sort((a, b) => b.level - a.level)
                  .map((mass) => {
                    const unsupported =
                      mass.level > 1 && !mass.supportedByLowerFloor;
                    const invalid = !mass.fitsEnvelope || unsupported;
                    return (
                      <button
                        type="button"
                        key={mass.id}
                        onClick={() => setSelectedFloorId(mass.id)}
                        style={{
                          width: "100%",
                          border: `1px solid ${
                            invalid
                              ? "var(--neg-fg)"
                              : "var(--border-faint, var(--border))"
                          }`,
                          borderRadius: 7,
                          padding: "7px 8px",
                          background: invalid
                            ? "var(--neg-soft)"
                            : "var(--bg-elev)",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          color: "var(--fg)",
                          fontFamily: "inherit",
                          fontSize: 10.5,
                          cursor: "pointer",
                        }}
                      >
                        <strong>{mass.label}</strong>
                        <span
                          style={{
                            color: invalid
                              ? "var(--neg-fg)"
                              : "var(--fg-muted)",
                          }}
                        >
                          {!mass.fitsEnvelope
                            ? `${num(mass.capacityShortfallSqm, 1)}㎡ 초과`
                            : unsupported
                              ? `하부 중첩 ${num(mass.supportOverlapRatio * 100, 0)}%`
                              : floorUseSummary(mass)}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </aside>
      </div>

      {data.warnings.length > 0 && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 10,
            lineHeight: 1.45,
            color: "var(--warn-fg)",
          }}
        >
          건축가능영역 엔진: {data.warnings.join(" · ")}
        </p>
      )}
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 10,
          lineHeight: 1.45,
          color: "var(--fg-faint)",
        }}
      >
        프로그램 면적이 법규 외곽선 안에 들어오면 3D를 해당 면적에 자동 맞춥니다. 아래층과 충분히 겹치지 않는 상층은 빨간 와이어프레임 후보로 표시하며 대표안 확정 전에 구조 전이 또는 배치 조정이 필요합니다. 정북일조와 구조 적합성은 인허가·구조설계 단계에서 최종 확인해야 합니다.
      </p>

      <style jsx>{`
        .planning-massing-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 230px;
          gap: 10px;
        }
        @media (max-width: 760px) {
          .planning-massing-layout {
            grid-template-columns: 1fr;
          }
          .planning-massing-layout aside {
            height: auto !important;
            max-height: 340px;
          }
        }
      `}</style>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--border-faint, var(--border))",
        fontSize: 10.5,
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <span style={{ fontWeight: 650, textAlign: "right" }}>{value}</span>
    </div>
  );
}
