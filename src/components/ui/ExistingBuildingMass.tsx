"use client";

/**
 * Stage 1 — 기존 건물 개략 매스.
 * 필지와 도로는 동일한 WGS84 원점으로 투영해 실제 방향 관계를 유지한다.
 * 건물 외곽은 건축물대장 건축면적에 맞춘 개략 형상이며 실제 배치도가 아니다.
 */

import {
  Suspense,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import { projectPolygon } from "@/lib/geo/project-polygon";
import { analyzeFrontage } from "@/lib/geo/road-frontage";

export type ExistingMassRoad = {
  name: string | null;
  points: [number, number][];
};

type LngLat = [number, number];
type Pt = { x: number; z: number };
type ViewMode = "aligned" | "orbit";
type RoadSegment = { name: string | null; a: Pt; b: Pt };

const GRADE_Y = 0.08;
const FLOOR_LINE_OFFSET = 0.015;
const ROAD_ESTIMATED_WIDTH_M = 4.5;
const ROAD_OUTER_GAP_M = 0.35;

const ABOVE_COLOR = "#d7dde5";
const ABOVE_EDGE = "#71839a";
const BASEMENT_COLOR = "#536579";
const BASEMENT_EDGE = "#334155";
const SUBJECT_LOT = "#eaf3ff";
const SUBJECT_LOT_EDGE = "#2563eb";
const ROAD_COLOR = "#94a3b8";
const PRIMARY_ROAD_COLOR = "#334155";

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

function closeRing(boundary: LngLat[]): LngLat[] {
  const open = openRing(boundary);
  if (open.length < 3) return open;
  return [...open, open[0]];
}

function ringCentroid(ring: Pt[]): Pt {
  if (ring.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const point of ring) {
    x += point.x;
    z += point.z;
  }
  return { x: x / ring.length, z: z / ring.length };
}

function boundaryToLocalRing(
  boundary: LngLat[]
): { ring: Pt[]; origin: LngLat } | null {
  const closed = closeRing(boundary);
  if (closed.length < 4) return null;

  const projected = projectPolygon(closed);
  if (!projected) return null;

  const points = projected.points;
  const openPoints =
    points.length > 1 &&
    points[0][0] === points[points.length - 1][0] &&
    points[0][1] === points[points.length - 1][1]
      ? points.slice(0, -1)
      : points;

  return {
    ring: openPoints.map(([x, y]) => ({ x, z: -y })),
    origin: [projected.center.lng, projected.center.lat],
  };
}

function lngLatToLocal(point: LngLat, origin: LngLat): Pt {
  const lngMetersPerDeg = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  return {
    x: (point[0] - origin[0]) * lngMetersPerDeg,
    z: -(point[1] - origin[1]) * 110540,
  };
}

function scaleRingTowardCenter(ring: Pt[], areaRatio: number): Pt[] {
  const targetRatio = Math.max(0.04, Math.min(0.92, areaRatio));
  const factor = Math.sqrt(targetRatio) * 0.985;
  const center = ringCentroid(ring);
  return ring.map((point) => ({
    x: center.x + (point.x - center.x) * factor,
    z: center.z + (point.z - center.z) * factor,
  }));
}

function extrudeShape(ring: Pt[], height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.z);
    else shape.lineTo(point.x, point.z);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function horizontalRingPoints(
  ring: Pt[],
  y: number
): [number, number, number][] {
  return [...ring, ring[0]].map((point) => [point.x, y, point.z]);
}

function cardinalDirection(x: number, z: number): string {
  const angle = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
  const labels = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return labels[Math.round(angle / 45) % 8];
}

function majorAxisLabel(ring: Pt[]): string {
  if (ring.length < 3) return "확인 불가";
  const center = ringCentroid(ring);
  let xx = 0;
  let zz = 0;
  let xz = 0;

  for (const point of ring) {
    const x = point.x - center.x;
    const z = point.z - center.z;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }

  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  const bearing =
    ((Math.atan2(Math.cos(theta), -Math.sin(theta)) * 180) / Math.PI + 360) %
    180;

  if (bearing < 22.5 || bearing >= 157.5) return "남북";
  if (bearing < 67.5) return "북동–남서";
  if (bearing < 112.5) return "동서";
  return "북서–남동";
}

function clipSegmentToSquare(a: Pt, b: Pt, limit: number): [Pt, Pt] | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x + limit, limit - a.x, a.z + limit, limit - a.z];

  for (let index = 0; index < 4; index += 1) {
    if (Math.abs(p[index]) < 1e-9) {
      if (q[index] < 0) return null;
      continue;
    }

    const ratio = q[index] / p[index];
    if (p[index] < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return null;
  }

  return [
    { x: a.x + t0 * dx, z: a.z + t0 * dz },
    { x: a.x + t1 * dx, z: a.z + t1 * dz },
  ];
}

function buildRoadSegments(
  roads: ExistingMassRoad[],
  origin: LngLat,
  limit: number
): RoadSegment[] {
  const segments: RoadSegment[] = [];

  for (const road of roads) {
    const points = road.points.map((point) => lngLatToLocal(point, origin));
    for (let index = 0; index < points.length - 1; index += 1) {
      const clipped = clipSegmentToSquare(points[index], points[index + 1], limit);
      if (!clipped) continue;
      const [a, b] = clipped;
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.25) continue;
      segments.push({ name: road.name, a, b });
    }
  }

  return segments;
}

function SubjectLot({ ring }: { ring: Pt[] }) {
  const geometry = useMemo(() => extrudeShape(ring, 0.06), [ring]);
  const outline = useMemo(
    () => horizontalRingPoints(ring, GRADE_Y + 0.065),
    [ring]
  );

  return (
    <group>
      <mesh geometry={geometry} position={[0, GRADE_Y, 0]} receiveShadow>
        <meshStandardMaterial
          color={SUBJECT_LOT}
          transparent
          opacity={0.78}
          roughness={0.9}
        />
      </mesh>
      <Line points={outline} color={SUBJECT_LOT_EDGE} lineWidth={2.4} />
    </group>
  );
}

function roadOutwardNormal(segment: RoadSegment, lotCenter: Pt): Pt {
  const dx = segment.b.x - segment.a.x;
  const dz = segment.b.z - segment.a.z;
  const length = Math.hypot(dx, dz) || 1;
  let nx = -dz / length;
  let nz = dx / length;

  const midpoint = {
    x: (segment.a.x + segment.b.x) / 2,
    z: (segment.a.z + segment.b.z) / 2,
  };
  const towardRoad = {
    x: midpoint.x - lotCenter.x,
    z: midpoint.z - lotCenter.z,
  };

  if (nx * towardRoad.x + nz * towardRoad.z < 0) {
    nx *= -1;
    nz *= -1;
  }

  return { x: nx, z: nz };
}

function RoadSegmentMesh({
  segment,
  lotCenter,
  primary,
}: {
  segment: RoadSegment;
  lotCenter: Pt;
  primary: boolean;
}) {
  const geometry = useMemo(() => {
    const normal = roadOutwardNormal(segment, lotCenter);
    const innerOffset = ROAD_OUTER_GAP_M;
    const outerOffset = ROAD_OUTER_GAP_M + ROAD_ESTIMATED_WIDTH_M;

    const vertices = new Float32Array([
      segment.a.x + normal.x * innerOffset,
      0,
      segment.a.z + normal.z * innerOffset,
      segment.a.x + normal.x * outerOffset,
      0,
      segment.a.z + normal.z * outerOffset,
      segment.b.x + normal.x * outerOffset,
      0,
      segment.b.z + normal.z * outerOffset,
      segment.b.x + normal.x * innerOffset,
      0,
      segment.b.z + normal.z * innerOffset,
    ]);

    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    result.setIndex([0, 1, 2, 0, 2, 3]);
    result.computeVertexNormals();
    return result;
  }, [lotCenter, segment]);

  return (
    <mesh geometry={geometry} position={[0, 0.025, 0]} receiveShadow>
      <meshStandardMaterial
        color={primary ? PRIMARY_ROAD_COLOR : ROAD_COLOR}
        transparent={!primary}
        opacity={primary ? 1 : 0.72}
        roughness={0.96}
      />
    </mesh>
  );
}

function RoadLayer({
  segments,
  lotCenter,
  primaryRoadName,
}: {
  segments: RoadSegment[];
  lotCenter: Pt;
  primaryRoadName: string | null;
}) {
  const labelSegment = useMemo(() => {
    const matching = segments.filter(
      (segment) => primaryRoadName && segment.name === primaryRoadName
    );
    const pool = matching.length > 0 ? matching : segments;

    return pool.reduce<RoadSegment | null>((best, segment) => {
      if (!best) return segment;
      const bestDistance = Math.hypot(
        (best.a.x + best.b.x) / 2 - lotCenter.x,
        (best.a.z + best.b.z) / 2 - lotCenter.z
      );
      const distance = Math.hypot(
        (segment.a.x + segment.b.x) / 2 - lotCenter.x,
        (segment.a.z + segment.b.z) / 2 - lotCenter.z
      );
      return distance < bestDistance ? segment : best;
    }, null);
  }, [lotCenter, primaryRoadName, segments]);

  const labelPosition = useMemo(() => {
    if (!labelSegment) return null;
    const normal = roadOutwardNormal(labelSegment, lotCenter);
    const offset = ROAD_OUTER_GAP_M + ROAD_ESTIMATED_WIDTH_M * 0.55;
    return [
      (labelSegment.a.x + labelSegment.b.x) / 2 + normal.x * offset,
      0.18,
      (labelSegment.a.z + labelSegment.b.z) / 2 + normal.z * offset,
    ] as [number, number, number];
  }, [labelSegment, lotCenter]);

  return (
    <group>
      {segments.map((segment, index) => (
        <RoadSegmentMesh
          key={`${segment.name ?? "road"}-${index}`}
          segment={segment}
          lotCenter={lotCenter}
          primary={Boolean(primaryRoadName && segment.name === primaryRoadName)}
        />
      ))}

      {labelSegment && labelPosition && (primaryRoadName || labelSegment.name) && (
        <Text
          position={labelPosition}
          fontSize={0.62}
          color="#334155"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.035}
          outlineColor="#ffffff"
        >
          {primaryRoadName || labelSegment.name || "도로"}
        </Text>
      )}
    </group>
  );
}

function BuildingMass({
  ring,
  groundFloors,
  basementFloors,
  aboveHeight,
  floorHeight,
  showBasement,
}: {
  ring: Pt[];
  groundFloors: number;
  basementFloors: number;
  aboveHeight: number;
  floorHeight: number;
  showBasement: boolean;
}) {
  const aboveGeometry = useMemo(
    () => (aboveHeight > 0 ? extrudeShape(ring, aboveHeight) : null),
    [aboveHeight, ring]
  );
  const aboveEdges = useMemo(
    () => (aboveGeometry ? new THREE.EdgesGeometry(aboveGeometry, 28) : null),
    [aboveGeometry]
  );

  const basementHeight = basementFloors * floorHeight;
  const basementGeometry = useMemo(
    () => (basementHeight > 0 ? extrudeShape(ring, basementHeight) : null),
    [basementHeight, ring]
  );
  const basementEdges = useMemo(
    () => (basementGeometry ? new THREE.EdgesGeometry(basementGeometry, 28) : null),
    [basementGeometry]
  );

  const floorLines = useMemo(() => {
    if (groundFloors <= 1 || aboveHeight <= 0) return [];
    return Array.from({ length: groundFloors - 1 }, (_, index) => {
      const y = GRADE_Y + (aboveHeight * (index + 1)) / groundFloors;
      return horizontalRingPoints(ring, y + FLOOR_LINE_OFFSET);
    });
  }, [aboveHeight, groundFloors, ring]);

  if (!aboveGeometry) return null;

  return (
    <group>
      {showBasement && basementGeometry && (
        <group position={[0, GRADE_Y - basementHeight, 0]}>
          <mesh geometry={basementGeometry} castShadow receiveShadow>
            <meshStandardMaterial
              color={BASEMENT_COLOR}
              transparent
              opacity={0.56}
              roughness={0.8}
            />
          </mesh>
          {basementEdges && (
            <lineSegments geometry={basementEdges}>
              <lineBasicMaterial color={BASEMENT_EDGE} />
            </lineSegments>
          )}
        </group>
      )}

      <group position={[0, GRADE_Y, 0]}>
        <mesh geometry={aboveGeometry} castShadow receiveShadow>
          <meshStandardMaterial color={ABOVE_COLOR} roughness={0.72} />
        </mesh>
        {aboveEdges && (
          <lineSegments geometry={aboveEdges}>
            <lineBasicMaterial color={ABOVE_EDGE} />
          </lineSegments>
        )}
      </group>

      {floorLines.map((points, index) => (
        <Line
          key={`floor-${index}`}
          points={points}
          color="#91a0b2"
          lineWidth={1}
        />
      ))}
    </group>
  );
}

function NorthArrow({ extent }: { extent: number }) {
  const x = -extent * 0.7;
  const z = extent * 0.68;
  const length = Math.max(2.5, Math.min(5, extent * 0.34));
  const tipZ = z - length;

  return (
    <group>
      <Line
        points={[
          [x, 0.2, z],
          [x, 0.2, tipZ],
        ]}
        color="#0f172a"
        lineWidth={2.5}
      />
      <Line
        points={[
          [x, 0.2, tipZ],
          [x - 0.55, 0.2, tipZ + 0.85],
        ]}
        color="#0f172a"
        lineWidth={2.5}
      />
      <Line
        points={[
          [x, 0.2, tipZ],
          [x + 0.55, 0.2, tipZ + 0.85],
        ]}
        color="#0f172a"
        lineWidth={2.5}
      />
      <Text
        position={[x, 0.32, tipZ - 0.72]}
        fontSize={0.7}
        color="#0f172a"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor="#ffffff"
      >
        N
      </Text>
    </group>
  );
}

function CameraController({
  viewMode,
  resetKey,
  extent,
  targetY,
}: {
  viewMode: ViewMode;
  resetKey: number;
  extent: number;
  targetY: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    if (viewMode === "aligned") {
      camera.position.set(0, extent * 2.75, 0.001);
      camera.up.set(0, 0, -1);
      camera.lookAt(0, 0, 0);
    } else {
      camera.position.set(extent * 1.25, extent * 0.95, extent * 1.35);
      camera.up.set(0, 1, 0);
      camera.lookAt(0, targetY, 0);
    }

    camera.updateProjectionMatrix();
  }, [camera, extent, resetKey, targetY, viewMode]);

  return null;
}

function SceneContent({
  boundary,
  roads,
  currentBuilding,
  lotArea,
  showBasement,
  viewMode,
  resetKey,
}: {
  boundary: LngLat[];
  roads: ExistingMassRoad[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
  showBasement: boolean;
  viewMode: ViewMode;
  resetKey: number;
}) {
  const main =
    currentBuilding?.buildings.find((building) => building.isMainBuilding) ??
    currentBuilding?.buildings[0];

  const local = useMemo(() => boundaryToLocalRing(boundary), [boundary]);
  const lotRing = useMemo(() => local?.ring ?? [], [local]);
  const lotCenter = useMemo(() => ringCentroid(lotRing), [lotRing]);

  const footprint = useMemo(() => {
    if (lotRing.length < 3) return [];
    const ratio =
      main && main.buildingArea > 0 && lotArea > 0
        ? main.buildingArea / lotArea
        : main?.buildingCoverage
          ? main.buildingCoverage / 100
          : 0.55;
    return scaleRingTowardCenter(lotRing, ratio);
  }, [lotArea, lotRing, main]);

  const extent = useMemo(() => {
    let value = 8;
    for (const point of lotRing) {
      value = Math.max(value, Math.hypot(point.x, point.z) + 4.5);
    }
    return value;
  }, [lotRing]);

  const roadSegments = useMemo(
    () => (local ? buildRoadSegments(roads, local.origin, extent * 1.5) : []),
    [extent, local, roads]
  );
  const frontage = useMemo(
    () => analyzeFrontage(closeRing(boundary), roads),
    [boundary, roads]
  );

  const groundFloors = Math.max(0, main?.groundFloors ?? 0);
  const basementFloors = Math.max(0, main?.undergroundFloors ?? 0);
  const floorHeight = currentBuilding
    ? estimateFloorHeightM(currentBuilding) ?? 3
    : 3;
  const aboveHeight =
    main && main.height > 0 && groundFloors > 0
      ? main.height
      : groundFloors * floorHeight;
  const targetY = aboveHeight * 0.25;

  if (lotRing.length < 3) return null;

  return (
    <>
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[8, 18, 10]} intensity={0.58} castShadow />
      <directionalLight position={[-7, 11, -8]} intensity={0.22} />

      <gridHelper
        args={[
          extent * 3,
          Math.max(12, Math.round(extent * 1.5)),
          "#dce4ed",
          "#edf2f7",
        ]}
        position={[0, 0, 0]}
      />

      <RoadLayer
        segments={roadSegments}
        lotCenter={lotCenter}
        primaryRoadName={frontage?.roadName ?? null}
      />
      <SubjectLot ring={lotRing} />

      {footprint.length >= 3 && groundFloors > 0 && (
        <BuildingMass
          ring={footprint}
          groundFloors={groundFloors}
          basementFloors={basementFloors}
          aboveHeight={aboveHeight}
          floorHeight={floorHeight}
          showBasement={showBasement}
        />
      )}

      <NorthArrow extent={extent} />
      <CameraController
        viewMode={viewMode}
        resetKey={resetKey}
        extent={extent}
        targetY={targetY}
      />
      <OrbitControls
        key={`${viewMode}-${resetKey}`}
        makeDefault
        enableRotate={viewMode === "orbit"}
        enablePan={viewMode === "orbit"}
        enableZoom
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.8}
        minDistance={extent * 0.7}
        maxDistance={extent * 4}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, viewMode === "aligned" ? 0 : targetY, 0]}
      />
    </>
  );
}

function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 30,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${active ? "#86c89d" : "#cbd5e1"}`,
        background: active ? "#eefaf2" : "rgba(255,255,255,0.94)",
        color: active ? "#25613a" : "#475569",
        fontSize: 11.5,
        fontWeight: 600,
        boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function ControlButton({
  children,
  active = false,
  onClick,
}: {
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        minHeight: 30,
        padding: "0 10px",
        borderRadius: 7,
        border: `1px solid ${active ? "#334155" : "#cbd5e1"}`,
        background: active ? "#334155" : "rgba(255,255,255,0.96)",
        color: active ? "#ffffff" : "#475569",
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

export function ExistingBuildingMass({
  boundary,
  roads = [],
  currentBuilding,
  lotArea,
  height = 420,
}: {
  boundary?: LngLat[];
  roads?: ExistingMassRoad[];
  currentBuilding?: BuildingLookupResult | null;
  lotArea: number;
  height?: number;
}) {
  const [showBasement, setShowBasement] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("aligned");
  const [resetKey, setResetKey] = useState(0);

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
  const closedBoundary = useMemo(
    () => (openBoundary ? closeRing(openBoundary) : null),
    [openBoundary]
  );
  const local = useMemo(
    () => (closedBoundary ? boundaryToLocalRing(closedBoundary) : null),
    [closedBoundary]
  );
  const frontage = useMemo(
    () => (closedBoundary ? analyzeFrontage(closedBoundary, roads) : null),
    [closedBoundary, roads]
  );

  const ratios = useMemo(() => {
    if (!main || lotArea <= 0) return undefined;
    const calculated = (main.buildingArea / lotArea) * 100;
    const bcrPct = main.buildingCoverage > 0 ? main.buildingCoverage : calculated;
    return { bcrPct, buildingAreaSqm: main.buildingArea };
  }, [lotArea, main]);

  const frontageLabel = useMemo(() => {
    if (!frontage || frontage.frontIndex < 0 || !local) {
      return roads.length > 0 ? "접도 방향 확인 필요" : "도로 중심선 데이터 없음";
    }

    const a = local.ring[frontage.frontIndex];
    const b = local.ring[(frontage.frontIndex + 1) % local.ring.length];
    if (!a || !b) return frontage.roadName ? `${frontage.roadName} 접도` : "접도 확인";

    const direction = cardinalDirection((a.x + b.x) / 2, (a.z + b.z) / 2);
    return `${direction}측 ${frontage.roadName ?? "도로"} 접도`;
  }, [frontage, local, roads.length]);

  const axisLabel = useMemo(
    () => (local ? majorAxisLabel(local.ring) : "확인 불가"),
    [local]
  );

  if (!openBoundary || !closedBoundary || openBoundary.length < 3) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          background: "#fff",
          borderRadius: 8,
          color: "var(--fg-muted)",
          fontSize: 13,
        }}
      >
        필지 경계 데이터가 없어 3D를 표시할 수 없습니다.
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: 8,
        overflow: "hidden",
        background: "#f8fafc",
        border: "1px solid #dbe3ec",
      }}
    >
      <Canvas
        shadows
        style={{ cursor: viewMode === "orbit" ? "grab" : "default", touchAction: "none" }}
        camera={{ position: [14, 10, 14], fov: 38, near: 0.1, far: 2000 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            boundary={closedBoundary}
            roads={roads}
            currentBuilding={hasBuilding ? currentBuilding : null}
            lotArea={lotArea}
            showBasement={showBasement}
            viewMode={viewMode}
            resetKey={resetKey}
          />
        </Suspense>
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
          pointerEvents: "none",
        }}
      >
        <Chip active>GIS 방향 고정</Chip>
        <Chip>필지 실제 외곽선</Chip>
        <Chip>주건물 1개 개략</Chip>
        {main && <Chip>지상 {main.groundFloors}층</Chip>}
        {main && main.undergroundFloors > 0 && <Chip>지하 {main.undergroundFloors}층</Chip>}
        {frontage?.roadName && <Chip>{frontage.roadName}</Chip>}
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 7, pointerEvents: "auto", flexWrap: "wrap" }}>
          {main && main.undergroundFloors > 0 && (
            <ControlButton onClick={() => setShowBasement((value) => !value)}>
              지하 {showBasement ? "숨기기" : "보기"}
            </ControlButton>
          )}
          <ControlButton
            active={viewMode === "aligned"}
            onClick={() => {
              setViewMode("aligned");
              setResetKey((value) => value + 1);
            }}
          >
            지도 정합
          </ControlButton>
          <ControlButton
            active={viewMode === "orbit"}
            onClick={() => {
              setViewMode("orbit");
              setResetKey((value) => value + 1);
            }}
          >
            3D 조감
          </ControlButton>
          <ControlButton onClick={() => setResetKey((value) => value + 1)}>
            시점 초기화
          </ControlButton>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: 12,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          pointerEvents: "none",
        }}
      >
        {hasBuilding && main && ratios ? (
          <div
            style={{
              flex: "1 1 260px",
              maxWidth: 420,
              padding: "9px 11px",
              background: "rgba(255,255,255,0.96)",
              borderRadius: 7,
              border: "1px solid #dbe3ec",
              boxShadow: "0 4px 14px rgba(15,23,42,0.08)",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: "#475569",
            }}
          >
            <div style={{ fontWeight: 700, color: "#334155" }}>
              건축면적 {ratios.buildingAreaSqm.toFixed(1)}㎡ · 건폐율 {ratios.bcrPct.toFixed(1)}%
            </div>
            <div>{frontageLabel}</div>
            <div>개략 매스 장축 {axisLabel} 방향</div>
          </div>
        ) : (
          <div
            style={{
              padding: "7px 10px",
              background: "rgba(255,255,255,0.96)",
              borderRadius: 7,
              border: "1px solid #dbe3ec",
              fontSize: 12,
              color: "var(--fg-muted)",
            }}
          >
            현재 건물 없음
          </div>
        )}

        <div
          style={{
            flex: "1 1 300px",
            maxWidth: 500,
            padding: "8px 10px",
            background: "rgba(255,255,255,0.94)",
            borderRadius: 7,
            border: "1px solid #dbe3ec",
            fontSize: 10.8,
            lineHeight: 1.5,
            color: "#64748b",
          }}
        >
          지도 정합은 북쪽을 화면 위로 고정합니다. 도로 띠는 필지 바깥 방향으로만 표시하며,
          폭 {ROAD_ESTIMATED_WIDTH_M}m는 시각화용 추정값입니다. 건물 외곽은 건축물대장 면적에
          맞춘 평지붕 개략 매스이며 실제 배치도는 아닙니다.
        </div>
      </div>
    </div>
  );
}
