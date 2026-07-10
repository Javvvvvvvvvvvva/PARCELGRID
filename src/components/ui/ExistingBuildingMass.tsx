"use client";

/**
 * Stage 1 — 기존 건물 3D (현황). 대지 + 건축물대장 기반 현재 건물만 표시.
 */

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import { projectPolygon } from "@/lib/geo/project-polygon";

type LngLat = [number, number];
type Pt = { x: number; z: number };

const FLOOR_GAP = 0.1;
const GRADE_Y = 0.06;

const SKY_FLOOR: Record<number, string> = {
  1: "#7ec8e8",
  2: "#a8daf0",
  3: "#c5e8f7",
};
const SKY_DEFAULT = "#8ecae6";
const BASEMENT_COLOR = "#5c6b7a";
const SUBJECT_LOT = "#c4a574";
const SUBJECT_LOT_EDGE = "#8b6914";

function openRing(boundary: LngLat[]): LngLat[] {
  if (boundary.length > 1 && boundary[0][0] === boundary[boundary.length - 1][0]) {
    return boundary.slice(0, -1);
  }
  return boundary;
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
  const open = openRing(boundary);
  if (open.length < 3) return null;
  const closed = [...open, open[0]] as LngLat[];
  const projected = projectPolygon(closed);
  if (!projected) return null;
  const origin: LngLat = [projected.center.lng, projected.center.lat];
  const pts = projected.points;
  const openPts =
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;
  const ring = openPts.map(([x, y]) => ({ x, z: -y }));
  return { ring, origin };
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

function SubjectLot({ ring }: { ring: Pt[] }) {
  const geometry = useMemo(() => extrudeShape(ring, 0.1), [ring]);
  return (
    <mesh geometry={geometry} receiveShadow position={[0, GRADE_Y, 0]}>
      <meshStandardMaterial color={SUBJECT_LOT} roughness={0.85} metalness={0} />
    </mesh>
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
  const fill = kind === "below" ? BASEMENT_COLOR : SKY_FLOOR[floor] ?? SKY_DEFAULT;
  const label = kind === "below" ? `B${floor}` : `${floor}F`;
  const edgeX = ring.reduce((max, p) => (p.x > max ? p.x : max), ring[0]?.x ?? 0) + 0.3;
  const edgeZ = ring.reduce((s, p) => s + p.z, 0) / ring.length;

  return (
    <group>
      <mesh geometry={geometry} position={[0, baseY, 0]} castShadow receiveShadow>
        <meshStandardMaterial
          color={fill}
          transparent={kind === "above"}
          opacity={kind === "above" ? 0.92 : 0.94}
          roughness={0.45}
          metalness={0.02}
        />
      </mesh>
      <Text
        position={[edgeX, baseY + height / 2, edgeZ]}
        fontSize={0.48}
        color={kind === "below" ? "#111111" : "#0369a1"}
        anchorX="left"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

function SceneContent({
  boundary,
  currentBuilding,
  lotArea,
}: {
  boundary: LngLat[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
}) {
  const main = currentBuilding?.buildings.find((b) => b.isMainBuilding)
    ?? currentBuilding?.buildings[0];

  const local = useMemo(() => boundaryToLocalRing(boundary), [boundary]);
  const lotRing = local?.ring ?? [];
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
    let e = 8;
    lotRing.forEach((p) => {
      e = Math.max(e, Math.hypot(p.x, p.z) + 4);
    });
    return e;
  }, [lotRing]);

  const groundFloors = main?.groundFloors ?? 0;
  const basementFloors = main?.undergroundFloors ?? 0;
  const floorH = currentBuilding ? estimateFloorHeightM(currentBuilding) ?? 3 : 3;
  const aboveHeight =
    main && main.height > 0 && groundFloors > 0 ? main.height : groundFloors * floorH;

  const aboveSlabs = useMemo(() => {
    if (groundFloors <= 0 || aboveHeight <= 0) return [];
    const slabH = (aboveHeight - FLOOR_GAP * Math.max(0, groundFloors - 1)) / groundFloors;
    return Array.from({ length: groundFloors }, (_, i) => ({
      floor: i + 1,
      baseY: GRADE_Y + i * (slabH + FLOOR_GAP),
      height: slabH,
    }));
  }, [groundFloors, aboveHeight]);

  const belowSlabs = useMemo(() => {
    if (basementFloors <= 0) return [];
    return Array.from({ length: basementFloors }, (_, i) => ({
      floor: i + 1,
      baseY: GRADE_Y - (i + 1) * floorH,
      height: floorH,
    }));
  }, [basementFloors, floorH]);

  const topY = GRADE_Y + aboveHeight + 1;

  if (lotRing.length < 3) return null;

  return (
    <>
      <color attach="background" args={["#ffffff"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[8, 18, 10]} intensity={0.55} castShadow />
      <directionalLight position={[-6, 12, -8]} intensity={0.15} />

      <SubjectLot ring={lotRing} />

      {belowSlabs.map((s) => (
        <FloorSlab key={`b${s.floor}`} ring={footprint} {...s} kind="below" />
      ))}
      {aboveSlabs.map((s) => (
        <FloorSlab key={`a${s.floor}`} ring={footprint} {...s} kind="above" />
      ))}

      {groundFloors > 0 && (
        <Text position={[0, topY, 0]} fontSize={0.7} color="#475569" anchorX="center">
          {`현재 건물 · 지상 ${groundFloors}층${
            basementFloors > 0 ? ` · 지하 ${basementFloors}층` : ""
          }`}
        </Text>
      )}

      <OrbitControls
        makeDefault
        enableRotate
        enablePan
        enableZoom
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.85}
        minDistance={extent * 0.85}
        maxDistance={extent * 4}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, aboveHeight * 0.28, 0]}
      />
    </>
  );
}

function MassLegend({
  ratios,
  groundFloors,
  basementFloors,
}: {
  ratios?: { bcrPct: number; buildingAreaSqm: number };
  groundFloors: number;
  basementFloors: number;
}) {
  if (!ratios || groundFloors <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 10,
        left: 10,
        padding: "8px 10px",
        background: "rgba(255,255,255,0.96)",
        borderRadius: 6,
        fontSize: 11,
        lineHeight: 1.55,
        color: "var(--fg-muted)",
        border: "1px solid #e2e8f0",
        pointerEvents: "none",
      }}
    >
      <div>
        <span style={{ color: SUBJECT_LOT_EDGE }}>■</span> 우리 대지 ·{" "}
        <span style={{ color: SKY_DEFAULT }}>■</span> 우리 건물
      </div>
      <div>
        건축면적 {ratios.buildingAreaSqm.toFixed(1)}㎡ · 건폐율 {ratios.bcrPct.toFixed(1)}%
      </div>
      <div>
        지상 {groundFloors}층{basementFloors > 0 ? ` + 지하 ${basementFloors}층` : ""}
      </div>
    </div>
  );
}

export function ExistingBuildingMass({
  boundary,
  currentBuilding,
  lotArea,
  height = 360,
}: {
  boundary?: LngLat[];
  currentBuilding?: BuildingLookupResult | null;
  lotArea: number;
  height?: number;
}) {
  const hasBuilding = currentBuilding?.hasBuilding && (currentBuilding.buildings.length ?? 0) > 0;
  const main = currentBuilding?.buildings.find((b) => b.isMainBuilding)
    ?? currentBuilding?.buildings[0];

  const openBoundary = useMemo(() => {
    if (!boundary || boundary.length < 3) return null;
    return openRing(boundary);
  }, [boundary]);

  const ratios = useMemo(() => {
    if (!main || lotArea <= 0) return undefined;
    const bcrFromArea = (main.buildingArea / lotArea) * 100;
    const bcrPct = main.buildingCoverage > 0 ? main.buildingCoverage : bcrFromArea;
    return { bcrPct, buildingAreaSqm: main.buildingArea };
  }, [main, lotArea]);

  const extent = useMemo(() => {
    if (!openBoundary) return 12;
    const local = boundaryToLocalRing(openBoundary);
    if (!local) return 12;
    let e = 8;
    local.ring.forEach((p) => {
      e = Math.max(e, Math.hypot(p.x, p.z) + 4);
    });
    return e;
  }, [openBoundary]);

  if (!openBoundary || openBoundary.length < 3) {
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

  const camDist = extent * 1.65;

  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: 8,
        overflow: "hidden",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
      }}
    >
      <Canvas
        shadows
        style={{ cursor: "grab", touchAction: "none" }}
        camera={{ position: [camDist, camDist * 0.65, camDist], fov: 40 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            boundary={openBoundary}
            currentBuilding={hasBuilding ? currentBuilding : null}
            lotArea={lotArea}
          />
        </Suspense>
      </Canvas>
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
      {hasBuilding && main && (
        <MassLegend
          ratios={ratios}
          groundFloors={main.groundFloors}
          basementFloors={main.undergroundFloors}
        />
      )}
    </div>
  );
}
