"use client";

import { sessionFetch as fetch } from "@/lib/auth/client-session";
import { sessionLocalStorage } from "@/lib/auth/client-session";

import { Suspense, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Panel } from "@/components/ui/primitives";
import { SceneText as Text } from "@/components/ui/SceneText";
import { defaultAssumptions } from "@/lib/finance/scenario";
import { getExistingBuildingGeometry } from "@/lib/geo/existing-building-geometry";
import {
  buildCadastralContext,
  type CadastralContextSnapshot,
  type CadastralParcelFeature,
  type LocalCadastralParcel,
  type RoadClearanceAssessment,
} from "@/lib/geo/cadastral-context";
import { hasParcelBoundary, localParcelPolygons, parcelRings, type LocalParcelPolygon } from "@/lib/geo/parcel-topology";
import {
  buildContextParcelAlignment,
  type ContextParcelAlignmentSnapshot,
  type ContextParcelAlignmentStatus,
} from "@/lib/planning/context-parcel-alignment";
import { buildPlanningGeometry } from "@/lib/planning/planning-geometry";
import {
  calculatePlanningScenario,
  planningEconomicsAssumptionsFromLegacy,
} from "@/lib/planning/scenario-calculator";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import {
  calculateContextSceneFrame,
  contextCameraDistance,
  contextFlatGeometry,
  contextPrismGeometry,
  openContextRing,
  type ContextSceneFrame,
} from "@/lib/planning/context-three-geometry";
import {
  buildSketchupExportPackage,
  type ContextGeometryBuilding,
  type ContextGeometrySnapshot,
} from "@/lib/planning/sketchup-export-package";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";
import {
  conceptReferenceStorageKey,
  createConceptReferenceCapture,
} from "@/lib/ai/concept-reference-cache";

interface ApiResponse {
  parcels: CadastralParcelFeature[];
  source?: string;
  sourceSummary?: {
    cadastralParcelCount: number | null;
    cadastralRoadCount: number | null;
    upisRoadBoundaryCount: number | null;
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
  warnings?: string[];
}

type LoadState = "idle" | "loading" | "ready" | "error";

function useGeometryEdges(geometry: THREE.BufferGeometry): THREE.EdgesGeometry {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);
  useEffect(() => () => {
    edges.dispose();
    geometry.dispose();
  }, [edges, geometry]);
  return edges;
}

function ParcelPlate({ polygon }: { polygon: LocalParcelPolygon }) {
  const geometry = useMemo(() => contextFlatGeometry(polygon), [polygon]);
  const edges = useGeometryEdges(geometry);
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
      <lineSegments geometry={edges} position={[0, -0.012, 0]}>
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
    () => contextPrismGeometry({ outer: floor.shape, holes: [] }, floor.baseHeightM, floor.topHeightM),
    [floor.shape, floor.baseHeightM, floor.topHeightM]
  );
  const edges = useGeometryEdges(geometry);
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
      <lineSegments geometry={edges}>
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
  if (status === "unavailable") return "#ca8a04";
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
      {building.polygons.map((polygon, index) => (
        <ContextBuildingPart
          key={`${building.id}:part:${index}`}
          polygon={polygon}
          heightM={building.heightM}
          verified={building.accuracy === "verified"}
          alignmentStatus={alignmentStatus}
        />
      ))}
    </group>
  );
}

function ContextBuildingPart({
  polygon,
  heightM,
  verified,
  alignmentStatus,
}: {
  polygon: LocalParcelPolygon;
  heightM: number;
  verified: boolean;
  alignmentStatus?: ContextParcelAlignmentStatus;
}) {
  const geometry = useMemo(() => contextPrismGeometry(polygon, 0, heightM), [polygon, heightM]);
  const edges = useGeometryEdges(geometry);
  const edgeColor = alignmentEdgeColor(alignmentStatus, verified);
  return (
    <group>
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
      <lineSegments geometry={edges} renderOrder={2}>
        <lineBasicMaterial
          color={edgeColor}
          transparent
          opacity={alignmentStatus === "mismatch" ? 0.9 : alignmentStatus === "unavailable" ? 0.78 : verified ? 0.32 : 0.2}
          depthTest
        />
      </lineSegments>
    </group>
  );
}

function RoadBoundary({
  parcel,
  showSourceBoundary,
}: {
  parcel: LocalCadastralParcel;
  showSourceBoundary: boolean;
}) {
  const polygons = useMemo(() => localParcelPolygons(parcel), [parcel]);
  const upis =
    parcel.boundarySource === "upis-planned-road" ||
    parcel.jimokCode === "UPIS-UQ151";
  return (
    <group>
      {polygons.map((polygon, index) => (
        <RoadBoundaryPart
          key={`${parcel.pnu}:part:${index}`}
          polygon={polygon}
          upis={upis}
          showSourceBoundary={showSourceBoundary}
        />
      ))}
    </group>
  );
}

function RoadBoundaryPart({
  polygon,
  upis,
  showSourceBoundary,
}: {
  polygon: LocalParcelPolygon;
  upis: boolean;
  showSourceBoundary: boolean;
}) {
  const geometry = useMemo(() => contextFlatGeometry(polygon), [polygon]);
  const edges = useGeometryEdges(geometry);
  return (
    <group>
      <mesh geometry={geometry} position={[0, -0.025, 0]}>
        <meshStandardMaterial
          color={upis ? "#5f6873" : "#6b7280"}
          transparent
          opacity={0.2}
          roughness={1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={edges} position={[0, -0.005, 0]}>
        <lineBasicMaterial
          color="#4b5563"
          transparent
          opacity={upis ? (showSourceBoundary ? 0.82 : 0.38) : 0.82}
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
  const ring = openContextRing(points);
  if (ring.length < 2 || ring.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))) return null;
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
      <Html
        position={midpoint}
        center
        zIndexRange={[10, 0]}
        style={{ pointerEvents: "none", color, fontSize: 11, fontWeight: 650, whiteSpace: "nowrap", background: "rgba(255,255,255,0.85)", borderRadius: 3, padding: "2px 4px" }}
      >
        {assessment.intrudes
          ? `도로 저촉 ${assessment.intrusionAreaSqm.toFixed(2)}㎡`
          : `도로 경계 ${assessment.minimumClearanceM.toFixed(2)}m`}
      </Html>
    </group>
  );
}

function SiteCamera({ frame }: { frame: ContextSceneFrame }) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const distance = contextCameraDistance(frame.radius, 44, size.width / Math.max(1, size.height));
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const target = new THREE.Vector3(...frame.center);
    camera.position.copy(new THREE.Vector3(1.45, 1.25, 1.7).normalize().multiplyScalar(distance).add(target));
    camera.near = 0.1;
    camera.far = Math.max(1000, distance * 5 + frame.radius * 2);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    controls.current?.target.copy(target);
    controls.current?.update();
    invalidate();
  }, [camera, distance, frame, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      target={frame.center}
      minDistance={1}
      maxDistance={distance * 5}
      maxPolarAngle={Math.PI / 2.02}
    />
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
}) {
  const { visibleRoads, visibleParcels, frame } = useMemo(() => {
    const frontageIds = new Set(cadastral.frontages.map((frontage) => frontage.roadParcelPnu));
    const visibleRoads = showRoads ? cadastral.roadParcels.filter(
      (parcel) => frontageIds.has(parcel.pnu) || (
        ((parcel.boundarySource !== "upis-planned-road" && parcel.jimokCode !== "UPIS-UQ151") ||
          showSourceRoadBoundary) && parcel.distanceM <= 55
      )
    ) : [];
    const visibleParcels = showParcels
      ? cadastral.adjacentParcels.filter((parcel) => parcel.distanceM <= 45)
      : [];
    const buildings = showBuildings ? context.buildings : [];
    const sampleLines = showSamples ? cadastral.frontages
      .filter((frontage) => frontage.status !== "planned-road-reference")
      .flatMap((frontage) => [frontage.frontage, ...frontage.widthSamples.map((sample) => [sample.from, sample.to])]) : [];
    const clearanceLine = showRoads && roadClearance?.buildingPoint && roadClearance.roadPoint
      ? [[roadClearance.buildingPoint, roadClearance.roadPoint]]
      : [];
    return {
      visibleRoads,
      visibleParcels,
      frame: calculateContextSceneFrame({
        polygons: [
          ...localParcelPolygons(planning.parcel),
          ...planning.building.floors.map((floor) => ({ outer: floor.shape, holes: [] })),
          ...buildings.flatMap((building) => building.polygons),
          ...visibleRoads.flatMap(localParcelPolygons),
          ...visibleParcels.flatMap(localParcelPolygons),
        ],
        lines: [
          ...(showRoads ? planning.roads.map((road) => road.points) : []),
          ...sampleLines,
          ...clearanceLine,
        ],
        heightM: Math.max(planning.building.totalHeightM, ...buildings.map((building) => building.heightM)),
      }),
    };
  }, [cadastral, context, planning, roadClearance, showBuildings, showParcels, showRoads, showSamples, showSourceRoadBoundary]);
  const extent = frame.radius;
  const alignmentByBuilding = new Map(
    alignment.buildings.map((building) => [building.buildingId, building.status])
  );

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[extent, extent * 2.2, extent]} intensity={1.05} />
      <directionalLight position={[-extent, extent, -extent]} intensity={0.28} />

      {localParcelPolygons(planning.parcel).map((polygon, index) => <ParcelPlate key={`target-part-${index}`} polygon={polygon} />)}

      {showParcels &&
        visibleParcels.flatMap((parcel) => localParcelPolygons(parcel).map((polygon, partIndex) => (
          <group key={`${parcel.pnu}:part:${partIndex}`}>
            {parcelRings([polygon]).map((ring, ringIndex) => (
              <PolygonLine
                key={`ring:${ringIndex}`}
                points={ring}
                color="#9a8f80"
                opacity={0.2}
                y={0.008}
              />
            ))}
          </group>
        )))}

      {showRoads &&
        visibleRoads.map((parcel) => (
          <RoadBoundary
            key={parcel.pnu}
            parcel={parcel}
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
          <group key={`${frontage.roadParcelPnu}-${frontage.targetPolygonIndex ?? 0}-${frontage.targetRingIndex ?? 0}-${frontage.targetEdgeIndex}`}>
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
        position={[frame.center[0], 0.1, frame.center[2] - extent * 0.9]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={Math.max(0.8, extent * 0.04)}
        color="#dc2626"
        anchorX="center"
        anchorY="middle"
      >
        N
      </Text>

      <SiteCamera frame={frame} />
    </>
  );
}

export function PlanningSiteContextPanel({ projectId }: { projectId: string }) {
  const data = useProjectStore((state) => state.data);
  const representativeGeometry = useProjectStore(
    (state) => state.representativeGeometrySnapshot
  );
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
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showParcels, setShowParcels] = useState(true);
  const [showRoads, setShowRoads] = useState(true);
  const [showSamples, setShowSamples] = useState(true);
  const [showSourceRoadBoundary, setShowSourceRoadBoundary] = useState(false);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

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
  const manualParcel = parcel?.inputProvenance?.mode === "manual";

  useEffect(() => {
    setSourceWarnings([]);
    setSourceParcels([]);
    setSourceSummary(undefined);
    setUpisRoadSummaries([]);
    if (
      !parcel ||
      manualParcel ||
      !targetPnu ||
      !Number.isFinite(parcel.lat) ||
      !Number.isFinite(parcel.lng)
    ) {
      setSourceParcels([]);
      setSourceSummary(undefined);
      setUpisRoadSummaries([]);
      setLoadState("idle");
      setLoadError(null);
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
        if (controller.signal.aborted) return;
        setSourceParcels(payload.parcels ?? []);
        setSourceWarnings(payload.warnings ?? []);
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
  }, [manualParcel, parcel, targetPnu]);

  const snapshots = useMemo(() => {
    if (!parcel || !hasParcelBoundary(parcel) || !scenario || !targetPnu) {
      return null;
    }
    const legacyAssumptions =
      data?.scenarios.find((candidate) => candidate.recommended)?._raw.assumptions ??
      data?.scenarios[0]?._raw.assumptions ??
      defaultAssumptions();
    const calculation = calculatePlanningScenario(scenario, {
      parcel: {
        address: parcel.address,
        zoning: parcel.zoning,
        zoningStatus: parcel.inputProvenance?.zoning === "vworld-land-use"
          ? "public-observation" : "user-entered",
        sunlightRuleAsOf: data?.meta.lastSyncedAt?.slice(0, 10),
        lotAreaSqm: parcel.lotArea,
        boundary: parcel.boundary,
        boundaryPolygons: parcel.boundaryPolygons,
        roads: parcel.roads,
        setback: parcel.setback,
        maxFARPct: parcel.maxFAR,
        maxBCRPct: parcel.maxBCR,
        heightLimitM: parcel.heightLimit ?? 0,
        regulatoryConstraints: parcel.regulatoryConstraints,
        roofAllowanceM: 1.4,
        acquisitionCostManwon: parcel.acquiredPrice,
        demolitionCostManwon: parcel.demolitionCost ?? 0,
      },
      assumptions: planningEconomicsAssumptionsFromLegacy(
        legacyAssumptions,
        `stage2-${data?.meta.version ?? "local"}`
      ),
      calculatedAt: data?.meta.lastSyncedAt,
    });
    const planning = buildPlanningGeometry({
      projectId,
      scenario,
      boundary: parcel.boundary,
      boundaryPolygons: parcel.boundaryPolygons,
      lotAreaSqm: parcel.lotArea,
      zoning: parcel.zoning ?? "",
      roads: parcel.roads,
      setback: parcel.setback,
      sunlight: calculation.sunlight,
      roofAllowanceM: calculation.metrics.roofAllowanceM,
    }).snapshot;
    const basePackage = buildSketchupExportPackage({
      planning,
      existingGeometry: getExistingBuildingGeometry(parcel.currentBuilding),
    });
    const cadastral = buildCadastralContext({
      planning,
      targetPnu,
      targetBoundary: parcel.boundary,
      targetBoundaryPolygons: parcel.boundaryPolygons,
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
    };
  }, [data, parcel, projectId, scenario, sourceParcels, targetPnu]);

  const captureEligible = Boolean(
    snapshots &&
      representativeGeometry?.projectId === projectId &&
      representativeGeometry.geometryHash === snapshots.planning.geometryHash &&
      representativeGeometry.validation.status === "pass" &&
      representativeGeometry.validation.representativeEligible &&
      representativeGeometry.validation.exportable
  );

  const captureConceptReference = () => {
    if (!snapshots || !captureEligible || !captureCanvasRef.current) {
      setCaptureNotice(
        "현재 선택안이 검증된 대표안과 같을 때만 AI 기준 이미지를 저장할 수 있습니다."
      );
      return;
    }
    try {
      const capture = createConceptReferenceCapture({
        projectId,
        geometryHash: snapshots.planning.geometryHash,
        dataUrl: captureCanvasRef.current.toDataURL("image/jpeg", 0.9),
      });
      sessionLocalStorage.setItem(
        conceptReferenceStorageKey(projectId),
        JSON.stringify(capture)
      );
      setCaptureNotice(
        "현재 3D 시점을 대표 Geometry에 묶어 저장했습니다. Stage 5에서 자동으로 불러옵니다."
      );
    } catch (error) {
      setCaptureNotice(
        error instanceof Error
          ? error.message
          : "3D 기준 이미지를 저장하지 못했습니다."
      );
    }
  };

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
  const primaryUpisSummary = plannedRoadReference && primary?.status === "planned-road-reference"
    ? upisRoadSummaries.find((summary) =>
        primary.roadParcelPnu === `UPIS-${summary.presentSn}-1`
      ) ?? null
    : null;

  return (
    <Panel
      title="설계 전달 3D 컨텍스트"
      source={
        manualParcel
          ? "계획 매스 · 사용자 GeoJSON 필지 경계"
          : "계획 매스·주변 건물·지적선·UPIS 도로 경계·접도 폭"
      }
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
            {loadState === "ready"
              ? `확보 도로 경계 ${snapshots.cadastral.summary.roadParcelCount}개`
              : "도로 경계 미확인"}
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
          {alignmentSummary.unavailableBuildings > 0 && (
            <span className="ui-tag">정합 미확인 {alignmentSummary.unavailableBuildings}동</span>
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
                주변 계획선
              </Toggle>
            </>
          )}
        </div>
      </div>

      {loadState === "loading" && (
        <Notice>VWorld 지적·UPIS 도로 경계를 불러오고 있습니다.</Notice>
      )}
      {loadState === "error" && <Notice tone="fail">{loadError}</Notice>}
      {sourceWarnings.map((warning) => <Notice key={warning}>{warning}</Notice>)}
      {manualParcel && (
        <Notice>
          VWorld 비활성 모드입니다. 사용자 GeoJSON 필지와 계획 매스만 표시하며
          주변 지적·도로 경계·접도 폭은 포함하지 않습니다.
        </Notice>
      )}
      {plannedRoadReference && (
        <Notice>
          회색 면은 UPIS 원본 계획도로 경계의 전체 형상이며 분리된 구간과 내부 빈 영역을
          그대로 유지합니다. 계획폭은 개략설계 참고값으로, 현황·법정 도로폭 확정값이나
          공식 인허가 승인을 의미하지 않습니다.
        </Notice>
      )}
      <RoadBuildingLineCard
        plannedRoadReference={plannedRoadReference}
        roadBoundaryAvailable={loadState === "ready" && snapshots.cadastral.roadParcels.length > 0 &&
          (sourceSummary?.activeRoadBoundarySource === "cadastral-road-parcel" || plannedRoadReference)}
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
      {alignmentSummary.unavailableBuildings > 0 && (
        <Notice>
          주변 건물 {alignmentSummary.unavailableBuildings}동은 경계 형상 또는 겹침 계산 문제로
          필지 정합을 확인하지 못했습니다. 노란 외곽은 정합 미확인 상태로, 원본 건물·지적
          경계를 확인해야 합니다. 정합 불일치 판정과는 구분됩니다.
        </Notice>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          margin: "10px 0 8px",
        }}
      >
        <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>
          AI 외장 콘셉트는 검증된 대표안의 현재 카메라 시점을 기준으로 사용합니다.
        </span>
        <button
          type="button"
          disabled={!captureEligible}
          onClick={captureConceptReference}
          style={{
            minHeight: 32,
            padding: "0 12px",
            border: "1px solid var(--fg)",
            borderRadius: 7,
            background: captureEligible ? "var(--fg)" : "var(--bg-soft)",
            color: captureEligible ? "var(--bg)" : "var(--fg-faint)",
            fontSize: 9.5,
            fontWeight: 750,
            cursor: captureEligible ? "pointer" : "not-allowed",
          }}
        >
          AI 기준 이미지 저장
        </button>
      </div>
      {captureNotice && (
        <Notice>{captureNotice}</Notice>
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
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          onCreated={({ gl }) => {
            captureCanvasRef.current = gl.domElement;
          }}
          camera={{
            position: [20, 20, 25],
            fov: 44,
            near: 0.1,
            far: 1000,
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
        로컬 meter 좌표를 사용합니다. 회색 외곽은 정합, 주황은 확인, 빨강은 불일치,
        노랑은 미확인입니다.
        짙은 회색 면은 연속지적 도로 필지 또는 UPIS 계획도로 원본 경계입니다.
        파란색 접도선과 주황색 수직 폭 샘플은 연속지적 도로 필지가 대상
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
  roadBoundaryAvailable,
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
  roadBoundaryAvailable: boolean;
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
  const range = plannedRoadReference ? plannedRoadRange(roadLabel) : null;
  const cells = [
    {
      label: "도로 출처",
      value: !roadBoundaryAvailable ? "미확인" : plannedRoadReference ? "UPIS 계획도로" : "연속지적 도로",
      detail: !roadBoundaryAvailable ? "확보한 도로 경계 없음" : roadLabel
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
      detail: clearance
        ? clearance.intrudes
          ? "배치 수정 및 건축선 확인 필요"
          : "도형상 침범 없음 · 법적 건축선은 미확정"
        : "도로 경계·매스 간격을 확인하지 못했습니다.",
      tone: clearance ? (clearance.intrudes ? "fail" : "pass") : "unavailable",
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
