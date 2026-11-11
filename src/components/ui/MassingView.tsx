"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { SceneText as Text } from "@/components/ui/SceneText";
import * as THREE from "three";
import { calcBuildableArea } from "@/lib/finance/buildable-area";
import { analyzeParcelFrontage } from "@/lib/geo/road-frontage";
import { layoutParkingFromBoundary } from "@/lib/geo/parking-layout";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { type LocalParcelPolygon, type ParcelBoundaryInput } from "@/lib/geo/parcel-topology";
import { resolvePlanningParcel } from "@/lib/planning/planning-parcel";
import { planningEnvelopeContainsFootprint } from "@/lib/planning/planning-massing";
import {
  calculateContextSceneFrame,
  contextCameraDistance,
  contextFlatGeometry,
  contextPrismGeometry,
  type ContextSceneFrame,
} from "@/lib/planning/context-three-geometry";

export type RoadLine = { name: string | null; points: [number, number][] };
export type SetbackSpec = { road: number; side: number; rear: number };

interface MassingInput extends ParcelBoundaryInput {
  zoning: string;
  floors: number;
  floorHeightM?: number;
  roads?: RoadLine[];
  /** Retained for callers; this preliminary legal envelope uses boundary-rule assumptions. */
  setback?: SetbackSpec;
}

export interface FloorInfo {
  floor: number;
  floorPlateSqm: number;
  pyeong: number;
  requiredSetbackM: number;
}

interface FloorMass extends FloorInfo {
  baseHeight: number;
  topHeight: number;
  polygons: LocalParcelPolygon[];
  labelPos: { x: number; z: number };
}

/** Envelope regions are not a building program or an allocation of financial floor area. */
export function buildLegacyMassingPreview(input: MassingInput) {
  const parcel = resolvePlanningParcel(input);
  const floorHeightM = input.floorHeightM ?? 3;
  const frontage = parcel.available && input.roads?.length
    ? analyzeParcelFrontage(parcel.source, input.roads, parcel.origin) : null;
  const envelope = calcBuildableArea(undefined, 0.5, input.floors, floorHeightM,
    /주거/.test(input.zoning), undefined, {
      polygons: parcel.source,
      edgeSetbacksByPolygon: frontage?.edgeSetbacksByPolygon,
    });
  const masses: FloorMass[] = envelope.stepped3D.map(step => {
    const polygons = projectParcelPolygons(step.polygons, parcel.origin);
    const east = polygons.flatMap(part => part.outer).reduce(
      (best, point) => point.x > best.x ? point : best, { x: -Infinity, z: 0 });
    return {
      floor: step.floor,
      baseHeight: (step.floor - 1) * floorHeightM,
      topHeight: step.floor * floorHeightM,
      polygons,
      floorPlateSqm: step.floorPlateSqm,
      pyeong: Math.round(step.floorPlateSqm / 3.305785),
      requiredSetbackM: step.requiredSetbackM,
      labelPos: { x: Number.isFinite(east.x) ? east.x + 2 : 0, z: east.z },
    };
  });
  // The legacy parking helper supports only a simple ring; no complex-region stall estimate.
  const front = frontage?.frontages.reduce<(typeof frontage.frontages)[number] | null>(
    (best, edge) => !best || edge.roadDistM < best.roadDistM ? edge : best, null);
  const parking = parcel.simple && front
    ? layoutParkingFromBoundary(parcel.source[0].outer, front.edgeIndex, 20) : null;
  const parkingPolygons = (parking?.spots ?? []).flatMap(spot => {
    if (!spot.cornersLngLat) return [];
    const [polygon] = projectParcelPolygons([{ outer: spot.cornersLngLat, holes: [] }], parcel.origin);
    return planningEnvelopeContainsFootprint(polygon.outer, {
      level: 1, shape: [], polygons: parcel.polygons, envelopeAreaSqm: 0,
      requiredSetbackM: 0, envelopeAvailable: parcel.available,
    }) ? [polygon] : [];
  });
  const frame = calculateContextSceneFrame({
    polygons: [...parcel.polygons, ...masses.flatMap(mass => mass.polygons)],
    lines: masses.filter(mass => mass.polygons.length).map(mass => [mass.labelPos, { x: mass.labelPos.x + 14, z: mass.labelPos.z }]),
    heightM: Math.max(0, ...masses.map(mass => mass.topHeight)),
  });
  return { parcel, masses, frame, parkingPolygons, envelopeStatus: envelope.geometryStatus,
    warnings: envelope.warnings, parkingStatus: "unverified" as const };
}

function floorColor(floor: number, total: number): string {
  const t = total <= 1 ? 0 : (floor - 1) / (total - 1);
  return `hsl(213, 72%, ${46 + t * 22}%)`;
}

function FloorComponent({ polygon, mass, color, active, onSelect, onHover }: {
  polygon: LocalParcelPolygon;
  mass: FloorMass;
  color: string;
  active: boolean;
  onSelect: (floor: number) => void;
  onHover: (floor: number | null) => void;
}) {
  const geometry = useMemo(() => contextPrismGeometry(polygon, mass.baseHeight, mass.topHeight),
    [polygon, mass.baseHeight, mass.topHeight]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group>
      <mesh geometry={geometry}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(mass.floor); }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation(); onHover(mass.floor); document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => { onHover(null); document.body.style.cursor = "default"; }}
      >
        <meshStandardMaterial color={active ? "#f59e0b" : color} transparent
          opacity={active ? 0.85 : 0.6} roughness={0.55} metalness={0.05} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#1e3a5f" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}

function GroundPlate({ polygon, parking = false }: { polygon: LocalParcelPolygon; parking?: boolean }) {
  const geometry = useMemo(() => contextFlatGeometry(polygon), [polygon]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group position={[0, parking ? 0.02 : -0.05, 0]}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={parking ? "#64748b" : "#e2e8f0"} roughness={0.9}
          side={THREE.DoubleSide} transparent={parking} opacity={parking ? 0.35 : 1} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={parking ? "#334155" : "#94a3b8"} />
      </lineSegments>
    </group>
  );
}

function SceneCamera({ frame }: { frame: ContextSceneFrame }) {
  const { camera, size, invalidate } = useThree();
  const distance = contextCameraDistance(frame.radius, 45, size.width / Math.max(1, size.height));
  useEffect(() => {
    const target = new THREE.Vector3(...frame.center);
    camera.position.copy(new THREE.Vector3(1.8, 1.8, 2.2).normalize().multiplyScalar(distance).add(target));
    camera.lookAt(target);
    camera.near = 0.1;
    camera.far = distance * 5 + frame.radius * 2;
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, distance, frame, invalidate]);
  return <OrbitControls target={frame.center} enablePan enableZoom enableRotate
    minDistance={frame.radius * 0.5} maxDistance={distance * 4} maxPolarAngle={Math.PI / 2.05} />;
}

function Scene({ preview, selectedFloor, hoveredFloor, onSelect, onHover }: {
  preview: ReturnType<typeof buildLegacyMassingPreview>;
  selectedFloor: number | null;
  hoveredFloor: number | null;
  onSelect: (floor: number) => void;
  onHover: (floor: number | null) => void;
}) {
  const { parcel, masses, frame, parkingPolygons } = preview;
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[frame.radius, frame.radius * 2, frame.radius]} intensity={1.1} />
      <directionalLight position={[-frame.radius, frame.radius, -frame.radius]} intensity={0.4} />
      {parcel.polygons.map((polygon, index) => <GroundPlate key={`lot-${index}`} polygon={polygon} />)}
      {parkingPolygons.map((polygon, index) => <GroundPlate key={`parking-${index}`} polygon={polygon} parking />)}
      {masses.map(mass => (
        <group key={mass.floor}>
          {mass.polygons.map((polygon, index) => (
            <FloorComponent key={index} polygon={polygon} mass={mass}
              color={floorColor(mass.floor, masses.length)}
              active={selectedFloor === mass.floor || hoveredFloor === mass.floor}
              onSelect={onSelect} onHover={onHover} />
          ))}
          {mass.polygons.length > 0 && <Text
            position={[mass.labelPos.x, (mass.baseHeight + mass.topHeight) / 2, mass.labelPos.z]}
            fontSize={1.3} color="#334155" anchorX="left" anchorY="middle"
          >{`${mass.floor}F · 개념 영역`}</Text>}
        </group>
      ))}
      <Text position={[frame.center[0], 0.1, frame.center[2] - frame.radius * 0.75]}
        fontSize={frame.radius * 0.12} color="#dc2626" anchorX="center" anchorY="middle"
        rotation={[-Math.PI / 2, 0, 0]}>N</Text>
      <SceneCamera frame={frame} />
    </>
  );
}

export function MassingView({ boundary, boundaryPolygons, zoning, floors, units = 0,
  floorHeightM = 3, roads, setback, height = 440,
}: MassingInput & { units?: number; height?: number }) {
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [hoveredFloor, setHoveredFloor] = useState<number | null>(null);
  const preview = useMemo(() => buildLegacyMassingPreview({ boundary, boundaryPolygons,
    zoning, floors, floorHeightM, roads, setback }),
  [boundary, boundaryPolygons, zoning, floors, floorHeightM, roads, setback]);
  if (!preview.parcel.available) return (
    <div data-massing-status="unavailable" style={{ height, display: "grid", placeItems: "center",
      fontSize: 13, color: "var(--fg-subtle)", border: "1px solid var(--border)", borderRadius: 12,
      background: "var(--bg-sunken)" }}>
      대지 경계가 없거나 유효하지 않아 3D를 표시할 수 없습니다. 재무값은 변경되지 않습니다.
    </div>
  );
  const info = preview.masses.find(mass => mass.floor === selectedFloor);
  return (
    <div data-massing-status={preview.envelopeStatus} data-parking-status={preview.parkingStatus}
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 200px)", gap: 12 }}>
      <div style={{ height, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)",
        background: "linear-gradient(180deg, var(--bg-elev), var(--bg-sunken))" }}>
        <Canvas camera={{ position: [30, 30, 30], fov: 45, near: 0.1 }}
          onPointerMissed={() => setSelectedFloor(null)}>
          <Suspense fallback={null}>
            <Scene preview={preview} selectedFloor={selectedFloor} hoveredFloor={hoveredFloor}
              onSelect={floor => setSelectedFloor(current => current === floor ? null : floor)}
              onHover={setHoveredFloor} />
          </Suspense>
        </Canvas>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14,
        background: "var(--bg-elev)", fontSize: 12.5, height, overflowY: "auto", overflowWrap: "anywhere" }}>
        <p style={{ marginTop: 0, lineHeight: 1.5, color: "var(--fg-muted)" }}>
          개념 건축 가능 영역입니다. 분리된 영역은 확정된 여러 동의 배치가 아닙니다.
          세대수·사업면적을 형상에 배분하지 않으며 재무값은 변경되지 않습니다.
        </p>
        <PanelRow label="재무 가정" value={`${units}세대 · 배치 미확인`} />
        <p style={{ lineHeight: 1.5, color: "var(--warn-fg)" }}>
          주차 미검증 · {preview.parcel.simple ? "표시 후보의 동선·대수는 확정되지 않았습니다." : "복합 경계의 주차 배치·대수를 산정하지 않았습니다."}
        </p>
        {preview.warnings.map((warning, index) => <p key={index} style={{ lineHeight: 1.5 }}>{warning}</p>)}
        {info ? <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{info.floor}층 개념 영역</div>
          <PanelRow label="영역 면적" value={`${info.floorPlateSqm.toFixed(1)}㎡ (${info.pyeong}평)`} />
          <PanelRow label="정북 이격" value={info.requiredSetbackM > 0 ? `${info.requiredSetbackM}m 후퇴` : "없음"} />
        </> : <div style={{ color: "var(--fg-subtle)", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--fg-muted)" }}>층별 개념 영역</div>
          {preview.masses.slice().reverse().map(mass => <button key={mass.floor} type="button"
            onClick={() => setSelectedFloor(mass.floor)} style={{ display: "flex", justifyContent: "space-between",
              flexWrap: "wrap", gap: 4, width: "100%", padding: "4px 6px", border: 0,
              background: "transparent", color: "inherit", cursor: "pointer" }}>
            <span style={{ fontWeight: 600 }}>{mass.floor}F</span><span>{mass.pyeong}평 · 개념</span>
          </button>)}
        </div>}
      </div>
    </div>
  );
}

function PanelRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 4,
    padding: "6px 0", borderBottom: "1px solid var(--border-faint, var(--border))" }}>
    <span style={{ color: "var(--fg-muted)" }}>{label}</span><span style={{ fontWeight: 600 }}>{value}</span>
  </div>;
}
