"use client";

/**
 * Stage 1 — 기존 건물 개략 매스.
 *
 * 건축물대장의 면적·층수·높이를 사용하되 실제 건물 외곽선과 위치 데이터는
 * 제공되지 않으므로 대지 형상을 건폐율 비율로 축소한 개략 배치로 표현한다.
 * 도로는 V월드 도로 중심선 중 대상지와 가장 가까운 선을 개략 리본으로 표시한다.
 */

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Edges, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import { projectPolygon } from "@/lib/geo/project-polygon";
import { useProjectStore } from "@/lib/stores/project-store";

type LngLat = [number, number];
type Pt = { x: number; z: number };
type RoadInput = { name: string | null; points: LngLat[] };
type LocalRoad = { name: string | null; points: Pt[]; distanceM: number };

const FLOOR_GAP = 0.06;
const GRADE_Y = 0.08;
const LOT_COLOR = "#e8e1d5";
const LOT_EDGE = "#9a8767";
const BUILDING_COLOR = "#d9e0e5";
const BUILDING_EDGE = "#64748b";
const BASEMENT_COLOR = "#566371";
const ROAD_COLOR = "#59636e";
const ROAD_CENTER_COLOR = "#d8dde1";
const SCHEMATIC_ROAD_WIDTH_M = 1.45;
const FRONT_ROAD_MAX_DISTANCE_M = 12;

function openRing(boundary: LngLat[]): LngLat[] {
  if (
    boundary.length > 1 &&
    boundary[0][0] === boundary[boundary.length - 1][0] &&
    boundary[0][1] === boundary[boundary.length - 1][1]
  ) {
    return boundary.slice(0, -1);
  }
  return boundary;
}

function ringCentroidPt(ring: Pt[]): Pt {
  const sum = ring.reduce(
    (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
    { x: 0, z: 0 }
  );
  return { x: sum.x / ring.length, z: sum.z / ring.length };
}

function boundaryToLocalRing(
  boundary: LngLat[]
): { ring: Pt[]; center: { lng: number; lat: number } } | null {
  const open = openRing(boundary);
  if (open.length < 3) return null;
  const projected = projectPolygon([...open, open[0]] as LngLat[]);
  if (!projected) return null;

  const openPoints =
    projected.points.length > 1 &&
    projected.points[0][0] === projected.points[projected.points.length - 1][0] &&
    projected.points[0][1] === projected.points[projected.points.length - 1][1]
      ? projected.points.slice(0, -1)
      : projected.points;

  return {
    ring: openPoints.map(([x, y]) => ({ x, z: -y })),
    center: projected.center,
  };
}

function projectRoadPoint(point: LngLat, center: { lng: number; lat: number }): Pt {
  const lngMetersPerDeg = 111320 * Math.cos((center.lat * Math.PI) / 180);
  return {
    x: (point[0] - center.lng) * lngMetersPerDeg,
    z: -(point[1] - center.lat) * 110540,
  };
}

function distanceOriginToSegment(a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, (-a.x * dx - a.z * dz) / lengthSq)) : 0;
  return Math.hypot(a.x + t * dx, a.z + t * dz);
}

function findPrimaryRoad(boundary: LngLat[], roads: RoadInput[]): LocalRoad | null {
  const local = boundaryToLocalRing(boundary);
  if (!local || roads.length === 0) return null;

  let selected: LocalRoad | null = null;
  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    const points = road.points.map((point) => projectRoadPoint(point, local.center));
    let distanceM = Infinity;
    for (let index = 0; index < points.length - 1; index++) {
      distanceM = Math.min(
        distanceM,
        distanceOriginToSegment(points[index], points[index + 1])
      );
    }
    if (!selected || distanceM < selected.distanceM) {
      selected = { name: road.name, points, distanceM };
    }
  }

  return selected && selected.distanceM <= FRONT_ROAD_MAX_DISTANCE_M ? selected : null;
}

function scaleRingTowardCenter(ring: Pt[], areaRatio: number): Pt[] {
  const factor = Math.sqrt(Math.max(0.04, Math.min(1, areaRatio)));
  const center = ringCentroidPt(ring);
  return ring.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    z: center.z + (point.z - center.z) * factor,
  }));
}

function extrudeShape(ring: Pt[], depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function SubjectLot({ ring, cutaway }: { ring: Pt[]; cutaway: boolean }) {
  const geometry = useMemo(() => extrudeShape(ring, 0.12), [ring]);
  return (
    <mesh geometry={geometry} receiveShadow position={[0, GRADE_Y, 0]}>
      <meshStandardMaterial
        color={LOT_COLOR}
        transparent={cutaway}
        opacity={cutaway ? 0.34 : 1}
        roughness={0.92}
        metalness={0}
      />
      <Edges threshold={10} color={LOT_EDGE} />
    </mesh>
  );
}

function FloorMass({
  ring,
  baseY,
  height,
  kind,
}: {
  ring: Pt[];
  baseY: number;
  height: number;
  kind: "above" | "below";
}) {
  const geometry = useMemo(() => extrudeShape(ring, height), [ring, height]);
  return (
    <mesh geometry={geometry} position={[0, baseY, 0]} castShadow receiveShadow>
      <meshStandardMaterial
        color={kind === "below" ? BASEMENT_COLOR : BUILDING_COLOR}
        roughness={kind === "below" ? 0.72 : 0.78}
        metalness={0}
      />
      <Edges threshold={12} color={kind === "below" ? "#263442" : BUILDING_EDGE} />
    </mesh>
  );
}

function RoadRibbon({ road, extent }: { road: LocalRoad; extent: number }) {
  const segments = useMemo(() => {
    const result: { key: string; x: number; z: number; length: number; angle: number }[] = [];
    for (let index = 0; index < road.points.length - 1; index++) {
      const a = road.points[index];
      const b = road.points[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      if (length < 0.1 || Math.hypot(x, z) > extent * 2.3) continue;
      result.push({
        key: `${index}-${x.toFixed(2)}-${z.toFixed(2)}`,
        x,
        z,
        length,
        angle: -Math.atan2(dz, dx),
      });
    }
    return result;
  }, [road, extent]);

  return (
    <group>
      {segments.map((segment) => (
        <group
          key={segment.key}
          position={[segment.x, 0.025, segment.z]}
          rotation={[0, segment.angle, 0]}
        >
          <mesh receiveShadow>
            <boxGeometry args={[segment.length, 0.055, SCHEMATIC_ROAD_WIDTH_M]} />
            <meshStandardMaterial color={ROAD_COLOR} roughness={0.94} metalness={0} />
          </mesh>
          <mesh position={[0, 0.034, 0]}>
            <boxGeometry args={[segment.length, 0.018, 0.055]} />
            <meshBasicMaterial color={ROAD_CENTER_COLOR} transparent opacity={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function NorthMarker({ extent }: { extent: number }) {
  const origin = useMemo(
    () => new THREE.Vector3(extent * 0.62, 0.28, extent * 0.55),
    [extent]
  );
  const arrowLength = Math.max(2.2, extent * 0.25);
  const arrow = useMemo(
    () =>
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, -1),
        origin,
        arrowLength,
        "#334155",
        0.55,
        0.28
      ),
    [arrowLength, origin]
  );

  return (
    <group>
      <primitive object={arrow} />
      <Html
        position={[origin.x, origin.y + 0.2, origin.z - arrowLength - 0.3]}
        center
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            padding: "3px 6px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(100,116,139,0.38)",
            color: "#334155",
            fontSize: 10,
            fontWeight: 800,
            lineHeight: 1,
          }}
        >
          N
        </div>
      </Html>
    </group>
  );
}

function SceneContent({
  boundary,
  roads,
  currentBuilding,
  lotArea,
  showBasement,
}: {
  boundary: LngLat[];
  roads: RoadInput[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
  showBasement: boolean;
}) {
  const main =
    currentBuilding?.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding?.buildings[0];
  const local = useMemo(() => boundaryToLocalRing(boundary), [boundary]);
  const lotRing = local?.ring ?? [];
  const primaryRoad = useMemo(() => findPrimaryRoad(boundary, roads), [boundary, roads]);
  const footprint = useMemo(() => {
    if (lotRing.length < 3) return [];
    const ratio =
      main && main.buildingArea > 0 && lotArea > 0
        ? main.buildingArea / lotArea
        : main?.buildingCoverage
          ? main.buildingCoverage / 100
          : 0.6;
    return scaleRingTowardCenter(lotRing, ratio);
  }, [lotRing, main, lotArea]);

  const extent = useMemo(() => {
    let value = 8;
    lotRing.forEach((point) => {
      value = Math.max(value, Math.hypot(point.x, point.z) + 2.5);
    });
    return value;
  }, [lotRing]);

  const groundFloors = main?.groundFloors ?? 0;
  const basementFloors = main?.undergroundFloors ?? 0;
  const floorHeight = currentBuilding ? estimateFloorHeightM(currentBuilding) ?? 3 : 3;
  const aboveHeight =
    main && main.height > 0 && groundFloors > 0 ? main.height : groundFloors * floorHeight;

  const aboveSlabs = useMemo(() => {
    if (groundFloors <= 0 || aboveHeight <= 0) return [];
    const slabHeight =
      (aboveHeight - FLOOR_GAP * Math.max(0, groundFloors - 1)) / groundFloors;
    return Array.from({ length: groundFloors }, (_, index) => ({
      floor: index + 1,
      baseY: GRADE_Y + 0.12 + index * (slabHeight + FLOOR_GAP),
      height: slabHeight,
    }));
  }, [groundFloors, aboveHeight]);

  const belowSlabs = useMemo(() => {
    if (!showBasement || basementFloors <= 0) return [];
    return Array.from({ length: basementFloors }, (_, index) => ({
      floor: index + 1,
      baseY: GRADE_Y - (index + 1) * floorHeight,
      height: floorHeight - FLOOR_GAP,
    }));
  }, [showBasement, basementFloors, floorHeight]);

  if (lotRing.length < 3) return null;

  return (
    <>
      <color attach="background" args={["#f7f8f9"]} />
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#ffffff", "#d3d8dc", 0.8]} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.25}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
        <planeGeometry args={[extent * 3.1, extent * 3.1]} />
        <shadowMaterial transparent opacity={0.06} />
      </mesh>
      <gridHelper args={[extent * 2.6, 18, "#d7dde1", "#eaedef"]} position={[0, 0, 0]} />

      {primaryRoad && <RoadRibbon road={primaryRoad} extent={extent} />}
      <SubjectLot ring={lotRing} cutaway={showBasement} />
      {belowSlabs.map((slab) => (
        <FloorMass key={`b${slab.floor}`} ring={footprint} {...slab} kind="below" />
      ))}
      {aboveSlabs.map((slab) => (
        <FloorMass key={`a${slab.floor}`} ring={footprint} {...slab} kind="above" />
      ))}
      <NorthMarker extent={extent} />

      <ContactShadows
        position={[0, 0.02, 0]}
        opacity={0.2}
        scale={extent * 1.7}
        blur={2.5}
        far={extent * 2}
      />
      <OrbitControls
        makeDefault
        enableRotate
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.72}
        minDistance={extent * 0.8}
        maxDistance={extent * 3.2}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, Math.max(0.8, aboveHeight * 0.32), 0]}
      />
    </>
  );
}

function ModelHud({
  groundFloors,
  basementFloors,
  buildingAreaSqm,
  bcrPct,
  roadName,
}: {
  groundFloors: number;
  basementFloors: number;
  buildingAreaSqm: number;
  bcrPct: number;
  roadName: string | null;
}) {
  const labels = [
    "개략 형상",
    `지상 ${groundFloors}층`,
    ...(basementFloors > 0 ? [`지하 ${basementFloors}층`] : []),
    ...(roadName !== null ? [roadName || "전면도로"] : []),
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        pointerEvents: "none",
      }}
    >
      {labels.map((label) => (
        <span
          key={label}
          style={{
            padding: "5px 8px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.94)",
            border: "1px solid rgba(148,163,184,0.42)",
            color: "#475569",
            fontSize: 11,
            fontWeight: 600,
            boxShadow: "0 1px 4px rgba(15,23,42,0.05)",
          }}
        >
          {label}
        </span>
      ))}
      <div
        style={{
          flexBasis: "100%",
          width: "fit-content",
          padding: "7px 9px",
          borderRadius: 7,
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(148,163,184,0.34)",
          color: "#64748b",
          fontSize: 11,
          lineHeight: 1.5,
        }}
      >
        건축면적 {buildingAreaSqm.toFixed(1)}㎡ · 건폐율 {bcrPct.toFixed(1)}%
      </div>
    </div>
  );
}

export function ExistingBuildingMass({
  boundary,
  roads = [],
  currentBuilding,
  lotArea,
  height = 360,
}: {
  boundary?: LngLat[];
  roads?: RoadInput[];
  currentBuilding?: BuildingLookupResult | null;
  lotArea: number;
  height?: number;
}) {
  const storedRoads = useProjectStore((state) => state.data?.parcel.roads ?? []);
  const resolvedRoads = roads.length > 0 ? roads : storedRoads;
  const [showBasement, setShowBasement] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);

  const hasBuilding = Boolean(
    currentBuilding?.hasBuilding && (currentBuilding.buildings.length ?? 0) > 0
  );
  const main =
    currentBuilding?.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding?.buildings[0];
  const openBoundary = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    return openRing(boundary);
  }, [boundary]);
  const primaryRoad = useMemo(
    () => (openBoundary ? findPrimaryRoad(openBoundary, resolvedRoads) : null),
    [openBoundary, resolvedRoads]
  );
  const ratios = useMemo(() => {
    if (!main || lotArea <= 0) return undefined;
    const bcrFromArea = (main.buildingArea / lotArea) * 100;
    return {
      bcrPct: main.buildingCoverage > 0 ? main.buildingCoverage : bcrFromArea,
      buildingAreaSqm: main.buildingArea,
    };
  }, [main, lotArea]);
  const extent = useMemo(() => {
    if (!openBoundary) return 12;
    const local = boundaryToLocalRing(openBoundary);
    if (!local) return 12;
    return local.ring.reduce(
      (value, point) => Math.max(value, Math.hypot(point.x, point.z) + 2.5),
      8
    );
  }, [openBoundary]);

  if (!openBoundary || openBoundary.length < 3) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          background: "var(--bg-sunken)",
          borderRadius: 10,
          color: "var(--fg-muted)",
          fontSize: 13,
          border: "1px solid var(--border)",
        }}
      >
        필지 경계 데이터가 없어 3D를 표시할 수 없습니다.
      </div>
    );
  }

  const cameraDistance = extent * 1.3;

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: 10,
        overflow: "hidden",
        background: "#f7f8f9",
        border: "1px solid #dfe4e8",
      }}
    >
      <Canvas
        key={canvasKey}
        shadows
        dpr={[1, 1.5]}
        style={{ cursor: "grab", touchAction: "none" }}
        camera={{ position: [cameraDistance, cameraDistance * 0.72, cameraDistance], fov: 35 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            boundary={openBoundary}
            roads={resolvedRoads}
            currentBuilding={hasBuilding ? currentBuilding : null}
            lotArea={lotArea}
            showBasement={showBasement}
          />
        </Suspense>
      </Canvas>

      {hasBuilding && main && ratios && (
        <ModelHud
          groundFloors={main.groundFloors}
          basementFloors={main.undergroundFloors}
          buildingAreaSqm={ratios.buildingAreaSqm}
          bcrPct={ratios.bcrPct}
          roadName={primaryRoad ? primaryRoad.name ?? "" : null}
        />
      )}

      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
        {hasBuilding && (main?.undergroundFloors ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setShowBasement((value) => !value)}
            style={controlStyle(showBasement)}
          >
            {showBasement ? "지하 숨기기" : "지하 보기"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCanvasKey((value) => value + 1)}
          style={controlStyle(false)}
        >
          시점 초기화
        </button>
      </div>

      {!hasBuilding && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            padding: "7px 10px",
            background: "rgba(255,255,255,0.95)",
            borderRadius: 7,
            fontSize: 12,
            color: "var(--fg-muted)",
            border: "1px solid #dfe4e8",
            pointerEvents: "none",
          }}
        >
          건축물대장에 등록된 현재 건물 없음
        </div>
      )}

      {hasBuilding && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            maxWidth: 340,
            padding: "7px 9px",
            borderRadius: 7,
            background: "rgba(255,255,255,0.94)",
            border: "1px solid rgba(148,163,184,0.34)",
            color: "#64748b",
            fontSize: 10.5,
            lineHeight: 1.45,
            pointerEvents: "none",
          }}
        >
          대지·건물은 개략 형상이며, 도로는 V월드 중심선 관계를 보여주는 상징적 폭입니다. 실제 건물 위치와 도로 폭은 다를 수 있습니다.
        </div>
      )}
    </div>
  );
}

function controlStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 9px",
    borderRadius: 7,
    border: active ? "1px solid #334155" : "1px solid rgba(148,163,184,0.48)",
    background: active ? "#334155" : "rgba(255,255,255,0.94)",
    color: active ? "#ffffff" : "#475569",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(15,23,42,0.06)",
  };
}
