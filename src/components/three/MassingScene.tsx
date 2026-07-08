"use client";

/**
 * 사업성 매싱 3D 씬.
 *
 * 부지 폴리곤을 평면 미터로 투영 → 바닥 + 용적률 높이만큼 건물 extrude.
 * 색 = 사업성 (흑자 초록 / 손실 빨강). 설계가 아니라 "판단"을 위한 3D.
 *
 * R3F v9 + drei v10 (React 19). SSR 회피 위해 부모에서 dynamic import.
 */

import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Line } from "@react-three/drei";
import { useMemo, useState } from "react";
import * as THREE from "three";
import { projectPolygon } from "@/lib/geo/project-polygon";
import { analyzeOrientation } from "@/lib/geo/orientation";
import { analyzeFrontage } from "@/lib/geo/road-frontage";

interface MassingSceneProps {
  /** 부지 경계 [lng, lat][] (WGS84) — store의 parcel.boundary */
  boundary?: [number, number][];
  /** 캔버스 높이 (사이드바=280, 탭=560) */
  height?: number;
  /** 정북·북측 변 표시 (기본 true) */
  showNorth?: boolean;
  /** 부지 주변 도로 — 전면 식별·표시용 */
  roads?: { name: string | null; points: [number, number][] }[];
  /** 건물 매싱 파라미터 (없으면 바닥만) */
  massing?: {
    /** 연면적 (㎡) */
    gfa: number;
    /** 건폐율 (%) — footprint = 대지×bcr */
    bcr: number;
    /** 지상 층수 */
    floorsAbove: number;
    /** 사업성: true=흑자(초록) / false=손실(빨강) */
    viable: boolean;
  };
}

export function MassingScene({ boundary, height = 280, massing, showNorth = true, roads }: MassingSceneProps) {
  const projected = useMemo(
    () => (boundary && boundary.length >= 4 ? projectPolygon(boundary) : null),
    [boundary]
  );

  if (!projected) {
    return (
      <div
        style={{
          height,
          display: "grid",
          placeItems: "center",
          color: "var(--fg-subtle)",
          fontSize: 13,
          background: "var(--bg-sunken)",
          borderRadius: 8,
        }}
      >
        대지 경계 데이터가 없습니다. 부지를 다시 분석해 주세요.
      </div>
    );
  }

  const orientation = useMemo(
    () => (boundary && boundary.length >= 4 ? analyzeOrientation(boundary) : null),
    [boundary]
  );

  const frontage = useMemo(
    () =>
      boundary && boundary.length >= 4 && roads && roads.length > 0
        ? analyzeFrontage(boundary, roads)
        : null,
    [boundary, roads]
  );

  const span = Math.max(projected.widthM, projected.depthM);
  const camDist = span * 2.4;
  const [compassAngle, setCompassAngle] = useState(0);

  // 건물 높이: 층수 × 3m (층고). massing 없으면 0 (바닥만)
  const buildingHeight = massing ? Math.max(1, massing.floorsAbove) * 3 : 0;

  return (
    <div style={{ height, borderRadius: 8, overflow: "hidden", background: "#f0efec", position: "relative" }}>
      <Compass angle={compassAngle} />
      <Canvas
        camera={{ position: [camDist * 0.6, camDist * 0.75, camDist * 0.6], fov: 42 }}
        dpr={[1, 2]}
        shadows
      >
        <ambientLight intensity={0.65} />
        <directionalLight
          position={[span * 1.5, span * 2.5, span * 1.2]}
          intensity={1.15}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />

        <Grid
          args={[span * 5, span * 5]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#d8d6d0"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#bfbdb6"
          fadeDistance={span * 6}
          position={[0, -0.01, 0]}
        />

        {/* 대지 바닥 */}
        <LotFloor points={projected.points} />

        {/* 정북 방향 + 북측 변 (일조 사선제한 기준) */}
        {showNorth && orientation && (
          <NorthIndicator
            points={projected.points}
            northEdgeIndex={orientation.northEdgeIndex}
          />
        )}

        {/* 주변 도로 — 실제 좌표를 바닥에 선으로 (전면=파랑, 나머지=회색) */}
        {roads && roads.length > 0 && (
          <RoadLines
            roads={roads}
            center={projected.center}
            span={span}
            frontRoadName={frontage?.roadName ?? null}
          />
        )}

        {/* 건물 매싱 (massing 있을 때만) */}
        {massing && buildingHeight > 0 && (
          <Building
            points={projected.points}
            height={buildingHeight}
            viable={massing.viable}
          />
        )}

        <OrbitControls
          enablePan={false}
          minDistance={span * 0.8}
          maxDistance={camDist * 2.5}
          maxPolarAngle={Math.PI / 2.05}
        />
        <CameraTracker onAngle={setCompassAngle} />
      </Canvas>
    </div>
  );
}

/** 폴리곤 → THREE.Shape (XY) */
function polygonShape(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

/** 대지 폴리곤 바닥 (금색 반투명) */
function LotFloor({ points }: { points: [number, number][] }) {
  const geometry = useMemo(() => {
    const geo = new THREE.ShapeGeometry(polygonShape(points));
    geo.rotateX(-Math.PI / 2); // XY → XZ(바닥)
    return geo;
  }, [points]);

  return (
    <mesh geometry={geometry} receiveShadow position={[0, 0, 0]}>
      <meshStandardMaterial
        color="#c9a227"
        opacity={0.4}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** 건물 매싱 — 대지 형상을 높이만큼 extrude. 색 = 사업성 */
function Building({
  points,
  height,
  viable,
}: {
  points: [number, number][];
  height: number;
  viable: boolean;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.ExtrudeGeometry(polygonShape(points), {
      depth: height,
      bevelEnabled: false,
    });
    // ExtrudeGeometry는 +Z로 솟음 → XZ 평면에 세우려면 X축 -90° 회전
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [points, height]);

  // 흑자=차분한 초록(--pos 계열), 손실=벽돌 빨강(--neg 계열)
  const color = viable ? "#4a7c59" : "#9b5a52";

  // 층 구분선 (각 층 경계를 수평선으로 — 몇 층인지 보임)
  const floorLines = useMemo(() => {
    const floors = Math.max(1, Math.round(height / 3));
    const lines: [number, number, number][][] = [];
    for (let f = 1; f < floors; f++) {
      const y = (height / floors) * f;
      const ring: [number, number, number][] = points.map((p) => [p[0], y, -p[1]]);
      lines.push(ring);
    }
    return lines;
  }, [points, height]);

  return (
    <group>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial
          color={color}
          opacity={0.82}
          transparent
          roughness={0.7}
          metalness={0.05}
        />
      </mesh>
      {/* 층 구분선 (흰색 반투명) */}
      {floorLines.map((ring, i) => (
        <Line key={i} points={ring} color="#ffffff" lineWidth={1} transparent opacity={0.35} />
      ))}
    </group>
  );
}

/** 정북 방향 화살표 + 북측 변 하이라이트 (일조 사선제한 적용 대상) */
function NorthIndicator({
  points,
  northEdgeIndex,
}: {
  points: [number, number][];
  northEdgeIndex: number;
}) {
  // 북측 변 두 끝점 (XZ 평면: x=x, z=-y)
  const p1 = points[northEdgeIndex];
  const p2 = points[northEdgeIndex + 1] ?? points[0];
  const northLine: [number, number, number][] = [
    [p1[0], 0.05, -p1[1]],
    [p2[0], 0.05, -p2[1]],
  ];

  return (
    <group>
      {/* 북측 변 — 주황 굵은 선 (일조 정북 사선제한 적용 경계) */}
      <Line points={northLine} color="#c2410c" lineWidth={4} />
    </group>
  );
}

/** 주변 도로 중심선을 바닥에 그림. 부지 근처만, 전면 도로는 파랑. */
function RoadLines({
  roads,
  center,
  span,
  frontRoadName,
}: {
  roads: { name: string | null; points: [number, number][] }[];
  center: { lng: number; lat: number };
  span: number;
  frontRoadName: string | null;
}) {
  const lat0 = center.lat;
  const LNG = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const LAT = 110540;
  const maxDist = span * 3; // 부지 근처만

  const lines: { pts: [number, number, number][]; isFront: boolean }[] = [];
  for (const road of roads) {
    const planar = road.points.map(
      (p): [number, number] => [(p[0] - center.lng) * LNG, (p[1] - center.lat) * LAT]
    );
    // 부지 중심에서 최소거리 — 멀면 스킵
    const minD = Math.min(...planar.map((p) => Math.hypot(p[0], p[1])));
    if (minD > maxDist) continue;
    // 부지 근처 점만 (화면 밖 먼 직선 제거)
    const nearPts = planar.filter((p) => Math.hypot(p[0], p[1]) < maxDist * 1.5);
    if (nearPts.length < 2) continue;
    // 3D 좌표 (XZ 바닥, z=-y)
    const pts3: [number, number, number][] = nearPts.map((p) => [p[0], 0.03, -p[1]]);
    const isFront = frontRoadName != null && road.name === frontRoadName;
    lines.push({ pts: pts3, isFront });
  }

  return (
    <group>
      {lines.map((ln, i) => (
        <Line
          key={i}
          points={ln.pts}
          color={ln.isFront ? "#2563eb" : "#9ca3af"}
          lineWidth={ln.isFront ? 4 : 2}
        />
      ))}
    </group>
  );
}

/** 카메라 방위각 추적 → 나침반 회전각 전달 */
function CameraTracker({ onAngle }: { onAngle: (deg: number) => void }) {
  const { camera } = useThree();
  useFrame(() => {
    // 북=-z. 카메라 방위각의 반대 = 나침반 N 회전
    const az = (Math.atan2(camera.position.x, camera.position.z) * 180) / Math.PI;
    onAngle(-az);
  });
  return null;
}

/** 코너 고정 나침반 (HTML 오버레이) — 씬 회전해도 항상 정북 표시 */
function Compass({ angle }: { angle: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 14,
        bottom: 14,
        width: 52,
        height: 52,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.9)",
        border: "1px solid var(--border, #e4e3df)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 40 40"
        style={{ transform: `rotate(${angle}deg)`, transition: "transform 0.1s linear" }}
      >
        {/* N 바늘 (주황, 북쪽) */}
        <polygon points="20,5 24,21 20,18 16,21" fill="#c2410c" />
        {/* S 바늘 (회색) */}
        <polygon points="20,35 16,19 20,22 24,19" fill="#9ca3af" />
        <circle cx="20" cy="20" r="2" fill="#374151" />
      </svg>
      <span
        style={{
          position: "absolute",
          top: 2,
          fontSize: 9,
          fontWeight: 700,
          color: "#c2410c",
          transform: `rotate(${angle}deg)`,
          transformOrigin: "center 24px",
        }}
      >
        N
      </span>
    </div>
  );
}
