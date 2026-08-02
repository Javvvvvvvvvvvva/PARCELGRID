"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, Line, OrbitControls } from "@react-three/drei";
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
import {
  angularDifference,
  bearingFromSceneVector,
  frontageSideLabel,
  normalizeBearing,
  roadAxisLabel,
} from "@/lib/geo/orientation";
import { scenePointToExtrusionPlane } from "@/lib/geo/scene-extrusion";
import { useProjectStore } from "@/lib/stores/project-store";

type Pt = LocalPoint;
type LocalPolygon = Pt[][];
type RoadInput = { name: string | null; points: LngLat[] };
type ViewMode = "map" | "3d";

type LocalRoad = LocalRoadLine & {
  distanceM: number;
  alignment: number;
  frontage: { a: Pt; b: Pt };
  roadSegment: { a: Pt; b: Pt };
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
const CONTEXT_COLOR = "#7f8c99";
const CONTEXT_OPACITY = 0.1;
const ROAD_COLOR = "#59636e";
const ROAD_CENTER_COLOR = "#d8dde1";
const FRONTAGE_COLOR = "#2563eb";
const ROAD_WIDTH_M = 1.45;
const FRONT_ROAD_MAX_DISTANCE_M = 12;
const MAX_CONTEXT_HEIGHT_M = 24;
const MINI_MAP = { width: 166, height: 126, padding: 10 };

function openRing<T extends [number, number] | Pt>(ring: T[]): T[] {
  if (ring.length <= 1) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const fx = "x" in first ? first.x : first[0];
  const fz = "z" in first ? first.z : first[1];
  const lx = "x" in last ? last.x : last[0];
  const lz = "z" in last ? last.z : last[1];
  return fx === lx && fz === lz ? ring.slice(0, -1) : ring;
}

function ringCentroid(ring: Pt[]): Pt {
  const points = openRing(ring);
  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }),
    { x: 0, z: 0 }
  );
  return { x: total.x / points.length, z: total.z / points.length };
}

function boundaryToLocal(
  boundary: LngLat[]
): { ring: Pt[]; center: { lng: number; lat: number } } | null {
  const open = openRing(boundary);
  if (open.length < 3) return null;
  const projected = projectPolygon([...open, open[0]] as LngLat[]);
  if (!projected) return null;
  const points =
    projected.points.length > 1 &&
    projected.points[0][0] === projected.points.at(-1)?.[0] &&
    projected.points[0][1] === projected.points.at(-1)?.[1]
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
  const local = boundaryToLocal(boundary);
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
  return {
    ...road,
    distanceM: selection.distanceM,
    alignment: selection.alignment,
    frontage: {
      a: local.ring[selection.boundarySegmentIndex],
      b: local.ring[(selection.boundarySegmentIndex + 1) % local.ring.length],
    },
    roadSegment: {
      a: road.points[selection.roadSegmentIndex],
      b: road.points[selection.roadSegmentIndex + 1],
    },
  };
}

function scaledRing(ring: Pt[], areaRatio: number): Pt[] {
  const factor = Math.sqrt(Math.max(0.04, Math.min(1, areaRatio)));
  const center = ringCentroid(ring);
  return ring.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    z: center.z + (point.z - center.z) * factor,
  }));
}

function modelFromFootprint(
  footprint: ExistingBuildingFootprint,
  center: { lng: number; lat: number },
  floorHeight: number,
  fallback?: BuildingLookupResult["buildings"][number]
): BuildingModel | null {
  const polygons = footprint.polygons
    .map((polygon) => projectBuildingPolygon(polygon, center))
    .filter((polygon) => polygon.length > 0 && polygon[0].length >= 3);
  if (polygons.length === 0) return null;
  const groundFloors = Math.max(1, footprint.groundFloors || fallback?.groundFloors || 1);
  const undergroundFloors = Math.max(
    0,
    footprint.undergroundFloors || fallback?.undergroundFloors || 0
  );
  const totalHeightM =
    footprint.heightM > 0
      ? footprint.heightM
      : fallback && fallback.height > 0
        ? fallback.height
        : groundFloors * floorHeight;
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
  let extent = initial;
  for (const model of models) {
    for (const polygon of model.polygons) {
      for (const ring of polygon) {
        for (const point of ring) {
          extent = Math.max(extent, Math.hypot(point.x, point.z) + 2.5);
        }
      }
    }
  }
  return extent;
}

function extrudePolygon(polygon: LocalPolygon, depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  (polygon[0] ?? []).forEach((point, index) => {
    const [x, y] = scenePointToExtrusionPlane(point);
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  for (const holeRing of polygon.slice(1)) {
    const hole = new THREE.Path();
    holeRing.forEach((point, index) => {
      const [x, y] = scenePointToExtrusionPlane(point);
      if (index === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
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

function LotMass({ ring, cutaway }: { ring: Pt[]; cutaway: boolean }) {
  const geometry = useMemo(() => extrudePolygon([ring], 0.12), [ring]);
  return (
    <mesh geometry={geometry} receiveShadow position={[0, GRADE_Y, 0]}>
      <meshStandardMaterial
        color={LOT_COLOR}
        transparent={cutaway}
        opacity={cutaway ? 0.34 : 1}
        roughness={0.92}
      />
      <Edges threshold={10} color={LOT_EDGE} />
    </mesh>
  );
}

function FloorMass({
  polygon,
  baseY,
  height,
  basement,
}: {
  polygon: LocalPolygon;
  baseY: number;
  height: number;
  basement: boolean;
}) {
  const geometry = useMemo(() => extrudePolygon(polygon, height), [polygon, height]);
  return (
    <mesh geometry={geometry} position={[0, baseY, 0]} castShadow receiveShadow>
      <meshStandardMaterial
        color={basement ? BASEMENT_COLOR : BUILDING_COLOR}
        roughness={basement ? 0.72 : 0.78}
      />
      <Edges threshold={12} color={basement ? "#263442" : BUILDING_EDGE} />
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
    <mesh geometry={geometry} position={[0, GRADE_Y + 0.04, 0]}>
      <meshStandardMaterial
        color={CONTEXT_COLOR}
        transparent
        opacity={CONTEXT_OPACITY}
        depthWrite={false}
        roughness={1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function RoadRibbon({ road, extent }: { road: LocalRoad; extent: number }) {
  const segments = useMemo(() => {
    const output: { key: string; x: number; z: number; length: number; angle: number }[] = [];
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const a = road.points[index];
      const b = road.points[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      if (length < 0.1 || Math.hypot(x, z) > extent * 2.3) continue;
      output.push({
        key: `${index}-${x.toFixed(2)}-${z.toFixed(2)}`,
        x,
        z,
        length,
        angle: -Math.atan2(dz, dx),
      });
    }
    return output;
  }, [extent, road.points]);
  return (
    <group>
      {segments.map((segment) => (
        <group
          key={segment.key}
          position={[segment.x, 0.025, segment.z]}
          rotation={[0, segment.angle, 0]}
        >
          <mesh receiveShadow>
            <boxGeometry args={[segment.length, 0.055, ROAD_WIDTH_M]} />
            <meshStandardMaterial color={ROAD_COLOR} roughness={0.94} />
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
      const distance = Math.max(28, (extent / Math.tan(THREE.MathUtils.degToRad(17.5))) * 1.12);
      camera.up.set(0, 0, -1);
      camera.position.set(0, distance, 0.001);
      camera.lookAt(0, 0, 0);
    } else {
      const targetY = Math.max(0.8, maxHeight * 0.3);
      camera.up.set(0, 1, 0);
      camera.position.set(0, extent * 0.95, extent * 1.35);
      camera.lookAt(0, targetY, 0);
    }
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, extent, invalidate, maxHeight, mode, resetKey]);
  return null;
}

function HeadingReporter({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (bearing: number) => void;
}) {
  const { camera } = useThree();
  const direction = useMemo(() => new THREE.Vector3(), []);
  const last = useRef<number | null>(null);
  useFrame(() => {
    let next = 0;
    if (mode === "3d") {
      camera.getWorldDirection(direction);
      if (Math.hypot(direction.x, direction.z) <= 1e-6) return;
      next = bearingFromSceneVector(direction.x, direction.z);
    }
    if (last.current === null || angularDifference(last.current, next) >= 0.75) {
      last.current = next;
      onChange(next);
    }
  });
  return null;
}

function MassScene({
  lotRing,
  models,
  contextModels,
  road,
  floorHeight,
  extent,
  maxHeight,
  showBasement,
  viewMode,
  resetKey,
  onHeadingChange,
}: {
  lotRing: Pt[];
  models: BuildingModel[];
  contextModels: BuildingModel[];
  road: LocalRoad | null;
  floorHeight: number;
  extent: number;
  maxHeight: number;
  showBasement: boolean;
  viewMode: ViewMode;
  resetKey: number;
  onHeadingChange: (bearing: number) => void;
}) {
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
      <gridHelper args={[extent * 2.6, 18, "#d7dde1", "#eaedef"]} />
      {contextModels.flatMap((model) =>
        model.polygons.map((polygon, index) => (
          <ContextMass key={`context-${model.key}-${index}`} polygon={polygon} height={model.totalHeightM} />
        ))
      )}
      {road && <RoadRibbon road={road} extent={extent} />}
      <LotMass ring={lotRing} cutaway={showBasement} />
      {models.flatMap((model) => {
        const slabHeight =
          (model.totalHeightM - FLOOR_GAP * Math.max(0, model.groundFloors - 1)) /
          model.groundFloors;
        return model.polygons.flatMap((polygon, polygonIndex) => [
          ...(showBasement
            ? Array.from({ length: model.undergroundFloors }, (_, index) => (
                <FloorMass
                  key={`${model.key}-${polygonIndex}-b${index}`}
                  polygon={polygon}
                  baseY={GRADE_Y - (index + 1) * floorHeight}
                  height={floorHeight - FLOOR_GAP}
                  basement
                />
              ))
            : []),
          ...Array.from({ length: model.groundFloors }, (_, index) => (
            <FloorMass
              key={`${model.key}-${polygonIndex}-a${index}`}
              polygon={polygon}
              baseY={GRADE_Y + 0.12 + index * (slabHeight + FLOOR_GAP)}
              height={slabHeight}
              basement={false}
            />
          )),
        ]);
      })}
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
      <HeadingReporter mode={viewMode} onChange={onHeadingChange} />
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

function Compass({ heading, mode }: { heading: number; mode: ViewMode }) {
  const labels = [
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["W", 270],
  ] as const;
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 4 }}>
      <div
        style={{
          position: "relative",
          width: 84,
          height: 84,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.92)",
          border: "1px solid rgba(100,116,139,0.38)",
        }}
      >
        {labels.map(([text, bearing]) => {
          const angle = ((bearing - heading) * Math.PI) / 180;
          return (
            <span
              key={text}
              style={{
                position: "absolute",
                left: 42 + Math.sin(angle) * 32,
                top: 42 - Math.cos(angle) * 32,
                transform: "translate(-50%, -50%)",
                fontSize: text === "N" ? 12 : 10,
                fontWeight: text === "N" ? 800 : 650,
                color: text === "N" ? "#1d4ed8" : "#475569",
              }}
            >
              {text}
            </span>
          );
        })}
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 6,
            height: 6,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background: "#334155",
          }}
        />
      </div>
      <div style={{ fontSize: 9.5, color: "#64748b", fontWeight: 600 }}>
        {mode === "map" ? "정북 고정" : `카메라 방위 ${Math.round(heading)}°`}
      </div>
    </div>
  );
}

function polygonPath(polygon: LocalPolygon, project: (point: Pt) => { x: number; y: number }) {
  return polygon
    .map((ring) => {
      const points = ring.map(project);
      return points.length < 3
        ? ""
        : `${points
            .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(" ")} Z`;
    })
    .join(" ");
}

function MiniMap({
  lotRing,
  models,
  contextModels,
  road,
}: {
  lotRing: Pt[];
  models: BuildingModel[];
  contextModels: BuildingModel[];
  road: LocalRoad | null;
}) {
  const drawing = useMemo(() => {
    const subject = models.flatMap((model) => model.polygons);
    const context = contextModels.flatMap((model) => model.polygons);
    const roadPoints = (road?.points ?? []).filter((point) => Math.hypot(point.x, point.z) <= 48);
    const points: Pt[] = [...lotRing, ...roadPoints];
    [...subject, ...context].forEach((polygon) => polygon.forEach((ring) => points.push(...ring)));
    if (points.length === 0) return null;
    const xs = points.map((point) => point.x);
    const zs = points.map((point) => point.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const widthM = Math.max(1, maxX - minX);
    const heightM = Math.max(1, maxZ - minZ);
    const scale = Math.min(
      (MINI_MAP.width - MINI_MAP.padding * 2) / widthM,
      (MINI_MAP.height - MINI_MAP.padding * 2) / heightM
    );
    const offsetX = MINI_MAP.padding + (MINI_MAP.width - MINI_MAP.padding * 2 - widthM * scale) / 2;
    const offsetY = MINI_MAP.padding + (MINI_MAP.height - MINI_MAP.padding * 2 - heightM * scale) / 2;
    const project = (point: Pt) => ({
      x: offsetX + (point.x - minX) * scale,
      y: offsetY + (point.z - minZ) * scale,
    });
    return { subject, context, roadPoints, project };
  }, [contextModels, lotRing, models, road]);
  if (!drawing) return null;
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
        북쪽 위 미니맵
      </div>
      <svg
        width={MINI_MAP.width}
        height={MINI_MAP.height}
        viewBox={`0 0 ${MINI_MAP.width} ${MINI_MAP.height}`}
        style={{ display: "block", background: "rgba(248,250,252,0.92)", borderRadius: 7 }}
      >
        {drawing.context.map((polygon, index) => (
          <path key={`c-${index}`} d={polygonPath(polygon, drawing.project)} fill="#94a3b8" fillOpacity={0.16} />
        ))}
        {drawing.roadPoints.length >= 2 && (
          <polyline
            points={drawing.roadPoints
              .map((point) => {
                const projected = drawing.project(point);
                return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
              })
              .join(" ")}
            fill="none"
            stroke={ROAD_COLOR}
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
        <path d={polygonPath([lotRing], drawing.project)} fill={LOT_COLOR} stroke={LOT_EDGE} strokeWidth={1.2} />
        {drawing.subject.map((polygon, index) => (
          <path
            key={`s-${index}`}
            d={polygonPath(polygon, drawing.project)}
            fill={BUILDING_COLOR}
            stroke={BUILDING_EDGE}
            strokeWidth={1.2}
          />
        ))}
        {road && (
          <line
            x1={drawing.project(road.frontage.a).x}
            y1={drawing.project(road.frontage.a).y}
            x2={drawing.project(road.frontage.b).x}
            y2={drawing.project(road.frontage.b).y}
            stroke={FRONTAGE_COLOR}
            strokeWidth={2.5}
          />
        )}
        <text x={MINI_MAP.width / 2} y={10} textAnchor="middle" fontSize="9" fontWeight="800" fill="#1d4ed8">
          N
        </text>
      </svg>
    </div>
  );
}

function controlStyle(active: boolean): CSSProperties {
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
  const [heading, setHeading] = useState(0);
  const onHeadingChange = useCallback((bearing: number) => setHeading(normalizeBearing(bearing)), []);

  const openBoundary = useMemo(
    () => (boundary && boundary.length >= 3 ? openRing(boundary) : null),
    [boundary]
  );
  const local = useMemo(
    () => (openBoundary ? boundaryToLocal(openBoundary) : null),
    [openBoundary]
  );
  const main =
    currentBuilding?.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding?.buildings[0];
  const geometry = getExistingBuildingGeometry(currentBuilding);
  const floorHeight = currentBuilding ? estimateFloorHeightM(currentBuilding) ?? 3 : 3;
  const models = useMemo(() => {
    if (!local || !main) return [];
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
    const ratio =
      main.buildingArea > 0 && lotArea > 0
        ? main.buildingArea / lotArea
        : main.buildingCoverage > 0
          ? main.buildingCoverage / 100
          : 0.6;
    return [
      {
        key: "schematic-main",
        polygons: [[scaledRing(local.ring, ratio)]],
        groundFloors: Math.max(1, main.groundFloors),
        undergroundFloors: Math.max(0, main.undergroundFloors),
        totalHeightM: main.height > 0 ? main.height : Math.max(1, main.groundFloors) * floorHeight,
        footprintAreaSqm: main.buildingArea,
      },
    ];
  }, [currentBuilding, floorHeight, geometry, local, lotArea, main]);
  const allContextModels = useMemo(() => {
    if (!local || !geometry?.contextFootprints?.length) return [];
    return geometry.contextFootprints
      .map((footprint) => modelFromFootprint(footprint, local.center, 3))
      .filter((model): model is BuildingModel => model !== null);
  }, [geometry, local]);
  const contextModels = useMemo(
    () => (showContext ? allContextModels : []),
    [allContextModels, showContext]
  );
  const road = useMemo(
    () => (openBoundary ? findPrimaryRoad(openBoundary, resolvedRoads) : null),
    [openBoundary, resolvedRoads]
  );
  const subjectExtent = useMemo(() => {
    if (!local) return 8;
    let value = 8;
    local.ring.forEach((point) => {
      value = Math.max(value, Math.hypot(point.x, point.z) + 2.5);
    });
    return modelExtent(models, value);
  }, [local, models]);
  const extent = useMemo(
    () =>
      contextModels.length === 0
        ? subjectExtent
        : Math.min(modelExtent(contextModels, subjectExtent), Math.max(subjectExtent * 2.8, 28)),
    [contextModels, subjectExtent]
  );
  const maxHeight = models.reduce((value, model) => Math.max(value, model.totalHeightM), 0);
  const hasBuilding = Boolean(currentBuilding?.hasBuilding && models.length > 0);
  const basementFloors = Math.max(0, ...models.map((model) => model.undergroundFloors));

  if (!openBoundary || !local || local.ring.length < 3) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--border)",
          borderRadius: 10,
          color: "var(--fg-muted)",
        }}
      >
        필지 경계 데이터가 없어 3D를 표시할 수 없습니다.
      </div>
    );
  }

  const resetView = (mode: ViewMode) => {
    setViewMode(mode);
    setHeading(0);
    setResetKey((value) => value + 1);
  };
  const footprintArea = models.reduce((sum, model) => sum + model.footprintAreaSqm, 0);
  const bcrPct = lotArea > 0 ? (footprintArea / lotArea) * 100 : 0;
  const actual = geometry?.status === "matched" && geometry.footprints.length > 0;

  return (
    <div
      data-building-geometry={actual ? "actual" : "schematic"}
      data-view-mode={viewMode}
      style={{
        position: "relative",
        height,
        overflow: "hidden",
        borderRadius: 10,
        border: "1px solid #dfe4e8",
        background: "#f7f8f9",
      }}
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 30, 20], fov: 35 }}
        style={{ cursor: viewMode === "3d" ? "grab" : "default", touchAction: "none" }}
      >
        <Suspense fallback={null}>
          <MassScene
            lotRing={local.ring}
            models={models}
            contextModels={contextModels}
            road={road}
            floorHeight={floorHeight}
            extent={extent}
            maxHeight={maxHeight}
            showBasement={showBasement}
            viewMode={viewMode}
            resetKey={resetKey}
            onHeadingChange={onHeadingChange}
          />
        </Suspense>
      </Canvas>

      {hasBuilding && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            maxWidth: "calc(100% - 410px)",
            pointerEvents: "none",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[
              actual ? "실제 외곽선" : "개략 형상",
              ...(actual ? [`건물 ${models.length}개 형상`] : []),
              ...(geometry?.reviewFootprintCount ? ["외곽 확인 필요"] : []),
              ...(allContextModels.length ? [`주변 건물 ${allContextModels.length}동`] : []),
              `지상 최대 ${Math.max(...models.map((model) => model.groundFloors))}층`,
              ...(basementFloors ? [`지하 최대 ${basementFloors}층`] : []),
              ...(road ? [road.name || "전면도로"] : []),
            ].map((label) => (
              <span
                key={label}
                style={{
                  padding: "5px 8px",
                  borderRadius: 999,
                  background: actual && label === "실제 외곽선" ? "#e8f5ee" : "rgba(255,255,255,0.94)",
                  border: "1px solid rgba(148,163,184,0.42)",
                  color: actual && label === "실제 외곽선" ? "#25633f" : "#475569",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {label}
              </span>
            ))}
          </div>
          <div
            style={{
              marginTop: 8,
              width: "fit-content",
              maxWidth: 420,
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
            {road && (
              <>
                <br />도로 방위 {roadAxisLabel(road.roadSegment.a, road.roadSegment.b)} · 접도면{" "}
                {frontageSideLabel(road.frontage.a, road.frontage.b)} · 평행도{" "}
                {(road.alignment * 100).toFixed(0)}%
              </>
            )}
          </div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "flex-end",
          gap: 6,
          maxWidth: 400,
        }}
      >
        <button type="button" onClick={() => resetView("map")} style={controlStyle(viewMode === "map")}>
          지도 정합
        </button>
        <button type="button" onClick={() => resetView("3d")} style={controlStyle(viewMode === "3d")}>
          3D 조감
        </button>
        {allContextModels.length > 0 && (
          <button type="button" onClick={() => setShowContext((value) => !value)} style={controlStyle(showContext)}>
            {showContext ? "주변 숨기기" : "주변 보기"}
          </button>
        )}
        {basementFloors > 0 && (
          <button type="button" onClick={() => setShowBasement((value) => !value)} style={controlStyle(showBasement)}>
            {showBasement ? "지하 숨기기" : "지하 보기"}
          </button>
        )}
        <button type="button" onClick={() => resetView(viewMode)} style={controlStyle(false)}>
          {viewMode === "map" ? "지도 재중심" : "정북 조감"}
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          padding: 8,
          borderRadius: 9,
          background: "rgba(255,255,255,0.9)",
          border: "1px solid rgba(148,163,184,0.34)",
          pointerEvents: "none",
        }}
      >
        {viewMode === "3d" && (
          <MiniMap lotRing={local.ring} models={models} contextModels={contextModels} road={road} />
        )}
        <Compass heading={viewMode === "map" ? 0 : heading} mode={viewMode} />
      </div>

      {hasBuilding && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            maxWidth: 440,
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
            ? "지도 정합은 N=화면 위, E=오른쪽으로 고정됩니다. 도로·필지·건물은 동일한 GIS 좌표를 사용합니다."
            : "3D 조감은 정북 기준 시점에서 시작합니다. 미니맵과 3D는 동일한 GIS 좌표를 공유합니다."}
        </div>
      )}
    </div>
  );
}
