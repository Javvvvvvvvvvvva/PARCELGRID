import { buildIntegratedVerification, verificationApprovalBlockers, type IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";
import { analysisReferenceInputBasis, analysisReferenceInputKey, analysisReferenceIsCurrent } from "./analysis-reference-contract";
import { assessRepresentativeCheckReadiness } from "./representative-readiness";
import { interiorDoorSegment } from "./interior-layout";
import { pathDoorSegment, pathSpaceShape } from "./interior-paths";
import { assessEgressCore } from "./egress-core";
import { localParcelPolygons } from "@/lib/geo/parcel-topology";
import { buildPlanningParkingGeometry } from "./planning-parking-geometry";
import { parkingEgressObstacles } from "./parking-egress-obstacles";
import { takeoffPlanningQuantities } from "./quantity-takeoff";
import { cadastralDxfAppIdTable, cadastralDxfIdentity } from "./cadastral-linework-export";
import { createStoredZip } from "./sketchup-dae-export";
import type { PlanPoint } from "./layout-geometry";

export const INTERIOR_DRAWING_EXPORT_VERSION = "interior-drawing-export-2026.1" as const;
const LIMITATIONS = [
  "예비 실내 검토용 구획선·개구부·피난 후보이며 인허가도·시공도·측량 성과도가 아닙니다. 공식 경계·허가·전문가 승인은 미확정입니다.",
  "실 외곽은 저장된 구획선이며 실제 벽체 솔리드나 구조체가 아닙니다. 문은 개구부 선분이며 문짝·여닫힘·방화 성능은 미검증입니다.",
  "계단은 두 개 구간의 예약 공간 후보이며 상세 디딤판·난간·층간 개구부·내화구획 설계가 아닙니다.",
  "피난선은 가구 없는 중심선 후보입니다. 법정 피난거리·보행 안전·소방·접근성·창호·환기·급배수·설비·가구는 미검증입니다.",
  "세대/실 구획·유효면적과 사업성 프로그램 면적은 다를 수 있습니다. 면적·수익·공급 주차대수를 자동 변경하지 않습니다.",
  "수량은 별도 수량 엔진의 포함/제외 범위를 따릅니다. 겹치는 개념 구획선의 길이를 CAD에서 단순 합산해 벽체 물량으로 쓰지 않습니다.",
];

interface DrawingEntity {
  id: string;
  layer: string;
  floorId: string;
  level: number;
  elevationM: number;
  kind: string;
  sourceId: string;
  unitId?: string;
  points: PlanPoint[];
  closed: boolean;
}
const pair = (code: number, value: string | number) => `${code}\n${value}\n`;
const floorKey = (level: number) => `${level < 0 ? "B" : "F"}${String(Math.abs(level)).padStart(2, "0")}`;

function buildDxf(entities: DrawingEntity[], inputKey: string) {
  const layers = [...new Set(entities.map(entity => entity.layer))];
  let text = pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, "AC1015")
    + pair(9, "$INSUNITS") + pair(70, 6) + pair(9, "$LUNITS") + pair(70, 2) + pair(0, "ENDSEC");
  text += pair(0, "SECTION") + pair(2, "TABLES") + pair(0, "TABLE") + pair(2, "LAYER") + pair(70, layers.length);
  for (const layer of layers) text += pair(0, "LAYER") + pair(2, layer) + pair(70, 0)
    + pair(62, layer.endsWith("DOOR") ? 1 : layer.includes("EGRESS") ? 3 : layer.includes("CORE") ? 6 : 7) + pair(6, "CONTINUOUS");
  text += pair(0, "ENDTAB") + cadastralDxfAppIdTable() + pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "ENTITIES");
  for (const entity of entities) {
    // Explicit vertex Z survives receivers that flatten LWPOLYLINE elevation.
    text += pair(0, "POLYLINE") + pair(100, "AcDbEntity") + pair(8, entity.layer) + pair(100, "AcDb3dPolyline")
      + pair(66, 1) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, entity.closed ? 9 : 8);
    text += cadastralDxfIdentity({ entityId: entity.id, inputKey, floorLevel: entity.level, approvalStatus: "unverified" });
    const vertices = entity.closed ? [...entity.points, entity.points[0]] : entity.points;
    for (const point of vertices) text += pair(0, "VERTEX") + pair(100, "AcDbEntity") + pair(8, entity.layer)
      + pair(100, "AcDbVertex") + pair(100, "AcDb3dPolylineVertex") + pair(10, point.x.toFixed(6))
      + pair(20, (-point.z).toFixed(6)) + pair(30, entity.elevationM.toFixed(6)) + pair(70, 32);
    text += pair(0, "SEQEND") + pair(8, entity.layer);
  }
  return text + pair(0, "ENDSEC") + pair(0, "EOF");
}

export function buildInteriorDrawingExport(input: IntegratedVerificationInput) {
  const scenario = input.planningScenario, geometry = input.geometry, parcel = input.data?.parcel;
  if (!scenario || !geometry || !parcel) throw new Error("현재 계획·형상·대지 자료가 필요합니다.");
  const selected = geometry.analysisReference !== undefined
    ? analysisReferenceIsCurrent(scenario, parcel, geometry) : assessRepresentativeCheckReadiness(scenario.checks).ready;
  if (!selected) throw new Error("현재 원본을 검사하고 예비 분석 기준안 또는 대표안을 다시 선택해야 합니다.");
  const verification = buildIntegratedVerification(input);
  const blockers = verificationApprovalBlockers(verification, "architect");
  if (blockers.length) throw new Error(`도면 원본 검증 미완료: ${blockers[0].label} · ${blockers[0].detail}`);
  const quantities = takeoffPlanningQuantities(scenario);
  if (quantities.status !== "preliminary") throw new Error(`상세 실 수량 검증 미완료: ${quantities.issues[0] ?? "주거 상세 구획이 필요합니다."}`);
  const contract = input.data.scenarios.find(candidate => candidate.id === scenario.id)?._raw.program.areaContract;
  if (!contract) throw new Error("같은 계획의 사업성 면적 계약이 필요합니다.");
  const parking = buildPlanningParkingGeometry({ scenario, planning: geometry, requiredCars: contract.requiredParkingSpaces,
    boundary: parcel.boundary, boundaryPolygons: parcel.boundaryPolygons, roads: parcel.roads });
  const egress = assessEgressCore({ scenario, floors: geometry.building.floors, parcelPolygons: localParcelPolygons(geometry.parcel),
    groundObstacles: parkingEgressObstacles(parking) });
  if (egress.status !== "preliminary-chain") throw new Error("현재 원본의 피난·층간 코어 예비 연결 검사가 필요합니다.");
  const inputKey = analysisReferenceInputKey(scenario, parcel, geometry);
  const entities: DrawingEntity[] = [];
  const add = (floorId: string, kind: string, sourceId: string, points: PlanPoint[] | null, closed: boolean, unitId?: string) => {
    const floor = geometry.building.floors.find(item => item.id === floorId);
    if (!floor || !points || points.length < (closed ? 3 : 2) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)) ||
        !Number.isFinite(floor.baseHeightM)) throw new Error("도면의 층·좌표·개구부 원본이 올바르지 않습니다.");
    if (entities.length >= 5000) throw new Error("상세 도면 객체 수 한도를 초과했습니다.");
    entities.push({ id: `E${String(entities.length + 1).padStart(5, "0")}`, layer: `PG_${floorKey(floor.level)}_${kind}`,
      floorId, level: floor.level, elevationM: floor.baseHeightM, kind, sourceId, unitId, points, closed });
  };
  for (const floor of scenario.floorPrograms) {
    const mass = geometry.building.floors.find(item => item.id === floor.id)!;
    add(floor.id, "OUTLINE", floor.id, mass.shape, true);
    const layout = floor.interiorLayout;
    if (!layout) throw new Error(`${floor.label}: 상세 구획이 없는 층은 완성 도면으로 내보낼 수 없습니다.`);
    for (const space of layout.spaces) add(floor.id, space.kind.toUpperCase(), space.id, pathSpaceShape(space), true);
    layout.doors.forEach((door, index) => add(floor.id, "COMMON_DOOR", String(index), interiorDoorSegment(layout, door), false));
    for (const rooms of layout.roomLayouts ?? []) {
      for (const space of rooms.spaces) add(floor.id, `ROOM_${space.kind.toUpperCase()}`, space.id, pathSpaceShape(space), true, rooms.unitId);
      rooms.doors.forEach((door, index) => add(floor.id, "ROOM_DOOR", String(index),
        pathDoorSegment(rooms.spaces, door, rooms.settings.wallThicknessM), false, rooms.unitId));
    }
  }
  for (const link of egress.links) add(link.lowerFloorId, "STAIR_RESERVATION", link.upperFloorId, link.stairShape, true);
  for (const route of egress.routes) add(route.floorId, "EGRESS_CANDIDATE", route.roomId, route.points, false, route.unitId);
  const ground = scenario.floorPrograms.find(floor => floor.level === 1)!;
  add(ground.id, "EXIT_LANDING", ground.id, egress.exitLanding, true);
  add(ground.id, "EGRESS_GROUND_CANDIDATE", ground.id, egress.groundRoute, false);
  const layerCounts = Object.fromEntries([...new Set(entities.map(entity => entity.layer))]
    .map(layer => [layer, entities.filter(entity => entity.layer === layer).length]));
  const metadata = { version: INTERIOR_DRAWING_EXPORT_VERSION, purpose: "preliminary-interior-review", approvalStatus: "unverified",
    projectId: input.projectId, scenarioId: scenario.id, scenarioVersion: scenario.version, inputKey,
    inputBasis: analysisReferenceInputBasis(scenario, parcel, geometry),
    geometryHash: geometry.geometryHash, analysisReference: geometry.analysisReference ?? null,
    coordinateSystem: { unit: "meter", eastAxis: "+X", northAxis: "+Y", upAxis: "+Z",
      originLngLat: geometry.coordinateSystem.originLngLat, transform: "DXF X=plan.x, DXF Y=-plan.z, DXF elevation=floor.baseHeightM" },
    declaredScope: "stored residential schematic subdivisions, openings and route candidates; not wall solids or permit drawings",
    layerCounts, entities, egress, quantities,
    financialAreas: { constructionAreaSqm: contract.constructionAreaSqm, saleableAreaSqm: contract.saleableAreaSqm,
      rentableAreaSqm: contract.rentableAreaSqm, providedParkingSpaces: contract.providedParkingSpaces, requiredParkingSpaces: contract.requiredParkingSpaces },
    rawPlan: { floorPrograms: scenario.floorPrograms, placement: scenario.placement, parking: scenario.parking, egressPlan: scenario.egressPlan },
    verification, limitations: LIMITATIONS };
  const dxfText = buildDxf(entities, inputKey), metadataText = JSON.stringify(metadata, null, 2);
  const quantitiesText = JSON.stringify(quantities, null, 2);
  const readmeText = ["PARCELGRID 예비 실내 검토 도면", INTERIOR_DRAWING_EXPORT_VERSION,
    `Project: ${input.projectId}`, `Scenario: ${scenario.id} / v${scenario.version}`, `Input: ${inputKey}`,
    "", "파일: interior.dxf, metadata.json, quantities.json, README-KO.txt", "",
    "좌표: 미터, 동쪽+X, 북쪽+Y, 위+Z. 3D POLYLINE 꼭짓점 Z는 실제 계획 층 바닥 높이입니다.",
    "층별 PG_Fxx/PG_Bxx 레이어를 분리해 확인합니다. 개구부는 선분, 피난은 후보 경로, 계단은 예약 외곽선입니다.",
    "metadata.json은 객체 ID·원본 층/실/문·입력 연결값과 검증 결과를 보존합니다. quantities.json은 포함/제외 범위를 가진 예비 수량입니다.",
    "", ...LIMITATIONS, "", ...quantities.limitations].join("\n");
  const encoder = new TextEncoder();
  const files = [ ["interior.dxf", dxfText], ["metadata.json", metadataText], ["quantities.json", quantitiesText], ["README-KO.txt", readmeText] ]
    .map(([name, text]) => ({ name, bytes: encoder.encode(text) }));
  if (files.reduce((sum, file) => sum + file.bytes.length, 0) > 20_000_000) throw new Error("상세 도면 패키지 크기 한도를 초과했습니다.");
  return { filename: `PARCELGRID-interior-${inputKey.slice(-16)}.zip`, dxfText, metadataText, quantitiesText, readmeText,
    metadata, zipBytes: createStoredZip(files) };
}
