"use client";

/**
 * Stage 1 — 기존 건물 개략 매스.
 * 필지·도로를 동일한 WGS84 원점으로 투영해 실제 방향 관계를 유지한다.
 * 건물 외곽은 건축물대장 건축면적에 맞춰 필지 형상을 축소한 개략 형상이다.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
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

const FLOOR_GAP = 0.1;
const GRADE_Y = 0.06;
const ROAD_ESTIMATED_WIDTH_M = 4.5;

const ABOVE_COLOR = "#d9dee5";
const ABOVE_EDGE = "#7f95ad";
const BASEMENT_COLOR = "#536579";
const BASEMENT_EDGE = "#334155";
const SUBJECT_LOT = "#e9f3ff";
const SUBJECT_LOT_EDGE = "#2563eb";
const ROAD_COLOR = "#64748b";
const PRIMARY_ROAD_COLOR = "#475569";

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

function ringCentroidPt(ring: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  return { x: x / ring.length, z: z / ring.length };
}

function boundaryToLocalRing(boundary: LngLat[]): { ring: Pt[]; origin: LngLat } | null {
  const closed = closeRing(boundary);
  if (closed.length < 4) return null;
  const projected = projectPolygon(closed);
  if (!projected) return null;

  const openPts = openRing(projected.points as LngLat[]);
  return {
    ring: openPts.map(([x, y]) => ({ x, z: -y })),
    origin: [projected.center.lng, projected.center.lat],
  };
}

function lngLatToLocal(point: LngLat, origin: LngLat): Pt {
  const lngMetersPerDeg = 111320 * Math.cos((origin[1] * Math.PI) / 180);
  const latMetersPerDeg = 110540;
  return {
    x: (point[0] - origin[0]) * lngMetersPerDeg,
    z: -(point[1] - origin[1]) * latMetersPerDeg,
  };
}

function scaleRingTowardCenter(ring: Pt[], areaRatio: number): Pt[] {
  const factor = Math.sqrt(Math.max(0.04, Math.min(1, areaRatio)));
  const c = ringCentroidPt(ring);
  return ring.map((p) => ({
    x: c.x + (p.x - c.x) * factor,
    z: c.z + (p.z - c.z) * factor,
  }));
}

function extrudeShape(ring: Pt[], depth: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  ring.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.z);
    else shape.lineTo(p.x, p.z);
  });
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function cardinalDirection(x: number, z: number): string {
  const angle = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
  const labels = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
  return labels[Math.round(angle / 45) % 8];
}

function majorAxisLabel(ring: Pt[]): string {
  if (ring.length < 3) return "확인 불가";
  const c = ringCentroidPt(ring);
  let xx = 0;
  let zz = 0;
  let xz = 0;
  for (const p of ring) {
    const x = p.x - c.x;
    const z = p.z - c.z;
    xx += x * x;
    zz += z * z;
    xz += x * z;
  }
  const theta = 0.5 * Math.atan2(2 * xz, xx - zz);
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 180;

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

  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
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
    for (let i = 0; i < points.length - 1; i += 1) {
      const clipped = clipSegmentToSquare(points[i], points[i + 1], limit);
      if (!clipped) continue;
      const [a, b] = clipped;
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.2) continue;
      segments.push({ name: road.name, a, b });
    }
  }
  return segments;
}

function SubjectLot({ ring }: { ring: Pt[] }) {
  const geometry = useMemo(() => extrudeShape(ring, 0.08), [ring]);
  const linePoints = useMemo(
    () => [...ring, ring[0]].map((p) => [p.x, GRADE_Y + 0.1, p.z] as [number, number, number]),
    [ring]
  );

  return (
    <group>
      <mesh geometry={geometry} receiveShadow position={[0, GRADE_Y, 0]}>
        <meshStandardMaterial
          color={SUBJECT_LOT}
          transparent
          opacity={0.72}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <Line points={linePoints} color={SUBJECT_LOT_EDGE} lineWidth={2.2} />
    </group>
  );
}

function RoadSegmentMesh({
  segment,
  primary,
}: {
  segment: RoadSegment;
  primary: boolean;
}) {
  const geometry = useMemo(() => {
    const { a, b } = segment;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (-dz / length) * (ROAD_ESTIMATED_WIDTH_M / 2);
    const nz = (dx / length) * (ROAD_ESTIMATED_WIDTH_M / 2);
    const vertices = new Float32Array([
      a.x + nx, 0, a.z + nz,
      a.x - nx, 0, a.z - nz,
      b.x - nx, 0, b.z - nz,
      b.x + nx, 0, b.z + nz,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeVertexNormals();
    return geo;
  }, [segment]);

  return (
    <mesh geometry={geometry} position={[0, 0.015, 0]} receiveShadow>
      <meshStandardMaterial
        color={primary ? PRIMARY_ROAD_COLOR : ROAD_COLOR}
        roughness={0.95}
        metalness={0}
      />
    </mesh>
  );
}

function RoadLayer({
  segments,
  primaryRoadName,
}: {
  segments: RoadSegment[];
  primaryRoadName: string | null;
}) {
  const labelSegment = useMemo(() => {
    const candidates = segments.filter(
      (segment) => primaryRoadName && segment.name === primaryRoadName
    );
    const pool = candidates.length > 0 ? candidates : segments;
    return pool.reduce<RoadSegment | null>((best, segment) => {
      if (!best) return segment;
      const bestDist = Math.hypot(
        (best.a.x + best.b.x) / 2,
        (best.a.z + best.b.z) / 2
      );
      const dist = Math.hypot(
        (segment.a.x + segment.b.x) / 2,
        (segment.a.z + segment.b.z) / 2
      );
      return dist < bestDist ? segment : best;
    }, null);
  }, [segments, primaryRoadName]);

  return (
    <group>
      {segments.map((segment, index) => (
        <RoadSegmentMesh
          key={`${segment.name ?? "road"}-${index}`}
          segment={segment}
          primary={Boolean(primaryRoadName && segment.name === primaryRoadName)}
        />
      ))}
      {labelSegment && (primaryRoadName || labelSegment.name) && (
        <Text
          position={[
            (labelSegment.a.x + labelSegment.b.x) / 2,
            0.35,
            (labelSegment.a.z + labelSegment.b.z) / 2,
          ]}
          fontSize={0.65}
          color="#334155"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.03}
          outlineColor="#ffffff"
        >
          {primaryRoadName || labelSegment.name || "도로"}
        </Text>
      )}
    </group>
  );
}

function FloorSlab({
  ring,
  baseY,
  height,
  floor,
  kind,
}: {
  ring: Pt[];
  baseY: number;
  height: number;
  floor: number;
  kind: "above" | "below";
}) {
  const geometry = useMemo(() => extrudeShape(ring, height), [ring, height]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, 20), [geometry]);
  const fill = kind === "below" ? BASEMENT_COLOR : ABOVE_COLOR;
  const edge = kind === "below" ? BASEMENT_EDGE : ABOVE_EDGE;
  const label = kind === "below" ? `B${floor}` : `${floor}F`;
  const edgeX = ring.reduce((max, p) => (p.x > max ? p.x : max), ring[0]?.x ?? 0) + 0.3;
  const edgeZ = ring.reduce((sum, p) => sum + p.z, 0) / ring.length;

  return (
    <group>
      <mesh geometry={geometry} position={[0, baseY, 0]} castShadow receiveShadow>
        <meshStandardMaterial
          color={fill}
          transparent={kind === "above"}
          opacity={kind === "above" ? 0.94 : 0.9}
          roughness={0.65}
          metalness={0.01}
        />
      </mesh>
      <lineSegments geometry={edges} position={[0, baseY, 0]}>
        <lineBasicMaterial color={edge} />
      </lineSegments>
      <Text
        position={[edgeX, baseY + height / 2, edgeZ]}
        fontSize={0.46}
        color={kind === "below" ? "#f8fafc" : "#475569"}
        anchorX="left"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

function NorthArrow({ extent }: { extent: number }) {
  const x = -extent * 0.68;
  const z = extent * 0.66;
  const length = Math.max(2.5, Math.min(5, extent * 0.32));
  const tipZ = z - length;

  return (
    <group>
      <Line
        points={[
          [x, 0.18, z],
          [x, 0.18, tipZ],
        ]}
        color="#0f172a"
        lineWidth={2.4}
      />
      <Line
        points={[
          [x, 0.18, tipZ],
          [x - 0.55, 0.18, tipZ + 0.85],
        ]}
        color="#0f172a"
        lineWidth={2.4}
      />
      <Line
        points={[
          [x, 0.18, tipZ],
          [x + 0.55, 0.18, tipZ + 0.85],
        ]}
        color="#0f172a"
        lineWidth={2.4}
      />
      <Text
        position={[x, 0.32, tipZ - 0.75]}
        fontSize={0.72}
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
    const target = new THREE.Vector3(0, targetY, 0);
    const position =
      viewMode === "aligned"
        ? new THREE.Vector3(extent * 1.05, extent * 0.95, extent * 1.25)
        : new THREE.Vector3(extent * 1.35, extent * 0.9, extent * 1.35);

    const direction = target.clone().sub(position).normalize();
    const north = new THREE.Vector3(0, 0, -1);
    const projectedNorth = north
      .clone()
      .sub(direction.clone().multiplyScalar(north.dot(direction)));

    camera.position.copy(position);
    camera.up.copy(
      projectedNorth.lengthSq() > 1e-6
        ? projectedNorth.normalize()
        : new THREE.Vector3(0, 1, 0)
    );
    camera.lookAt(target);
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
      value = Math.max(value, Math.hypot(point.x, point.z) + 4);
    });
    return value;
  }, [lotRing]);

  const roadSegments = useMemo(
    () => (local ? buildRoadSegments(roads, local.origin, extent * 1.45) : []),
    [extent, local, roads]
  );
  const frontage = useMemo(
    () => analyzeFrontage(closeRing(boundary), roads),
    [boundary, roads]
  );

  const groundFloors = main?.groundFloors ?? 0;
  const basementFloors = main?.undergroundFloors ?? 0;
  const floorH = currentBuilding ? estimateFloorHeightM(currentBuilding) ?? 3 : 3;
  const aboveHeight =
    main && main.height > 0 && groundFloors > 0 ? main.height : groundFloors * floorH;

  const aboveSlabs = useMemo(() => {
    if (groundFloors <= 0 || aboveHeight <= 0) return [];
    const slabH =
      (aboveHeight - FLOOR_GAP * Math.max(0, groundFloors - 1)) / groundFloors;
    return Array.from({ length: groundFloors }, (_, index) => ({
      floor: index + 1,
      baseY: GRADE_Y + index * (slabH + FLOOR_GAP),
      height: slabH,
    }));
  }, [groundFloors, aboveHeight]);

  const belowSlabs = useMemo(() => {
    if (basementFloors <= 0) return [];
    return Array.from({ length: basementFloors }, (_, index) => ({
      floor: index + 1,
      baseY: GRADE_Y - (index + 1) * floorH,
      height: floorH,
    }));
  }, [basementFloors, floorH]);

  if (lotRing.length < 3) return null;

  const targetY = aboveHeight * 0.26;

  return (
    <>
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[8, 18, 10]} intensity={0.62} castShadow />
      <directionalLight position={[-6, 12, -8]} intensity={0.18} />

      <gridHelper
        args={[extent * 2.9, Math.max(10, Math.round(extent * 1.4)), "#d8e1eb", "#edf2f7"]}
        position={[0, 0, 0]}
      />
      <RoadLayer segments={roadSegments} primaryRoadName={frontage?.roadName ?? null} />
      <SubjectLot ring={lotRing} />

      {showBasement &&
        belowSlabs.map((slab) => (
          <FloorSlab key={`b${slab.floor}`} ring={footprint} {...slab} kind="below" />
        ))}
      {aboveSlabs.map((slab) => (
        <FloorSlab key={`a${slab.floor}`} ring={footprint} {...slab} kind="above" />
      ))}

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
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.8}
        minDistance={extent * 0.75}
        maxDistance={extent * 4}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, targetY, 0]}
      />
    </>
  );
}

function Chip({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
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
  children: React.ReactNode;
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
    const bcrFromArea = (main.buildingArea / lotArea) * 100;
    const bcrPct = main.buildingCoverage > 0 ? main.buildingCoverage : bcrFromArea;
    return { bcrPct, buildingAreaSqm: main.buildingArea };
  }, [main, lotArea]);

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
        camera={{ position: [14, 10, 14], fov: 40 }}
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

      {hasBuilding && main && ratios && (
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            maxWidth: 420,
            padding: "9px 11px",
            background: "rgba(255,255,255,0.96)",
            borderRadius: 7,
            border: "1px solid #dbe3ec",
            boxShadow: "0 4px 14px rgba(15,23,42,0.08)",
            fontSize: 11.5,
            lineHeight: 1.55,
            color: "#475569",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700, color: "#334155" }}>
            건축면적 {ratios.buildingAreaSqm.toFixed(1)}㎡ · 건폐율 {ratios.bcrPct.toFixed(1)}%
          </div>
          <div>{frontageLabel}</div>
          <div>개략 매스 장축 {axisLabel} 방향</div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          maxWidth: 410,
          padding: "8px 10px",
          background: "rgba(255,255,255,0.94)",
          borderRadius: 7,
          border: "1px solid #dbe3ec",
          fontSize: 10.8,
          lineHeight: 1.5,
          color: "#64748b",
          pointerEvents: "none",
          textAlign: "left",
        }}
      >
        필지·도로는 동일한 GIS 좌표계로 정합했습니다. 건물 외곽은 건축물대장 면적에 맞춘
        개략 형상이며, 도로 폭 {ROAD_ESTIMATED_WIDTH_M}m는 시각화용 추정값입니다.
      </div>

      {!hasBuilding && (
        <div
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            padding: "6px 10px",
            background: "rgba(255,255,255,0.95)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--fg-muted)",
            border: "1px solid #e2e8f0",
            pointerEvents: "none",
          }}
        >
          현재 건물 없음
        </div>
      )}
    </div>
  );
}
