"use client";

/**
 * Stage 1 — 기존 건물 현황 매스.
 *
 * 우선순위:
 *   1. VWorld GIS건물통합정보(dt_d010)의 실제 건물 외곽선·위치
 *   2. 데이터가 없으면 기존 방식(필지 형상 × 건폐율)의 개략 매스 fallback
 *
 * 대상 필지 주변의 dt_d010 건물은 방향 판단을 위한 반투명 컨텍스트로만 표시한다.
 * 높이 방향은 건축물대장 또는 dt_d010의 층수·높이 속성을 사용하며,
 * 층별 후퇴·지붕·출입구·창호는 현황 도면이 없으므로 표현하지 않는다.
 */

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Edges, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import {
  getExistingBuildingGeometry,
  type BuildingPolygon,
  type ExistingBuildingFootprint,
  type LngLat,
} from "@/lib/geo/existing-building-geometry";
import { projectPolygon } from "@/lib/geo/project-polygon";
import { useProjectStore } from "@/lib/stores/project-store";

type Pt = { x: number; z: number };
type LocalPolygon = Pt[][];
type RoadInput = { name: string | null; points: LngLat[] };
type LocalRoad = { name: string | null; points: Pt[]; distanceM: number };

type BuildingModel = {
  key: string;
  polygons: LocalPolygon[];
  groundFloors: number;
  undergroundFloors: number;
  totalHeightM: number;
  footprintAreaSqm: number;
};

const FLOOR_GAP = 0.06;
const GRADE_Y = 0.08;
const LOT_COLOR = "#e8e1d5";
const LOT_EDGE = "#9a8767";
const BUILDING_COLOR = "#d9e0e5";
const BUILDING_EDGE = "#64748b";
const BASEMENT_COLOR = "#566371";
const CONTEXT_BUILDING_COLOR = "#7f8c99";
const CONTEXT_BUILDING_OPACITY = 0.1;
const ROAD_COLOR = "#59636e";
const ROAD_CENTER_COLOR = "#d8dde1";
const SCHEMATIC_ROAD_WIDTH_M = 1.45;
const FRONT_ROAD_MAX_DISTANCE_M = 12;
const MAX_CONTEXT_HEIGHT_M = 24;

function openRing<T extends [number, number] | Pt>(ring: T[]): T[] {
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const firstX = "x" in first ? first.x : first[0];
  const firstY = "z" in first ? first.z : first[1];
  const lastX = "x" in last ? last.x : last[0];
  const lastY = "z" in last ? last.z : last[1];
  return firstX === lastX && firstY === lastY ? ring.slice(0, -1) : ring;
}

function ringCentroidPt(ring: Pt[]): Pt {
  const open = openRing(ring);
  const sum = open.reduce(
    (acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }),
    { x: 0, z: 0 }
  );
  return { x: sum.x / open.length, z: sum.z / open.length };
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

function projectLngLat(point: LngLat, center: { lng: number; lat: number }): Pt {
  const lngMetersPerDeg = 111_320 * Math.cos((center.lat * Math.PI) / 180);
  return {
    x: (point[0] - center.lng) * lngMetersPerDeg,
    z: -(point[1] - center.lat) * 110_540,
  };
}

function projectBuildingPolygon(
  polygon: BuildingPolygon,
  center: { lng: number; lat: number }
): LocalPolygon {
  return polygon
    .map((ring) => openRing(ring).map((point) => projectLngLat(point, center)))
    .filter((ring) => ring.length >= 3);
}

function distanceOriginToSegment(a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq > 0
      ? Math.max(0, Math.min(1, (-a.x * dx - a.z * dz) / lengthSq))
      : 0;
  return Math.hypot(a.x + t * dx, a.z + t * dz);
}

function findPrimaryRoad(boundary: LngLat[], roads: RoadInput[]): LocalRoad | null {
  const local = boundaryToLocalRing(boundary);
  if (!local || roads.length === 0) return null;

  let selected: LocalRoad | null = null;
  for (const road of roads) {
    if (!road.points || road.points.length < 2) continue;
    const points = road.points.map((point) => projectLngLat(point, local.center));
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

function extrudePolygon(polygon: LocalPolygon, depth: number): THREE.ExtrudeGeometry {
  const outer = polygon[0] ?? [];
  const shape = new THREE.Shape();
  outer.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();

  for (const holeRing of polygon.slice(1)) {
    const hole = new THREE.Path();
    holeRing.forEach((point, index) => {
      if (index === 0) hole.moveTo(point.x, point.z);
      else hole.lineTo(point.x, point.z);
    });
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function SubjectLot({ ring, cutaway }: { ring: Pt[]; cutaway: boolean }) {
  const geometry = useMemo(() => extrudePolygon([ring], 0.12), [ring]);
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
  polygon,
  baseY,
  height,
  kind,
}: {
  polygon: LocalPolygon;
  baseY: number;
  height: number;
  kind: "above" | "below";
}) {
  const geometry = useMemo(() => extrudePolygon(polygon, height), [polygon, height]);
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

function ContextMass({ polygon, height }: { polygon: LocalPolygon; height: number }) {
  const resolvedHeight = Math.max(2.6, Math.min(MAX_CONTEXT_HEIGHT_M, height));
  const geometry = useMemo(
    () => extrudePolygon(polygon, resolvedHeight),
    [polygon, resolvedHeight]
  );
  return (
    <mesh geometry={geometry} position={[0, GRADE_Y + 0.04, 0]} renderOrder={0}>
      <meshStandardMaterial
        color={CONTEXT_BUILDING_COLOR}
        transparent
        opacity={CONTEXT_BUILDING_OPACITY}
        depthWrite={false}
        roughness={1}
        metalness={0}
        side={THREE.DoubleSide}
      />
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

function modelFromFootprint(
  footprint: ExistingBuildingFootprint,
  center: { lng: number; lat: number },
  fallbackFloorHeight: number,
  fallbackBuilding: BuildingLookupResult["buildings"][number] | undefined
): BuildingModel | null {
  const polygons = footprint.polygons
    .map((polygon) => projectBuildingPolygon(polygon, center))
    .filter((polygon) => polygon.length > 0 && polygon[0].length >= 3);
  if (polygons.length === 0) return null;

  const groundFloors = Math.max(
    1,
    footprint.groundFloors || fallbackBuilding?.groundFloors || 1
  );
  const undergroundFloors = Math.max(
    0,
    footprint.undergroundFloors || fallbackBuilding?.undergroundFloors || 0
  );
  const totalHeightM =
    footprint.heightM > 0
      ? footprint.heightM
      : fallbackBuilding && fallbackBuilding.height > 0
        ? fallbackBuilding.height
        : groundFloors * fallbackFloorHeight;

  return {
    key: footprint.id,
    polygons,
    groundFloors,
    undergroundFloors,
    totalHeightM,
    footprintAreaSqm: footprint.footprintAreaSqm,
  };
}

function modelExtent(models: BuildingModel[], initial: number): number {
  let value = initial;
  for (const model of models) {
    for (const polygon of model.polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          value = Math.max(value, Math.hypot(point.x, point.z) + 2.5);
        }
      }
    }
  }
  return value;
}

function SceneContent({
  boundary,
  roads,
  currentBuilding,
  lotArea,
  showBasement,
  showContext,
}: {
  boundary: LngLat[];
  roads: RoadInput[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
  showBasement: boolean;
  showContext: boolean;
}) {
  const main =
    currentBuilding?.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding?.buildings[0];
  const geometry = getExistingBuildingGeometry(currentBuilding);
  const local = useMemo(() => boundaryToLocalRing(boundary), [boundary]);
  const lotRing = local?.ring ?? [];
  const primaryRoad = useMemo(() => findPrimaryRoad(boundary, roads), [boundary, roads]);
  const floorHeight = currentBuilding ? estimateFloorHeightM(currentBuilding) ?? 3 : 3;

  const models = useMemo(() => {
    if (!local || lotRing.length < 3) return [];

    if (geometry?.status === "matched" && geometry.footprints.length > 0) {
      return geometry.footprints
        .map((footprint, index) =>
          modelFromFootprint(
            footprint,
            local.center,
            floorHeight,
            currentBuilding?.buildings[index] ?? main
          )
        )
        .filter((model): model is BuildingModel => model !== null);
    }

    if (!main) return [];
    const ratio =
      main.buildingArea > 0 && lotArea > 0
        ? main.buildingArea / lotArea
        : main.buildingCoverage > 0
          ? main.buildingCoverage / 100
          : 0.6;
    const footprint = scaleRingTowardCenter(lotRing, ratio);
    return [
      {
        key: "schematic-main",
        polygons: [[footprint]],
        groundFloors: Math.max(1, main.groundFloors),
        undergroundFloors: Math.max(0, main.undergroundFloors),
        totalHeightM:
          main.height > 0 ? main.height : Math.max(1, main.groundFloors) * floorHeight,
        footprintAreaSqm: main.buildingArea,
      },
    ];
  }, [geometry, floorHeight, currentBuilding, local, lotArea, lotRing, main]);

  const contextModels = useMemo(() => {
    if (!local || !showContext || !geometry?.contextFootprints?.length) return [];
    return geometry.contextFootprints
      .map((footprint) => modelFromFootprint(footprint, local.center, 3, undefined))
      .filter((model): model is BuildingModel => model !== null);
  }, [geometry, local, showContext]);

  const subjectExtent = useMemo(() => {
    let value = 8;
    lotRing.forEach((point) => {
      value = Math.max(value, Math.hypot(point.x, point.z) + 2.5);
    });
    return modelExtent(models, value);
  }, [lotRing, models]);

  const extent = useMemo(() => {
    if (!showContext || contextModels.length === 0) return subjectExtent;
    const fullContextExtent = modelExtent(contextModels, subjectExtent);
    const contextFrameLimit = Math.max(subjectExtent * 2.8, 28);
    return Math.min(fullContextExtent, contextFrameLimit);
  }, [contextModels, showContext, subjectExtent]);

  const maxHeight = models.reduce((max, model) => Math.max(max, model.totalHeightM), 0);
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

      {showContext &&
        contextModels.flatMap((model) =>
          model.polygons.map((polygon, polygonIndex) => (
            <ContextMass
              key={`context-${model.key}-${polygonIndex}`}
              polygon={polygon}
              height={model.totalHeightM}
            />
          ))
        )}

      {primaryRoad && <RoadRibbon road={primaryRoad} extent={extent} />}
      <SubjectLot ring={lotRing} cutaway={showBasement} />

      {models.flatMap((model) => {
        const slabHeight =
          (model.totalHeightM - FLOOR_GAP * Math.max(0, model.groundFloors - 1)) /
          model.groundFloors;
        return model.polygons.flatMap((polygon, polygonIndex) => [
          ...(showBasement
            ? Array.from({ length: model.undergroundFloors }, (_, index) => (
                <FloorMass
                  key={`${model.key}-${polygonIndex}-b${index + 1}`}
                  polygon={polygon}
                  baseY={GRADE_Y - (index + 1) * floorHeight}
                  height={floorHeight - FLOOR_GAP}
                  kind="below"
                />
              ))
            : []),
          ...Array.from({ length: model.groundFloors }, (_, index) => (
            <FloorMass
              key={`${model.key}-${polygonIndex}-a${index + 1}`}
              polygon={polygon}
              baseY={GRADE_Y + 0.12 + index * (slabHeight + FLOOR_GAP)}
              height={slabHeight}
              kind="above"
            />
          )),
        ]);
      })}

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
        target={[0, Math.max(0.8, maxHeight * 0.32), 0]}
      />
    </>
  );
}

function ModelHud({
  currentBuilding,
  lotArea,
  roadName,
  contextCount,
}: {
  currentBuilding: BuildingLookupResult;
  lotArea: number;
  roadName: string | null;
  contextCount: number;
}) {
  const geometry = getExistingBuildingGeometry(currentBuilding);
  const actual = geometry?.status === "matched" && geometry.footprints.length > 0;
  const main =
    currentBuilding.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding.buildings[0];
  const footprintArea = actual
    ? geometry.footprints.reduce((sum, footprint) => sum + footprint.footprintAreaSqm, 0)
    : main?.buildingArea ?? 0;
  const bcrPct = lotArea > 0 ? (footprintArea / lotArea) * 100 : main?.buildingCoverage ?? 0;
  const groundFloors = Math.max(
    0,
    ...currentBuilding.buildings.map((building) => building.groundFloors)
  );
  const basementFloors = Math.max(
    0,
    ...currentBuilding.buildings.map((building) => building.undergroundFloors)
  );

  const labels = [
    actual ? "실제 외곽선" : "개략 형상",
    ...(actual ? [`건물 ${geometry.footprints.length}개 형상`] : []),
    ...(contextCount > 0 ? [`주변 건물 ${contextCount}동`] : []),
    `지상 최대 ${groundFloors}층`,
    ...(basementFloors > 0 ? [`지하 최대 ${basementFloors}층`] : []),
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
        maxWidth: "calc(100% - 180px)",
      }}
    >
      {labels.map((label) => (
        <span
          key={label}
          style={{
            padding: "5px 8px",
            borderRadius: 999,
            background: actual && label === "실제 외곽선" ? "#e8f5ee" : "rgba(255,255,255,0.94)",
            border:
              actual && label === "실제 외곽선"
                ? "1px solid #8fc7a5"
                : "1px solid rgba(148,163,184,0.42)",
            color: actual && label === "실제 외곽선" ? "#25633f" : "#475569",
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
        건축면적 {footprintArea.toFixed(1)}㎡ · 건폐율 {bcrPct.toFixed(1)}%
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
  const [showContext, setShowContext] = useState(true);
  const [canvasKey, setCanvasKey] = useState(0);

  const hasBuilding = Boolean(
    currentBuilding?.hasBuilding && (currentBuilding.buildings.length ?? 0) > 0
  );
  const geometry = getExistingBuildingGeometry(currentBuilding);
  const actualGeometry =
    geometry?.status === "matched" && geometry.footprints.length > 0;
  const contextCount = geometry?.contextFootprints?.length ?? 0;
  const openBoundary = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    return openRing(boundary);
  }, [boundary]);
  const primaryRoad = useMemo(
    () => (openBoundary ? findPrimaryRoad(openBoundary, resolvedRoads) : null),
    [openBoundary, resolvedRoads]
  );
  const extent = useMemo(() => {
    if (!openBoundary) return 12;
    const local = boundaryToLocalRing(openBoundary);
    if (!local) return 12;
    return local.ring.reduce(
      (value, point) => Math.max(value, Math.hypot(point.x, point.z) + 2.5),
      8
    );
  }, [openBoundary]);
  const basementFloors = currentBuilding
    ? Math.max(0, ...currentBuilding.buildings.map((building) => building.undergroundFloors))
    : 0;

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

  const cameraDistance = extent * (showContext && contextCount > 0 ? 2.2 : 1.3);

  return (
    <div
      data-building-geometry={actualGeometry ? "actual" : "schematic"}
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
        key={`${canvasKey}-${showContext ? "context" : "subject"}`}
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
            showContext={showContext}
          />
        </Suspense>
      </Canvas>

      {hasBuilding && currentBuilding && (
        <ModelHud
          currentBuilding={currentBuilding}
          lotArea={lotArea}
          roadName={primaryRoad ? primaryRoad.name ?? "" : null}
          contextCount={contextCount}
        />
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          maxWidth: 250,
        }}
      >
        {contextCount > 0 && (
          <button
            type="button"
            onClick={() => setShowContext((value) => !value)}
            style={controlStyle(showContext)}
          >
            {showContext ? "주변 숨기기" : "주변 보기"}
          </button>
        )}
        {hasBuilding && basementFloors > 0 && (
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
          건축물대장과 GIS건물통합정보에 일치하는 현재 건물 없음
        </div>
      )}

      {hasBuilding && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            maxWidth: 390,
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
          {actualGeometry
            ? `대상 건물 외곽선·위치는 VWorld GIS건물통합정보 기반입니다.${
                contextCount > 0
                  ? ` 주변 ${contextCount}동은 약 ${geometry?.contextRadiusM ?? 35}m 범위의 방향 확인용 반투명 매스입니다.`
                  : ""
              } 층별 후퇴·지붕·출입구는 미반영이며, 도로 폭은 상징적으로 표시합니다.`
            : geometry?.status === "error"
              ? "GIS건물통합정보 조회에 실패해 필지 형상과 건폐율을 이용한 개략 매스를 표시합니다."
              : "일치하는 GIS 건물 형상이 없어 필지 형상과 건폐율을 이용한 개략 매스를 표시합니다."}
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
