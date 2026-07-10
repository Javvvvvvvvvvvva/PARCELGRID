"use client";

/**
 * 3D 매싱 — 법규 엔진(정북일조·Buildable Area) 결과를 3D로 증명.
 * 층별 계단식 매스 + 세대수 연동 (층 색상·라벨·클릭 정보 패널).
 *
 * C 설계: 매스는 매스만 (평면 분할은 평면 엔진 완성 후 — 오해 방지).
 * 층 클릭 → 정보 패널 (층·세대수·면적·이격).
 */

import { useMemo, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { calcBuildableArea, type LngLat, type SunStep } from "@/lib/finance/buildable-area";
import { analyzeFrontage, edgeSetbacksFromFrontage } from "@/lib/geo/road-frontage";
import {
  layoutParkingFromBoundary,
  assessPilotiOverlap,
} from "@/lib/geo/parking-layout";

export type RoadLine = { name: string | null; points: [number, number][] };
export type SetbackSpec = { road: number; side: number; rear: number };

/** 위경도 링 → 중심 기준 로컬 미터 좌표 (x=동, z=북 반전) */
function ringToLocalMeters(
  ring: LngLat[],
  origin: LngLat
): { x: number; z: number }[] {
  const [olng, olat] = origin;
  const k = Math.cos((olat * Math.PI) / 180);
  return ring.map(([lng, lat]) => ({
    x: (lng - olng) * 111_000 * k,
    z: -(lat - olat) * 111_000,
  }));
}

function ringCentroid(ring: LngLat[]): LngLat {
  const n = ring.length;
  let lng = 0,
    lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return [lng / n, lat / n];
}

/** 총 세대수를 층별 면적 비례로 배분 (합계 = 총 세대수 보장).
 *  excludeFloor1: 필로티(1층 주차) 시 1층 제외하고 2층 이상에 재배분 — 총 세대수 유지 */
function distributeUnits(
  steps: SunStep[],
  totalUnits: number,
  excludeFloor1 = false
): number[] {
  if (totalUnits <= 0 || steps.length === 0) return steps.map(() => 0);
  const weights = steps.map((st) =>
    excludeFloor1 && st.floor === 1 ? 0 : st.floorPlateSqm
  );
  const totalArea = weights.reduce((s, w) => s + w, 0);
  if (totalArea <= 0) return steps.map(() => 0);
  const raw = weights.map((w) => totalUnits * (w / totalArea));
  const base = raw.map(Math.floor);
  let remain = totalUnits - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && remain > 0; k++) {
    base[order[k].i]++;
    remain--;
  }
  return base;
}

/** 층별 색 (아래 진한 파랑 → 위 밝은 하늘) */
function floorColor(floor: number, total: number): string {
  const t = total <= 1 ? 0 : (floor - 1) / (total - 1);
  // hsl 파랑 계열 명도 변화
  const l = 46 + t * 22; // 46% → 68%
  return `hsl(213, 72%, ${l}%)`;
}

const SQM_PER_PYEONG = 3.305785;

interface FloorMass {
  floor: number;
  baseHeight: number;
  topHeight: number;
  shape: { x: number; z: number }[];
  floorPlateSqm: number;
  requiredSetbackM: number;
  units: number;
  labelPos: { x: number; z: number }; // 라벨 위치 (동쪽 가장자리)
}

function FloorBox({
  mass,
  totalFloors,
  selected,
  hovered,
  onSelect,
  onHover,
}: {
  mass: FloorMass;
  totalFloors: number;
  selected: boolean;
  hovered: boolean;
  onSelect: (floor: number) => void;
  onHover: (floor: number | null) => void;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    mass.shape.forEach((p, i) => {
      if (i === 0) shape.moveTo(p.x, p.z);
      else shape.lineTo(p.x, p.z);
    });
    shape.closePath();
    const h = mass.topHeight - mass.baseHeight;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, mass.baseHeight, 0);
    return geo;
  }, [mass]);

  const color = floorColor(mass.floor, totalFloors);
  const active = selected || hovered;

  return (
    <group>
      <mesh
        geometry={geometry}
        onClick={(e: any) => {
          e.stopPropagation();
          onSelect(mass.floor);
        }}
        onPointerOver={(e: any) => {
          e.stopPropagation();
          onHover(mass.floor);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "default";
        }}
      >
        <meshStandardMaterial
          color={active ? "#f59e0b" : color}
          transparent
          opacity={
            active ? 0.85 : mass.floor === 1 && mass.units === 0 ? 0.15 : 0.6
          }
          roughness={0.55}
          metalness={0.05}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#1e3a5f" transparent opacity={0.4} />
      </lineSegments>
      {/* 층 라벨 — 동쪽 가장자리 바깥 */}
      <Text
        position={[mass.labelPos.x, (mass.baseHeight + mass.topHeight) / 2, mass.labelPos.z]}
        fontSize={1.3}
        color={active ? "#b45309" : "#334155"}
        anchorX="left"
        anchorY="middle"
      >
        {mass.floor === 1 && mass.units === 0
          ? "1F · 필로티 (주차)"
          : `${mass.floor}F · ${mass.units}세대`}
      </Text>
    </group>
  );
}

function ParkingStalls({ shapes }: { shapes: { x: number; z: number }[][] }) {
  return (
    <group>
      {shapes.map((s, i) => {
        const shape = new THREE.Shape();
        s.forEach((p, j) => {
          if (j === 0) shape.moveTo(p.x, p.z);
          else shape.lineTo(p.x, p.z);
        });
        shape.closePath();
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        return (
          <group key={i}>
            <mesh geometry={geo} position={[0, 0.02, 0]}>
              <meshStandardMaterial
                color="#64748b"
                transparent
                opacity={0.35}
                side={THREE.DoubleSide}
              />
            </mesh>
            <lineSegments position={[0, 0.03, 0]}>
              <edgesGeometry args={[geo]} />
              <lineBasicMaterial color="#334155" />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}

function GroundPlate({ shape }: { shape: { x: number; z: number }[] }) {
  const geometry = useMemo(() => {
    const s = new THREE.Shape();
    shape.forEach((p, i) => {
      if (i === 0) s.moveTo(p.x, p.z);
      else s.lineTo(p.x, p.z);
    });
    s.closePath();
    const geo = new THREE.ShapeGeometry(s);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [shape]);

  return (
    <group>
      <mesh geometry={geometry} position={[0, -0.05, 0]}>
        <meshStandardMaterial color="#e2e8f0" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#94a3b8" />
      </lineSegments>
    </group>
  );
}

function NorthArrow({ extent }: { extent: number }) {
  return (
    <group position={[0, 0.1, -extent * 0.75]}>
      <Text
        fontSize={extent * 0.12}
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

export interface FloorInfo {
  floor: number;
  units: number;
  floorPlateSqm: number;
  pyeong: number;
  requiredSetbackM: number;
}

function Scene({
  boundary,
  zoning,
  floors,
  floorHeightM,
  totalUnits,
  roads,
  setback,
  selectedFloor,
  hoveredFloor,
  onSelect,
  onHover,
  onData,
}: {
  boundary: LngLat[];
  zoning: string;
  floors: number;
  floorHeightM: number;
  totalUnits: number;
  roads?: RoadLine[];
  setback?: SetbackSpec;
  selectedFloor: number | null;
  hoveredFloor: number | null;
  onSelect: (floor: number) => void;
  onHover: (floor: number | null) => void;
  onData: (infos: FloorInfo[]) => void;
}) {
  const { masses, groundShape, extent, parkingShapes, pilotiOn } = useMemo(() => {
    const sunApplies = /주거/.test(zoning);
    // 변별 이격 (엔진과 동일 로직 — 도로 접면 기반, 가정값 + 민법 0.5m 하한)
    const frontage =
      roads && roads.length > 0 && setback ? analyzeFrontage(boundary, roads) : null;
    const edgeSetbacks = edgeSetbacksFromFrontage(frontage, setback ?? { road: 0.5, side: 0.5, rear: 0.5 });
    const ba = calcBuildableArea(boundary, 0.5, floors, floorHeightM, sunApplies, edgeSetbacks);
    const origin = ringCentroid(boundary);
    const groundShape = ringToLocalMeters(boundary, origin);

    // 주차 배치 + 필로티 자동 판정 (verdict와 동일 엔진 — 3D 표현용)
    const parkingLayout = frontage
      ? layoutParkingFromBoundary(boundary, frontage.frontIndex, 20)
      : null;
    const groundRingForPiloti =
      ba.stepped3D.length > 0 && ba.stepped3D[0].ringLngLat
        ? ba.stepped3D[0].ringLngLat
        : ba.buildable2DRing;
    const pilotiOn =
      parkingLayout && groundRingForPiloti
        ? assessPilotiOverlap(boundary, parkingLayout, groundRingForPiloti).recommended
        : false;
    const parkingShapes =
      parkingLayout?.spots
        .filter((s) => s.cornersLngLat)
        .map((s) => ringToLocalMeters(s.cornersLngLat as LngLat[], origin)) ?? [];

    const steps = ba.stepped3D.filter((s) => s.ringLngLat);
    const unitsByFloor = distributeUnits(steps, totalUnits, pilotiOn);

    let extent = 10;
    groundShape.forEach((p) => {
      extent = Math.max(extent, Math.abs(p.x), Math.abs(p.z));
    });

    const masses: FloorMass[] = steps.map((step, i) => {
      const shape = ringToLocalMeters(step.ringLngLat as LngLat[], origin);
      const base = (step.floor - 1) * floorHeightM;
      // 라벨 위치: 이 층 형상의 동쪽 최대 x
      let maxX = 0;
      let zAtMax = 0;
      shape.forEach((p) => {
        if (p.x > maxX) {
          maxX = p.x;
          zAtMax = p.z;
        }
      });
      return {
        floor: step.floor,
        baseHeight: base,
        topHeight: base + floorHeightM,
        shape,
        floorPlateSqm: step.floorPlateSqm,
        requiredSetbackM: step.requiredSetbackM,
        units: pilotiOn && step.floor === 1 ? 0 : unitsByFloor[i] ?? 0,
        labelPos: { x: maxX + extent * 0.08, z: zAtMax },
      };
    });

    // 정보 패널용 데이터 부모로
    onData(
      masses.map((m) => ({
        floor: m.floor,
        units: m.units,
        floorPlateSqm: m.floorPlateSqm,
        pyeong: Math.round(m.floorPlateSqm / SQM_PER_PYEONG),
        requiredSetbackM: m.requiredSetbackM,
      }))
    );

    return { masses, groundShape, extent, parkingShapes, pilotiOn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary, zoning, floors, floorHeightM, totalUnits, roads, setback]);

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[extent, extent * 2, extent]} intensity={1.1} />
      <directionalLight position={[-extent, extent, -extent]} intensity={0.4} />

      <GroundPlate shape={groundShape} />
      {parkingShapes.length > 0 && <ParkingStalls shapes={parkingShapes} />}
      {masses.map((m) => (
        <FloorBox
          key={m.floor}
          mass={m}
          totalFloors={masses.length}
          selected={selectedFloor === m.floor}
          hovered={hoveredFloor === m.floor}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
      <NorthArrow extent={extent} />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={extent * 1.2}
        maxDistance={extent * 6}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}

export function MassingView({
  boundary,
  zoning,
  floors,
  units = 0,
  floorHeightM = 3.0,
  roads,
  setback,
  height = 440,
}: {
  boundary: LngLat[] | undefined;
  zoning: string;
  floors: number;
  /** 총 세대수 — 층별 면적 비례 배분해 표시 */
  units?: number;
  floorHeightM?: number;
  /** 도로 중심선 (변별 이격 — 전면 판별용) */
  roads?: RoadLine[];
  /** 이격값 (실무 기본값·가정 — 민법 0.5m 하한 법정) */
  setback?: SetbackSpec;
  height?: number;
}) {
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [hoveredFloor, setHoveredFloor] = useState<number | null>(null);
  const [floorInfos, setFloorInfos] = useState<FloorInfo[]>([]);

  const extent = useMemo(() => {
    if (!boundary || boundary.length < 3) return 10;
    const origin = ringCentroid(boundary);
    const local = ringToLocalMeters(boundary, origin);
    let e = 10;
    local.forEach((p) => (e = Math.max(e, Math.abs(p.x), Math.abs(p.z))));
    return e;
  }, [boundary]);

  if (!boundary || boundary.length < 3) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          color: "var(--fg-subtle)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-sunken)",
        }}
      >
        대지 경계 데이터가 없어 3D를 표시할 수 없습니다
      </div>
    );
  }

  const info =
    selectedFloor != null
      ? floorInfos.find((f) => f.floor === selectedFloor) ?? null
      : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 200px", gap: 12 }}>
      <div
        style={{
          height,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "linear-gradient(180deg, var(--bg-elev), var(--bg-sunken))",
        }}
      >
        <Canvas
          camera={{
            position: [extent * 1.8, extent * 1.8, extent * 2.2],
            fov: 45,
            near: 0.1,
            far: extent * 20,
          }}
          onPointerMissed={() => setSelectedFloor(null)}
        >
          <Suspense fallback={null}>
            <Scene
              boundary={boundary}
              zoning={zoning}
              floors={floors}
              floorHeightM={floorHeightM}
              totalUnits={units}
              roads={roads}
              setback={setback}
              selectedFloor={selectedFloor}
              hoveredFloor={hoveredFloor}
              onSelect={(f) => setSelectedFloor((cur) => (cur === f ? null : f))}
              onHover={setHoveredFloor}
              onData={setFloorInfos}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* 층 정보 패널 */}
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--bg-elev)",
          fontSize: 12.5,
          height,
          overflowY: "auto",
        }}
      >
        {info ? (
          <>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
              {info.floor}층
            </div>
            <PanelRow label="세대수" value={`${info.units}세대`} />
            <PanelRow label="층 면적" value={`${info.floorPlateSqm}㎡ (${info.pyeong}평)`} />
            <PanelRow
              label="정북 이격"
              value={info.requiredSetbackM > 0 ? `${info.requiredSetbackM}m 후퇴` : "없음"}
            />
            {info.units > 0 && (
              <PanelRow
                label="세대당 평균"
                value={`${Math.round(info.floorPlateSqm / info.units)}㎡`}
              />
            )}
            <p style={{ fontSize: 11, color: "var(--fg-faint)", marginTop: 12, lineHeight: 1.5 }}>
              세대 배분은 층 면적 비례 추정입니다. 실제 평면 구성(계단·복도 등)은 설계 단계에서
              결정됩니다.
            </p>
          </>
        ) : (
          <div style={{ color: "var(--fg-subtle)", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--fg-muted)" }}>층 정보</div>
            3D에서 층을 클릭하면
            <br />
            세대수·면적·이격 정보가
            <br />
            표시됩니다
            {floorInfos.length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border-faint, var(--border))", paddingTop: 10 }}>
                {floorInfos
                  .slice()
                  .reverse()
                  .map((f) => (
                    <div
                      key={f.floor}
                      onClick={() => setSelectedFloor(f.floor)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "4px 6px",
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{f.floor}F</span>
                      <span style={{ color: "var(--fg-muted)" }}>
                        {f.units}세대 · {f.pyeong}평
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderBottom: "1px solid var(--border-faint, var(--border))",
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
