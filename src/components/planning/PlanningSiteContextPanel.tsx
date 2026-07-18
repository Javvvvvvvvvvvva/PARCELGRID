"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";
import { Panel } from "@/components/ui/primitives";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import {
  buildCadastralContext,
  type CadastralContextSnapshot,
  type CadastralParcelFeature,
  type LocalCadastralParcel,
  type CadastralRoadFrontage,
  type RoadClearanceAssessment,
} from "@/lib/geo/cadastral-context";
import {
  buildContextParcelAlignment,
  type ContextParcelAlignmentSnapshot,
  type ContextParcelAlignmentStatus,
} from "@/lib/planning/context-parcel-alignment";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { planningPointToThreeShape } from "@/lib/planning/three-coordinate-contract";
import {
  buildSketchupExportPackage,
  type ContextGeometryBuilding,
  type ContextGeometrySnapshot,
} from "@/lib/planning/sketchup-export-package";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";

interface ApiResponse {
  parcels: CadastralParcelFeature[];
  source?: string;
  sourceSummary?: {
    cadastralParcelCount: number;
    cadastralRoadCount: number;
    upisRoadBoundaryCount: number;
    activeRoadBoundarySource:
      | "cadastral-road-parcel"
      | "upis-road-boundary"
      | "centerline-reference-only";
    upisDataCode: string;
  };
  upisRoadSummaries?: Array<{
    presentSn: string;
    label: string;
    grade: string;
    roadType: string;
    roadNo: string;
  }>;
  error?: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

function hasShape(points: LocalPlanPoint[]): boolean {
  return (
    points.length >= 3 &&
    points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
  );
}

function flatGeometry(points: LocalPlanPoint[]): THREE.BufferGeometry {
  const ring = openRing(points);
  if (!hasShape(ring)) return new THREE.BufferGeometry();
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    const shapePoint = planningPointToThreeShape(point);
    if (index === 0) shape.moveTo(shapePoint.x, shapePoint.y);
    else shape.lineTo(shapePoint.x, shapePoint.y);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function prismGeometry(
  points: LocalPlanPoint[],
  bottomY: number,
  topY: number
): THREE.BufferGeometry {
  const ring = openRing(points);
  if (!hasShape(ring)) return new THREE.BufferGeometry();
  const shape = new THREE.Shape();
  ring.forEach((point, index) => {
    const shapePoint = planningPointToThreeShape(point);
    if (index === 0) shape.moveTo(shapePoint.x, shapePoint.y);
    else shape.lineTo(shapePoint.x, shapePoint.y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, topY - bottomY),
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottomY, 0);
  return geometry;
}

function ParcelPlate({ points }: { points: LocalPlanPoint[] }) {
  const geometry = useMemo(() => flatGeometry(points), [points]);
  return (
    <group>
      <mesh geometry={geometry} position={[0, -0.035, 0]}>
        <meshStandardMaterial
          color="#d8cdbd"
          transparent
          opacity={0.55}
          roughness={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={new THREE.EdgesGeometry(geometry)} position={[0, -0.012, 0]}>
        <lineBasicMaterial color="#8a6f47" transparent opacity={0.92} />
      </lineSegments>
    </group>
  );
}

function ProposedMass({
  floor,
}: {
  floor: {
    id: string;
    shape: LocalPlanPoint[];
    baseHeightM: number;
    topHeightM: number;
    label: string;
  };
}) {
  const geometry = useMemo(
    () => prismGeometry(floor.shape, floor.baseHeightM, floor.topHeightM),
    [floor.shape, floor.baseHeightM, floor.topHeightM]
  );
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial
          color="#86b9dd"
          transparent
          opacity={0.82}
          roughness={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
      <lineSegments geometry={new THREE.EdgesGeometry(geometry)}>
        <lineBasicMaterial color="#315f82" transparent opacity={0.9} />
      </lineSegments>
    </group>
  );
}

function alignmentEdgeColor(
  status: ContextParcelAlignmentStatus | undefined,
  verified: boolean
): string {
  if (status === "mismatch") return "#dc2626";
  if (status === "review") return "#d97706";
  return verified ? "#74808b" : "#9aa3ab";
}

function ContextBuilding({
  building,
  alignmentStatus,
}: {
  building: ContextGeometryBuilding;
  alignmentStatus?: ContextParcelAlignmentStatus;
}) {
  return (
    <group>
      {building.polygons.map((polygon, index) => {
        const geometry = prismGeometry(polygon.outer, 0, building.heightM);
        const verified = building.accuracy === "verified";
        const edgeColor = alignmentEdgeColor(alignmentStatus, verified);
        return (
          <group key={`${building.id}-${index}`}>
            {/*
              주변 건물은 반투명하지만 먼저 depth만 기록해 바닥 지적선이 건물을
              관통해 보이는 착시를 막는다. 실제 색상은 다음 mesh에서 그린다.
            */}
            <mesh geometry={geometry} renderOrder={0}>
              <meshBasicMaterial
                colorWrite={false}
                depthWrite
                depthTest
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh geometry={geometry} renderOrder={1}>
              <meshStandardMaterial
                color={verified ? "#8f99a3" : "#aeb6be"}
                transparent
                opacity={verified ? 0.18 : 0.1}
                depthWrite={false}
                depthTest
                roughness={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
            <lineSegments geometry={new THREE.EdgesGeometry(geometry)} renderOrder={2}>
              <lineBasicMaterial
                color={edgeColor}
                transparent
                opacity={alignmentStatus === "mismatch" ? 0.9 : verified ? 0.32 : 0.2}
                depthTest
              />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}

function buildFocusedRoadStrip(
  frontage: CadastralRoadFrontage,
  roadPolygon: LocalPlanPoint[]
): LocalPlanPoint[] {
  const [start, end] = frontage.frontage;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.1) return [];
  const tangent = { x: dx / length, z: dz / length };
  let outward = { x: -tangent.z, z: tangent.x };
  const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
  const roadCenter = roadPolygon.length
    ? roadPolygon.reduce(
        (sum, point) => ({ x: sum.x + point.x, z: sum.z + point.z }),
        { x: 0, z: 0 }
      )
    : midpoint;
  if (roadPolygon.length) {
    roadCenter.x /= roadPolygon.length;
    roadCenter.z /= roadPolygon.length;
  }
  if (
    (roadCenter.x - midpoint.x) * outward.x +
      (roadCenter.z - midpoint.z) * outward.z <
    0
  ) {
    outward = { x: -outward.x, z: -outward.z };
  }
  const sourceWidthM = frontage.plannedWidthAvgM ?? frontage.widthAvgM;
  if (
    sourceWidthM == null ||
    !Number.isFinite(sourceWidthM) ||
    sourceWidthM <= 0
  ) {
    return [];
  }
  const referenceWidthM = Math.min(12, Math.max(2, sourceWidthM));
  // 대상 접도부 주변만 면으로 보여 주변 건물 전체를 가르는 긴 계획도로 면을 피한다.
  const extensionM = Math.min(8, Math.max(5, referenceWidthM));
  const a = {
    x: start.x - tangent.x * extensionM,
    z: start.z - tangent.z * extensionM,
  };
  const b = {
    x: end.x + tangent.x * extensionM,
    z: end.z + tangent.z * extensionM,
  };
  return [
    a,
    b,
    {
      x: b.x + outward.x * referenceWidthM,
      z: b.z + outward.z * referenceWidthM,
    },
    {
      x: a.x + outward.x * referenceWidthM,
      z: a.z + outward.z * referenceWidthM,
    },
  ];
}

function RoadBoundary({
  parcel,
  frontage,
  showSourceBoundary,
}: {
  parcel: LocalCadastralParcel;
  frontage: CadastralRoadFrontage | null;
  showSourceBoundary: boolean;
}) {
  const geometry = useMemo(() => flatGeometry(parcel.polygon), [parcel.polygon]);
  const upis =
    parcel.boundarySource === "upis-planned-road" ||
    parcel.jimokCode === "UPIS-UQ151";
  const focusedStrip = useMemo(
    () => (upis && frontage ? buildFocusedRoadStrip(frontage, parcel.polygon) : []),
    [frontage, parcel.polygon, upis]
  );
  const focusedGeometry = useMemo(() => flatGeometry(focusedStrip), [focusedStrip]);

  if (upis) {
    return (
      <group>
        {focusedStrip.length >= 3 && (
          <group>
            <mesh geometry={focusedGeometry} position={[0, -0.028, 0]}>
              <meshStandardMaterial
                color="#5f6873"
                transparent
                opacity={0.22}
                roughness={1}
                side={THREE.DoubleSide}
                depthWrite={false}
                depthTest
              />
            </mesh>
            <lineSegments
              geometry={new THREE.EdgesGeometry(focusedGeometry)}
              position={[0, -0.006, 0]}
            >
              <lineBasicMaterial color="#374151" transparent opacity={0.62} />
            </lineSegments>
          </group>
        )}
        {(showSourceBoundary || focusedStrip.length < 3) && (
          <PolygonLine
            points={parcel.polygon}
            color="#4b5563"
            opacity={0.38}
            y={-0.002}
          />
        )}
      </group>
    );
  }
  return (
    <group>
      <mesh geometry={geometry} position={[0, -0.025, 0]}>
        <meshStandardMaterial
          color="#6b7280"
          transparent
          opacity={0.2}
          roughness={1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={new THREE.EdgesGeometry(geometry)} position={[0, -0.005, 0]}>
        <lineBasicMaterial
          color="#4b5563"
          transparent
          opacity={0.82}
        />
      </lineSegments>
    </group>
  );
}

function PolygonLine({
  points,
  color,
  opacity = 0.42,
  y = 0.01,
}: {
  points: LocalPlanPoint[];
  color: string;
  opacity?: number;
  y?: number;
}) {
  const ring = openRing(points);
  if (ring.length < 2) return null;
  const positions = [...ring, ring[0]].map(
    (point) => [point.x, y, point.z] as [number, number, number]
  );
  return <Line points={positions} color={color} transparent opacity={opacity} lineWidth={1} />;
}

function RoadClearanceMarker({
  assessment,
}: {
  assessment: RoadClearanceAssessment;
}) {
  const from = assessment.buildingPoint;
  const to = assessment.roadPoint;
  if (!from || !to) return null;
  const color = assessment.intrudes ? "#dc2626" : "#16a34a";
  const midpoint: [number, number, number] = [
    (from.x + to.x) / 2,
    0.22,
    (from.z + to.z) / 2,
  ];
  return (
    <group>
      {!assessment.intrudes && assessment.minimumClearanceM > 0.01 && (
        <Line
          points={[
            [from.x, 0.18, from.z],
            [to.x, 0.18, to.z],
          ]}
          color={color}
          lineWidth={2.4}
        />
      )}
      <Text
        position={midpoint}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.7}
        color={color}
        anchorX="center"
        anchorY="bottom"
      >
        {assessment.intrudes
          ? `도로 저촉 ${assessment.intrusionAreaSqm.toFixed(2)}㎡`
          : `도로 경계 ${assessment.minimumClearanceM.toFixed(2)}m`}
      </Text>
    </group>
  );
}

function SiteScene({
  planning,
  context,
  cadastral,
  alignment,
  showBuildings,
  showParcels,
  showRoads,
  showSamples,
  showSourceRoadBoundary,
  roadClearance,
  extent,
}: {
  planning: ReturnType<typeof buildPlanningGeometry>["snapshot"];
  context: ContextGeometrySnapshot;
  cadastral: CadastralContextSnapshot;
  alignment: ContextParcelAlignmentSnapshot;
  showBuildings: boolean;
  showParcels: boolean;
  showRoads: boolean;
  showSamples: boolean;
  showSourceRoadBoundary: boolean;
  roadClearance: RoadClearanceAssessment | null;
  extent: number;
}) {
  const frontageIds = new Set(cadastral.frontages.map((frontage) => frontage.roadParcelPnu));
  const visibleRoads = cadastral.roadParcels.filter(
    (parcel) =>
      frontageIds.has(parcel.pnu) ||
      ((parcel.boundarySource !== "upis-planned-road" &&
        parcel.jimokCode !== "UPIS-UQ151") ||
        showSourceRoadBoundary) &&
        parcel.distanceM <= 55
  );
  const visibleParcels = cadastral.adjacentParcels.filter((parcel) => parcel.distanceM <= 45);
  const alignmentByBuilding = new Map(
    alignment.buildings.map((building) => [building.buildingId, building.status])
  );

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[extent, extent * 2.2, extent]} intensity={1.05} />
      <directionalLight position={[-extent, extent, -extent]} intensity={0.28} />

      <ParcelPlate points={planning.parcel.polygon} />

      {showParcels &&
        visibleParcels.map((parcel) => (
          <PolygonLine
            key={parcel.pnu}
            points={parcel.polygon}
            color="#9a8f80"
            opacity={0.2}
            y={0.008}
          />
        ))}

      {showRoads &&
        visibleRoads.map((parcel) => (
          <RoadBoundary
            key={parcel.pnu}
            parcel={parcel}
            frontage={
              cadastral.frontages.find(
                (frontage) => frontage.roadParcelPnu === parcel.pnu
              ) ?? null
            }
            showSourceBoundary={showSourceRoadBoundary}
          />
        ))}

      {showRoads &&
        planning.roads.map((road, roadIndex) => (
          <Line
            key={`${road.name}-${roadIndex}`}
            points={road.points.map(
              (point) => [point.x, 0.025, point.z] as [number, number, number]
            )}
            color="#111827"
            transparent
            opacity={0.38}
            lineWidth={1}
          />
        ))}

      {showSamples &&
        cadastral.frontages
          .filter((frontage) => frontage.status !== "planned-road-reference")
          .map((frontage) => (
          <group key={`${frontage.roadParcelPnu}-${frontage.targetEdgeIndex}`}>
            <Line
              points={frontage.frontage.map(
                (point) => [point.x, 0.07, point.z] as [number, number, number]
              )}
              color="#2563eb"
              lineWidth={3}
            />
            {frontage.widthSamples.map((sample) => (
              <Line
                key={`${frontage.roadParcelPnu}-${sample.positionRatio}`}
                points={[
                  [sample.from.x, 0.065, sample.from.z],
                  [sample.to.x, 0.065, sample.to.z],
                ]}
                color="#f97316"
                transparent
                opacity={0.88}
                lineWidth={1.6}
              />
            ))}
          </group>
        ))}

      {showBuildings &&
        context.buildings.map((building) => (
          <ContextBuilding
            key={building.id}
            building={building}
            alignmentStatus={alignmentByBuilding.get(building.id)}
          />
        ))}

      {planning.building.floors.map((floor) => (
        <ProposedMass key={floor.id} floor={floor} />
      ))}

      {showRoads && roadClearance && (
        <RoadClearanceMarker assessment={roadClearance} />
      )}

      <Text
        position={[0, 0.1, -extent * 0.9]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={Math.max(0.8, extent * 0.04)}
        color="#dc2626"
        anchorX="center"
        anchorY="middle"
      >
        N
      </Text>

      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={extent * 0.9}
        maxDistance={extent * 7}
        maxPolarAngle={Math.PI / 2.02}
      />
    </>
  );
}

function calculateExtent(input: {
  planning: ReturnType<typeof buildPlanningGeometry>["snapshot"];
  context: ContextGeometrySnapshot;
  cadastral: CadastralContextSnapshot;
}): number {
  const points: LocalPlanPoint[] = [
    ...input.planning.parcel.polygon,
    ...input.planning.building.floors.flatMap((floor) => floor.shape),
    ...input.context.buildings.flatMap((building) =>
      building.polygons.flatMap((polygon) => polygon.outer)
    ),
    ...input.cadastral.roadParcels
      .filter(
        (parcel) =>
          parcel.distanceM <= 55 &&
          parcel.boundarySource !== "upis-planned-road" &&
          parcel.jimokCode !== "UPIS-UQ151"
      )
      .flatMap((parcel) => parcel.polygon),
  ];
  let extent = 12;
  points.forEach((point) => {
    extent = Math.max(extent, Math.abs(point.x), Math.abs(point.z));
  });
  extent = Math.max(extent, input.planning.building.totalHeightM * 0.8);
  return Math.min(85, extent * 1.08);
}

export function PlanningSiteContextPanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const planningScenarios = useProjectStore((state) => state.planningScenarios);
  const selectedPlanningScenarioId = useProjectStore(
    (state) => state.selectedPlanningScenarioId
  );
  const [sourceParcels, setSourceParcels] = useState<CadastralParcelFeature[]>([]);
  const [sourceSummary, setSourceSummary] = useState<ApiResponse["sourceSummary"]>(undefined);
  const [upisRoadSummaries, setUpisRoadSummaries] = useState<
    NonNullable<ApiResponse["upisRoadSummaries"]>
  >([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [showSamples, setShowSamples] = useState(true);
  const [showSourceRoadBoundary, setShowSourceRoadBoundary] = useState(false);

  const parcel = data?.parcel;
  const scenario =
    planningScenarios.find(
      (candidate) =>
        candidate.id === selectedPlanningScenarioId && candidate.projectId === projectId
    ) ??
    planningScenarios.find((candidate) => candidate.projectId === projectId) ??
    null;
  const targetPnu = parcel
    ? ((parcel as typeof parcel & { pnu?: string }).pnu ?? parcel.id)
    : "";

  useEffect(() => {
    if (!parcel || !targetPnu || !Number.isFinite(parcel.lat) || !Number.isFinite(parcel.lng)) {
      setSourceParcels([]);
      setSourceSummary(undefined);
      setUpisRoadSummaries([]);
      setLoadState("idle");
      return;
    }
    const controller = new AbortController();
    setLoadState("loading");
    setLoadError(null);
    fetch("/api/parcels/cadastral-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetPnu,
        lat: parcel.lat,
        lng: parcel.lng,
        radiusM: 100,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as ApiResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? `도로 경계 조회 실패 (${response.status})`);
        }
        return payload;
      })
      .then((payload) => {
        setSourceParcels(payload.parcels ?? []);
        setSourceSummary(payload.sourceSummary);
        setUpisRoadSummaries(payload.upisRoadSummaries ?? []);
        setLoadState("ready");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSourceParcels([]);
        setSourceSummary(undefined);
        setUpisRoadSummaries([]);
        setLoadState("error");
        setLoadError(error instanceof Error ? error.message : "도로 경계 조회 실패");
      });
    return () => controller.abort();
  }, [parcel, targetPnu]);

  const snapshots = useMemo(() => {
    if (!parcel?.boundary || parcel.boundary.length < 3 || !scenario || !targetPnu) {
      return null;
    }
    const planning = buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
    }).snapshot;
    const basePackage = buildSketchupExportPackage({
      planning,
      existingGeometry: getExistingBuildingGeometry(parcel.currentBuilding),
    });
    const cadastral = buildCadastralContext({
      planning,
      targetPnu,
      parcels: sourceParcels,
    });
    const alignment = buildContextParcelAlignment({
      context: basePackage.context,
      cadastral,
    });
    return {
      planning,
      context: basePackage.context,
      cadastral,
      alignment,
      extent: calculateExtent({
        planning,
        context: basePackage.context,
        cadastral,
      }),
    };
  }, [parcel, projectId, scenario, sourceParcels, targetPnu]);

  if (!parcel || !scenario || !snapshots) return null;

  const primary = snapshots.cadastral.frontages[0] ?? null;
  const sourceLabel =
    sourceSummary?.activeRoadBoundarySource === "cadastral-road-parcel"
      ? "연속지적 도로 필지"
      : sourceSummary?.activeRoadBoundarySource === "upis-road-boundary"
        ? "VWorld 도시계획 도로 경계"
        : "도로 중심선 참고";
  const alignmentSummary = snapshots.alignment.summary;
  const plannedRoadReference =
    sourceSummary?.activeRoadBoundarySource === "upis-road-boundary";
  const primaryRoadClearance =
    (primary
      ? snapshots.cadastral.roadClearances.find(
          (clearance) => clearance.roadParcelPnu === primary.roadParcelPnu
        )
      : null) ?? snapshots.cadastral.roadClearances[0] ?? null;
  const primaryUpisSummary = primary
    ? upisRoadSummaries.find((summary) =>
        primary.roadParcelPnu.includes(summary.presentSn)
      ) ?? upisRoadSummaries[0] ?? null
    : upisRoadSummaries[0] ?? null;

  return (
    <Panel
      title="설계 전달 3D 컨텍스트"
      source="계획 매스·주변 건물·지적선·UPIS 도로 경계·접도 폭"
      bodyStyle={{ padding: "var(--s5)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <span className="ui-tag">활성 경계: {sourceLabel}</span>
          <span className="ui-tag">
            도로 경계 {snapshots.cadastral.summary.roadParcelCount}개
          </span>
          <span className="ui-tag">
            주변 건물 {snapshots.context.summary.totalBuildings}동
          </span>
          <span className="ui-tag">
            필지 정합 {alignmentSummary.alignedBuildings}/{alignmentSummary.totalBuildings}동
          </span>
          {alignmentSummary.reviewBuildings > 0 && (
            <span className="ui-tag">정합 확인 {alignmentSummary.reviewBuildings}동</span>
          )}
          {alignmentSummary.mismatchBuildings > 0 && (
            <span className="ui-tag">정합 불일치 {alignmentSummary.mismatchBuildings}동</span>
          )}
          {(plannedRoadReference
            ? primary?.plannedWidthAvgM
            : primary?.widthAvgM) != null && (
            <span className="ui-tag">
              {plannedRoadReference ? "계획폭 참고" : "폭"}{" "}
              {num(
                (plannedRoadReference
                  ? primary?.plannedWidthMinM
                  : primary?.widthMinM) ?? 0,
                2
              )}{" "}
              /{" "}
              {num(
                (plannedRoadReference
                  ? primary?.plannedWidthAvgM
                  : primary?.widthAvgM) as number,
                2
              )}{" "}
              /{" "}
              {num(
                (plannedRoadReference
                  ? primary?.plannedWidthMaxM
                  : primary?.widthMaxM) ?? 0,
                2
              )}
              m
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Toggle active={showBuildings} onClick={() => setShowBuildings((value) => !value)}>
            주변 건물
          </Toggle>
          <Toggle active={showParcels} onClick={() => setShowParcels((value) => !value)}>
            인접 필지
          </Toggle>
          <Toggle active={showRoads} onClick={() => setShowRoads((value) => !value)}>
            도로 경계
          </Toggle>
          {!plannedRoadReference ? (
            <Toggle active={showSamples} onClick={() => setShowSamples((value) => !value)}>
              폭 샘플
            </Toggle>
          ) : (
            <>
              <span className="ui-tag">폭 샘플 미사용</span>
              <Toggle
                active={showSourceRoadBoundary}
                onClick={() => setShowSourceRoadBoundary((value) => !value)}
              >
                원본 계획선
              </Toggle>
            </>
          )}
        </div>
      </div>

      {loadState === "loading" && (
        <Notice>VWorld 지적·UPIS 도로 경계를 불러오고 있습니다.</Notice>
      )}
      {loadState === "error" && <Notice tone="fail">{loadError}</Notice>}
      {plannedRoadReference && (
        <Notice>
          회색 면은 대상 접도부에 맞춰{" "}
          {primary?.plannedWidthAvgM != null
            ? `${num(primary.plannedWidthAvgM, 2)}m 계획폭`
            : "계획도로 참고 폭"}
          만 짧게 표시한 3D 참고 구간입니다. UPIS 원본 긴 경계는 법적 계산에
          그대로 유지되며 ‘원본 계획선’에서 따로 확인할 수 있습니다. 현황·법정 도로폭
          확정값은 아닙니다.
        </Notice>
      )}
      <RoadBuildingLineCard
        plannedRoadReference={plannedRoadReference}
        roadLabel={primaryUpisSummary?.label || primary?.roadParcelJibun || null}
        roadNo={primaryUpisSummary?.roadNo || null}
        frontageLengthM={primary?.frontageLengthM ?? null}
        boundaryGapM={primary?.boundaryGapM ?? null}
        verifiedWidthMinM={primary?.widthMinM ?? null}
        verifiedWidthAvgM={primary?.widthAvgM ?? null}
        verifiedWidthMaxM={primary?.widthMaxM ?? null}
        plannedWidthMinM={primary?.plannedWidthMinM ?? null}
        plannedWidthAvgM={primary?.plannedWidthAvgM ?? null}
        plannedWidthMaxM={primary?.plannedWidthMaxM ?? null}
        clearance={primaryRoadClearance}
      />
      {alignmentSummary.mismatchBuildings > 0 && (
        <Notice tone="fail">
          주변 건물 {alignmentSummary.mismatchBuildings}동이 대상·인접 필지 경계 안에 60%
          미만만 포함됩니다. 빨간 외곽 건물은 VWorld 건물·지적 데이터의 위치 또는 갱신
          차이를 확인해야 합니다.
        </Notice>
      )}
      {alignmentSummary.mismatchBuildings === 0 && alignmentSummary.reviewBuildings > 0 && (
        <Notice>
          주황 외곽 주변 건물 {alignmentSummary.reviewBuildings}동은 필지 포함 비율이
          60~85%라 원본 지적도 확인이 필요합니다.
        </Notice>
      )}

      <div
        style={{
          height: 520,
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
          background: "linear-gradient(180deg, var(--bg-elev), var(--bg-sunken))",
        }}
      >
        <Canvas
          camera={{
            position: [
              snapshots.extent * 1.45,
              snapshots.extent * 1.25,
              snapshots.extent * 1.7,
            ],
            fov: 44,
            near: 0.1,
            far: snapshots.extent * 30,
          }}
        >
          <Suspense fallback={null}>
            <SiteScene
              planning={snapshots.planning}
              context={snapshots.context}
              cadastral={snapshots.cadastral}
              alignment={snapshots.alignment}
              showBuildings={showBuildings}
              showParcels={showParcels}
              showRoads={showRoads}
              showSamples={showSamples}
              showSourceRoadBoundary={showSourceRoadBoundary}
              roadClearance={primaryRoadClearance}
              extent={snapshots.extent}
            />
          </Suspense>
        </Canvas>
      </div>

      <p
        style={{
          margin: "9px 0 0",
          fontSize: 10.5,
          lineHeight: 1.55,
          color: "var(--fg-muted)",
        }}
      >
        갈색선은 인접 지적 경계이며 별도로 회전하지 않습니다. 주변 건물과 지적선은 같은
        로컬 meter 좌표를 사용합니다. 회색 외곽은 정합, 주황은 확인, 빨강은 불일치입니다.
        짙은 회색 면은 연속지적 도로 필지 또는 대상 접도부에 한정한 UPIS 계획폭 참고
        구간입니다. UPIS 원본 경계는 토글로 분리했습니다. 파란색 접도선과 주황색 수직 폭 샘플은 연속지적 도로 필지가 대상
        경계와 충분히 평행할 때만 표시합니다. 모든 GIS 검사는 개략설계용이며 측량
        성과도를 대체하지 않습니다.
      </p>
    </Panel>
  );
}

function plannedRoadRange(label: string | null): string | null {
  if (!label) return null;
  const ranges: Record<string, string> = {
    소로1류: "10m 이상 12m 미만",
    소로2류: "8m 이상 10m 미만",
    소로3류: "8m 미만",
    중로1류: "20m 이상 25m 미만",
    중로2류: "15m 이상 20m 미만",
    중로3류: "12m 이상 15m 미만",
  };
  return ranges[label] ?? null;
}

function RoadBuildingLineCard({
  plannedRoadReference,
  roadLabel,
  roadNo,
  frontageLengthM,
  boundaryGapM,
  verifiedWidthMinM,
  verifiedWidthAvgM,
  verifiedWidthMaxM,
  plannedWidthMinM,
  plannedWidthAvgM,
  plannedWidthMaxM,
  clearance,
}: {
  plannedRoadReference: boolean;
  roadLabel: string | null;
  roadNo: string | null;
  frontageLengthM: number | null;
  boundaryGapM: number | null;
  verifiedWidthMinM: number | null;
  verifiedWidthAvgM: number | null;
  verifiedWidthMaxM: number | null;
  plannedWidthMinM: number | null;
  plannedWidthAvgM: number | null;
  plannedWidthMaxM: number | null;
  clearance: RoadClearanceAssessment | null;
}) {
  const range = plannedRoadRange(roadLabel);
  const cells = [
    {
      label: "도로 출처",
      value: plannedRoadReference ? "UPIS 계획도로" : "연속지적 도로",
      detail: roadLabel
        ? `${roadLabel}${range ? ` · ${range}` : ""}${roadNo ? ` · ${roadNo}호` : ""}`
        : "등급 확인 필요",
    },
    {
      label: plannedRoadReference ? "계획폭 추정" : "지적 도로폭",
      value:
        (plannedRoadReference ? plannedWidthAvgM : verifiedWidthAvgM) != null
          ? `${num(
              (plannedRoadReference ? plannedWidthAvgM : verifiedWidthAvgM) as number,
              2
            )}m`
          : "산정 불가",
      detail:
        (plannedRoadReference ? plannedWidthMinM : verifiedWidthMinM) != null &&
        (plannedRoadReference ? plannedWidthMaxM : verifiedWidthMaxM) != null
          ? `${num(
              (plannedRoadReference ? plannedWidthMinM : verifiedWidthMinM) as number,
              2
            )}~${num(
              (plannedRoadReference ? plannedWidthMaxM : verifiedWidthMaxM) as number,
              2
            )}m · ${plannedRoadReference ? "법정 현황폭 아님" : "지적 경계 단면"}`
          : "도로대장 확인 필요",
    },
    {
      label: "필지–도로 경계",
      value: boundaryGapM != null ? `${num(boundaryGapM, 2)}m` : "미확인",
      detail:
        frontageLengthM != null
          ? `접도 후보 길이 ${num(frontageLengthM, 2)}m`
          : "접도 후보 없음",
    },
    {
      label: "매스–도로 경계",
      value: clearance
        ? clearance.intrudes
          ? `${num(clearance.intrusionAreaSqm, 2)}㎡ 저촉`
          : `${num(clearance.minimumClearanceM, 2)}m`
        : "미확인",
      detail: clearance?.intrudes
        ? "배치 수정 및 건축선 확인 필요"
        : "도형상 침범 없음 · 법적 건축선은 미확정",
      tone: clearance?.intrudes ? "fail" : "pass",
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 8,
        marginBottom: 10,
      }}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          style={{
            border: `1px solid ${
              cell.tone === "fail" ? "var(--neg-fg)" : "var(--border)"
            }`,
            borderRadius: 9,
            padding: "9px 10px",
            background:
              cell.tone === "fail" ? "var(--neg-soft)" : "var(--bg-elev)",
          }}
        >
          <div style={{ fontSize: 9.5, color: "var(--fg-muted)" }}>{cell.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>{cell.value}</div>
          <div style={{ fontSize: 9.5, color: "var(--fg-subtle)", marginTop: 3 }}>
            {cell.detail}
          </div>
        </div>
      ))}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "6px 9px",
        background: active ? "var(--fg)" : "var(--bg-elev)",
        color: active ? "var(--bg)" : "var(--fg-muted)",
        fontSize: 10.5,
        cursor: "pointer",
      }}
    >
      {active ? "✓ " : ""}
      {children}
    </button>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "fail";
}) {
  return (
    <div
      style={{
        marginBottom: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: tone === "fail" ? "var(--neg-soft)" : "var(--accent-soft)",
        color: tone === "fail" ? "var(--neg-fg)" : "var(--accent-fg)",
        fontSize: 10.5,
      }}
    >
      {children}
    </div>
  );
}
