"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, Html, Line, OrbitControls } from "@react-three/drei";
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
import {
  selectPrimaryRoad,
  type LocalPoint,
  type LocalRoadLine,
} from "@/lib/geo/select-primary-road";
import { useProjectStore } from "@/lib/stores/project-store";

type Pt = LocalPoint;
type LocalPolygon = Pt[][];
type RoadInput = { name: string | null; points: LngLat[] };
type ViewMode = "map" | "3d";

type LocalRoad = LocalRoadLine & {
  distanceM: number;
  alignment: number;
  frontage: { a: Pt; b: Pt };
};

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
const FRONTAGE_COLOR = "#2563eb";
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

  const points =
    projected.points.length > 1 &&
    projected.points[0][0] === projected.points[projected.points.length - 1][0] &&
    projected.points[0][1] === projected.points[projected.points.length - 1][1]
      ? projected.points.slice(0, -1)
      : projected.points;

  return {
    ring: points.map(([x, y]) => ({ x, z: -y })),
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

function findPrimaryRoad(boundary: LngLat[], roads: RoadInput[]): LocalRoad | null {
  const local = boundaryToLocalRing(boundary);
  if (!local || roads.length === 0) return null;

  const localRoads: LocalRoadLine[] = roads
    .filter((road) => road.points?.length >= 2)
    .map((road) => ({
      name: road.name,
      points: road.points.map((point) => projectLngLat(point, local.center)),
    }));
  const selection = selectPrimaryRoad(local.ring, localRoads, FRONT_ROAD_MAX_DISTANCE_M);
  if (!selection) return null;

  const road = localRoads[selection.roadIndex];
  const a = local.ring[selection.boundarySegmentIndex];
  const b = local.ring[(selection.boundarySegmentIndex + 1) % local.ring.length];
  return {
    ...road,
    distanceM: selection.distanceM,
    alignment: selection.alignment,
    frontage: { a, b },
  };
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
    for (let index = 0; index < road.points.length - 1; index += 1) {
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
      <Line
        points={[
          [road.frontage.a.x, 0.2, road.frontage.a.z],
          [road.frontage.b.x, 0.2, road.frontage.b.z],
        ]}
        color={FRONTAGE_COLOR}
        lineWidth={3}
      />
    </group>
  );
}

function NorthMarker({ extent }: { extent: number }) {
  const origin = useMemo(
    () => new THREE.Vector3(-extent * 0.63, 0.28, extent * 0.62),
    [extent]
  );
  const arrowLength = Math.max(2.2, extent * 0.2);
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

function CameraRig({
  mode,
  extent,
  maxHeight,
  resetKey,
}: {
  mode: ViewMode;
  extent: number;
  maxHeight: number;
  resetKey: number;
}) {
  const { camera, invalidate } = useThree();

  useEffect(() => {
    if (mode === "map") {
      const halfFov = THREE.MathUtils.degToRad(17.5);
      const distance = Math.max(28, (extent / Math.tan(halfFov)) * 1.12);
      camera.up.set(0, 0, -1);
      camera.position.set(0, distance, 0.001);
      camera.lookAt(0, 0, 0);
    } else {
      const targetY = Math.max(0.8, maxHeight * 0.3);
      camera.up.set(0, 1, 0);
      camera.position.set(extent * 1.18, extent * 0.9, extent * 1.18);
      camera.lookAt(0, targetY, 0);
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, extent, invalidate, maxHeight, mode, resetKey]);

  return null;
}

function SceneContent({
  boundary,
  roads,
  currentBuilding,
  lotArea,
  showBasement,
  showContext,
  viewMode,
  resetKey,
}: {
  boundary: LngLat[];
  roads: RoadInput[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
  showBasement: boolean;
  showContext: boolean;
  viewMode: ViewMode;
  resetKey: number;
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
  }, [currentBuilding, floorHeight, geometry, local, lotArea, lotRing, main]);

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
    return Math.min(modelExtent(contextModels, subjectExtent), Math.max(subjectExtent * 2.8, 28));
  }, [contextModels, showContext, subjectExtent]);

  const maxHeight = models.reduce((max, model) => Math.max(max, model.totalHeightM), 0);
  if (lotRing.length < 3) return null;

  return (
    <>
      <color attach="background" args={["#f7f8f9"]} />
      <ambientLight intensity={1.35} />
      <hemisphereLight args={["#ffffff", "#d3d8dc", 0.8]} />
      <directionalLight position={[10, 18, 8]} intensity={1.25} castShadow />

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
      {viewMode === "3d" && (
        <ContactShadows
          position={[0, 0.02, 0]}
          opacity={0.2}
          scale={extent * 1.7}
          blur={2.5}
          far={extent * 2}
        />
      )}
      <CameraRig mode={viewMode} extent={extent} maxHeight={maxHeight} resetKey={resetKey} />
      <OrbitControls
        makeDefault
        enableRotate={viewMode === "3d"}
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.72}
        minDistance={extent * 0.7}
        maxDistance={extent * 4}
        maxPolarAngle={Math.PI / 2.05}
        target={viewMode === "map" ? [0, 0, 0] : [0, Math.max(0.8, maxHeight * 0.3), 0]}
      />
    </>
  );
}

function ModelHud({
  currentBuilding,
  lotArea,
  road,
  contextCount,
}: {
  currentBuilding: BuildingLookupResult;
  lotArea: number;
  road: LocalRoad | null;
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
    ...(geometry?.reviewFootprintCount ? ["외곽 확인 필요"] : []),
    ...(contextCount > 0 ? [`주변 건물 ${contextCount}동`] : []),
    `지상 최대 ${groundFloors}층`,
    ...(basementFloors > 0 ? [`지하 최대 ${basementFloors}층`] : []),
    ...(road ? [road.name || "전면도로"] : []),
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
        maxWidth: "calc(100% - 390px)",
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
        {road && ` · 접도 평행도 ${(road.alignment * 100).toFixed(0)}%`}
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
  const [viewMode, setViewMode] = useState<ViewMode>("map");
  const [resetKey, setResetKey] = useState(0);

  const hasBuilding = Boolean(
    currentBuilding?.hasBuilding && (currentBuilding.buildings.length ?? 0) > 0
  );
  const geometry = getExistingBuildingGeometry(currentBuilding);
  const actualGeometry = geometry?.status === "matched" && geometry.footprints.length > 0;
  const contextCount = geometry?.contextFootprints?.length ?? 0;
  const openBoundary = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    return openRing(boundary);
  }, [boundary]);
  const primaryRoad = useMemo(
    () => (openBoundary ? findPrimaryRoad(openBoundary, resolvedRoads) : null),
    [openBoundary, resolvedRoads]
  );
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

  return (
    <div
      data-building-geometry={actualGeometry ? "actual" : "schematic"}
      data-view-mode={viewMode}
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
        shadows
        dpr={[1, 1.5]}
        style={{ cursor: viewMode === "3d" ? "grab" : "default", touchAction: "none" }}
        camera={{ position: [20, 30, 20], fov: 35 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            boundary={openBoundary}
            roads={resolvedRoads}
            currentBuilding={hasBuilding ? currentBuilding : null}
            lotArea={lotArea}
            showBasement={showBasement}
            showContext={showContext}
            viewMode={viewMode}
            resetKey={resetKey}
          />
        </Suspense>
      </Canvas>

      {hasBuilding && currentBuilding && (
        <ModelHud
          currentBuilding={currentBuilding}
          lotArea={lotArea}
          road={primaryRoad}
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
          maxWidth: 370,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setViewMode("map");
            setResetKey((value) => value + 1);
          }}
          style={controlStyle(viewMode === "map")}
        >
          지도 정합
        </button>
        <button
          type="button"
          onClick={() => {
            setViewMode("3d");
            setResetKey((value) => value + 1);
          }}
          style={controlStyle(viewMode === "3d")}
        >
          3D 조감
        </button>
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
          onClick={() => setResetKey((value) => value + 1)}
          style={controlStyle(false)}
        >
          시점 초기화
        </button>
      </div>

      {hasBuilding && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            maxWidth: 430,
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
          {viewMode === "map"
            ? "지도 정합은 북쪽을 화면 위로 고정합니다. 파란 선은 선택된 접도 필지 경계이며, 도로는 VWorld 중심선 기반 상징 폭입니다."
            : "3D 조감에서는 자유 회전할 수 있습니다. GIS 건물·도로·필지 좌표 자체는 회전하지 않습니다."}
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
