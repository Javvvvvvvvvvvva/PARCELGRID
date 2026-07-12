"use client";

/**
 * Stage 1 — 기존 건물 개략 매스.
 *
 * 건축물대장의 면적·층수·높이를 사용하되 실제 건물 외곽선과 위치 데이터는
 * 제공되지 않으므로 대지 형상을 건폐율 비율로 축소한 개략 배치로 표현한다.
 */

import { Suspense, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";
import { projectPolygon } from "@/lib/geo/project-polygon";

type LngLat = [number, number];
type Pt = { x: number; z: number };

const FLOOR_GAP = 0.06;
const GRADE_Y = 0.08;
const LOT_COLOR = "#e8e1d5";
const LOT_EDGE = "#9a8767";
const BUILDING_COLOR = "#d9e0e5";
const BUILDING_EDGE = "#64748b";
const BASEMENT_COLOR = "#566371";

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

function boundaryToLocalRing(boundary: LngLat[]): { ring: Pt[] } | null {
  const open = openRing(boundary);
  if (open.length < 3) return null;
  const closed = [...open, open[0]] as LngLat[];
  const projected = projectPolygon(closed);
  if (!projected) return null;

  const pts = projected.points;
  const openPts =
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
      ? pts.slice(0, -1)
      : pts;

  return { ring: openPts.map(([x, y]) => ({ x, z: -y })) };
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
      <Edges
        threshold={12}
        color={kind === "below" ? "#263442" : BUILDING_EDGE}
      />
    </mesh>
  );
}

function SceneContent({
  boundary,
  currentBuilding,
  lotArea,
  showBasement,
}: {
  boundary: LngLat[];
  currentBuilding: BuildingLookupResult | null | undefined;
  lotArea: number;
  showBasement: boolean;
}) {
  const main =
    currentBuilding?.buildings.find((b) => b.isMainBuilding) ??
    currentBuilding?.buildings[0];

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
      e = Math.max(e, Math.hypot(p.x, p.z) + 2.5);
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
    const slabH =
      (aboveHeight - FLOOR_GAP * Math.max(0, groundFloors - 1)) / groundFloors;
    return Array.from({ length: groundFloors }, (_, i) => ({
      floor: i + 1,
      baseY: GRADE_Y + 0.12 + i * (slabH + FLOOR_GAP),
      height: slabH,
    }));
  }, [groundFloors, aboveHeight]);

  const belowSlabs = useMemo(() => {
    if (!showBasement || basementFloors <= 0) return [];
    return Array.from({ length: basementFloors }, (_, i) => ({
      floor: i + 1,
      baseY: GRADE_Y - (i + 1) * floorH,
      height: floorH - FLOOR_GAP,
    }));
  }, [showBasement, basementFloors, floorH]);

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
      <gridHelper
        args={[extent * 2.6, 18, "#d7dde1", "#eaedef"]}
        position={[0, 0, 0]}
      />

      <SubjectLot ring={lotRing} cutaway={showBasement} />

      {belowSlabs.map((s) => (
        <FloorMass key={`b${s.floor}`} ring={footprint} {...s} kind="below" />
      ))}
      {aboveSlabs.map((s) => (
        <FloorMass key={`a${s.floor}`} ring={footprint} {...s} kind="above" />
      ))}

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
}: {
  groundFloors: number;
  basementFloors: number;
  buildingAreaSqm: number;
  bcrPct: number;
}) {
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
      {["개략 형상", `지상 ${groundFloors}층`, ...(basementFloors > 0 ? [`지하 ${basementFloors}층`] : [])].map(
        (label) => (
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
        )
      )}
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
  currentBuilding,
  lotArea,
  height = 360,
}: {
  boundary?: LngLat[];
  currentBuilding?: BuildingLookupResult | null;
  lotArea: number;
  height?: number;
}) {
  const [showBasement, setShowBasement] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);

  const hasBuilding = Boolean(
    currentBuilding?.hasBuilding && (currentBuilding.buildings.length ?? 0) > 0
  );
  const main =
    currentBuilding?.buildings.find((b) => b.isMainBuilding) ??
    currentBuilding?.buildings[0];

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
      e = Math.max(e, Math.hypot(p.x, p.z) + 2.5);
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

  const camDist = extent * 1.3;

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
        camera={{ position: [camDist, camDist * 0.72, camDist], fov: 35 }}
      >
        <Suspense fallback={null}>
          <SceneContent
            boundary={openBoundary}
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
        />
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          gap: 6,
        }}
      >
        {hasBuilding && (main?.undergroundFloors ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setShowBasement((v) => !v)}
            style={controlStyle(showBasement)}
          >
            {showBasement ? "지하 숨기기" : "지하 보기"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setCanvasKey((v) => v + 1)}
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
            maxWidth: 310,
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
          대지 형상을 건폐율 비율로 축소한 개략 배치입니다. 실제 건물 외곽선·위치와 다를 수 있습니다.
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
