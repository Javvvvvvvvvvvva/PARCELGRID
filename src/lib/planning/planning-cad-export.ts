import type {
  CadastralContextSnapshot,
  CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import { buildCadastralLineworkPackage } from "@/lib/planning/cadastral-linework-export";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import { createStoredZip } from "@/lib/planning/sketchup-dae-export";
import type { SketchupExportPackageSnapshot } from "@/lib/planning/sketchup-export-package";

export const PLANNING_CAD_EXPORT_VERSION = "planning-cad-export-v1" as const;

interface CadLayerDefinition {
  name: string;
  color: number;
  defaultVisible: boolean;
  purpose: string;
  accuracy: "exact-plan" | "verified" | "estimated" | "reference";
}

interface CadEntity {
  layer: string;
  points: LocalPlanPoint[];
  closed: boolean;
}

export interface PlanningCadExportResult {
  filename: string;
  dxfFilename: string;
  geojsonFilename: string;
  metadataFilename: string;
  readmeFilename: string;
  dxfText: string;
  geojsonText: string;
  metadataText: string;
  readmeText: string;
  zipBytes: Uint8Array;
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9가-힣_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "parcelgrid-cad";
}

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function dxfPolyline(entity: CadEntity): string {
  if (entity.points.length < 2) return "";
  let output = dxfPair(0, "LWPOLYLINE");
  output += dxfPair(8, entity.layer);
  output += dxfPair(90, entity.points.length);
  output += dxfPair(70, entity.closed ? 1 : 0);
  for (const point of entity.points) {
    output += dxfPair(10, point.x.toFixed(6));
    output += dxfPair(20, (-point.z).toFixed(6));
  }
  return output;
}

function floorLayerName(level: number): string {
  const number = Math.abs(level).toString().padStart(2, "0");
  return level < 0
    ? `PG_PROPOSED_BASEMENT_${number}`
    : `PG_PROPOSED_FLOOR_${number}`;
}

function baseLayerDefinitions(): CadLayerDefinition[] {
  return [
    {
      name: "PG_SITE_BOUNDARY",
      color: 7,
      defaultVisible: true,
      purpose: "대상 필지 경계",
      accuracy: "verified",
    },
    {
      name: "PG_CONTEXT_BUILDINGS_VERIFIED",
      color: 8,
      defaultVisible: false,
      purpose: "등록 높이 주변 건물 외곽",
      accuracy: "verified",
    },
    {
      name: "PG_CONTEXT_BUILDINGS_ESTIMATED",
      color: 9,
      defaultVisible: false,
      purpose: "추정 높이 주변 건물 외곽",
      accuracy: "estimated",
    },
    {
      name: "PG_ADJACENT_PARCELS",
      color: 8,
      defaultVisible: false,
      purpose: "인접 필지 경계 참고선",
      accuracy: "reference",
    },
    {
      name: "PG_ROAD_PARCELS_CADASTRAL",
      color: 3,
      defaultVisible: true,
      purpose: "연속지적도 지목=도로 필지",
      accuracy: "verified",
    },
    {
      name: "PG_ROAD_BOUNDARY_UPIS",
      color: 8,
      defaultVisible: true,
      purpose: "VWorld 도시계획 도로 경계 참고",
      accuracy: "reference",
    },
    {
      name: "PG_ROAD_CENTERLINE_REFERENCE",
      color: 8,
      defaultVisible: false,
      purpose: "도로명·방향용 중심선 참고",
      accuracy: "reference",
    },
    {
      name: "PG_FRONTAGE",
      color: 5,
      defaultVisible: true,
      purpose: "대상 필지 접도 경계",
      accuracy: "verified",
    },
    {
      name: "PG_ROAD_WIDTH_SAMPLES",
      color: 4,
      defaultVisible: false,
      purpose: "검증 가능한 도로 폭 수직 샘플",
      accuracy: "reference",
    },
    {
      name: "PG_NORTH",
      color: 1,
      defaultVisible: true,
      purpose: "정북 방향",
      accuracy: "verified",
    },
    {
      name: "PG_LOCAL_ORIGIN",
      color: 2,
      defaultVisible: false,
      purpose: "SketchUp DAE와 공유하는 로컬 원점",
      accuracy: "verified",
    },
  ];
}

function planningFloorLayers(
  input: SketchupExportPackageSnapshot
): CadLayerDefinition[] {
  return input.planning.building.floors.map((floor) => ({
    name: floorLayerName(floor.level),
    color: floor.level < 0 ? 6 : 5,
    defaultVisible: true,
    purpose: `${floor.label} 계획 외곽 · ${floor.programAreaSqm.toFixed(2)}㎡`,
    accuracy: "exact-plan" as const,
  }));
}

function northEntities(parcel: LocalPlanPoint[]): CadEntity[] {
  if (parcel.length === 0) return [];
  const minX = Math.min(...parcel.map((point) => point.x));
  const maxZ = Math.max(...parcel.map((point) => -point.z));
  const x = minX - 4;
  const baseY = maxZ + 2;
  const tipY = baseY + 5;
  const fromCad = (cadX: number, cadY: number): LocalPlanPoint => ({
    x: cadX,
    z: -cadY,
  });
  return [
    {
      layer: "PG_NORTH",
      points: [fromCad(x, baseY), fromCad(x, tipY)],
      closed: false,
    },
    {
      layer: "PG_NORTH",
      points: [
        fromCad(x, tipY),
        fromCad(x - 0.9, tipY - 1.5),
        fromCad(x + 0.9, tipY - 1.5),
      ],
      closed: true,
    },
  ];
}

function originEntities(): CadEntity[] {
  return [
    {
      layer: "PG_LOCAL_ORIGIN",
      points: [
        { x: -0.5, z: 0 },
        { x: 0.5, z: 0 },
      ],
      closed: false,
    },
    {
      layer: "PG_LOCAL_ORIGIN",
      points: [
        { x: 0, z: -0.5 },
        { x: 0, z: 0.5 },
      ],
      closed: false,
    },
  ];
}

function buildCadEntities(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
}): CadEntity[] {
  const entities: CadEntity[] = [];
  const { planning, context } = input.basePackage;

  entities.push({
    layer: "PG_SITE_BOUNDARY",
    points: input.cadastral.targetParcel.polygon,
    closed: true,
  });

  for (const floor of planning.building.floors) {
    entities.push({
      layer: floorLayerName(floor.level),
      points: floor.shape,
      closed: true,
    });
  }

  for (const building of context.buildings) {
    const layer =
      building.accuracy === "verified"
        ? "PG_CONTEXT_BUILDINGS_VERIFIED"
        : "PG_CONTEXT_BUILDINGS_ESTIMATED";
    for (const polygon of building.polygons) {
      entities.push({ layer, points: polygon.outer, closed: true });
      for (const hole of polygon.holes) {
        entities.push({ layer, points: hole, closed: true });
      }
    }
  }

  for (const parcel of input.cadastral.adjacentParcels) {
    entities.push({
      layer: "PG_ADJACENT_PARCELS",
      points: parcel.polygon,
      closed: true,
    });
  }
  for (const parcel of input.cadastral.roadParcels) {
    entities.push({
      layer:
        parcel.jimokCode === "UPIS-UQ151"
          ? "PG_ROAD_BOUNDARY_UPIS"
          : "PG_ROAD_PARCELS_CADASTRAL",
      points: parcel.polygon,
      closed: true,
    });
  }
  for (const road of planning.roads) {
    entities.push({
      layer: "PG_ROAD_CENTERLINE_REFERENCE",
      points: road.points,
      closed: false,
    });
  }
  for (const frontage of input.cadastral.frontages) {
    entities.push({
      layer: "PG_FRONTAGE",
      points: frontage.frontage,
      closed: false,
    });
    for (const sample of frontage.widthSamples) {
      entities.push({
        layer: "PG_ROAD_WIDTH_SAMPLES",
        points: [sample.from, sample.to],
        closed: false,
      });
    }
  }

  entities.push(...northEntities(planning.parcel.polygon), ...originEntities());
  return entities.filter((entity) => entity.points.length >= 2);
}

export function buildPlanningCadDxf(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
}): {
  dxfText: string;
  layers: CadLayerDefinition[];
  entityCountByLayer: Record<string, number>;
} {
  if (!input.basePackage.validation.exportable) {
    throw new Error(
      input.basePackage.validation.blockingReasons[0] ??
        "계획 Geometry가 CAD export 조건을 통과하지 못했습니다."
    );
  }

  const entities = buildCadEntities(input);
  const definitions = [
    ...baseLayerDefinitions(),
    ...planningFloorLayers(input.basePackage),
  ];
  const usedLayerNames = new Set(entities.map((entity) => entity.layer));
  const layers = definitions.filter((layer) => usedLayerNames.has(layer.name));
  const entityCountByLayer: Record<string, number> = {};
  for (const entity of entities) {
    entityCountByLayer[entity.layer] =
      (entityCountByLayer[entity.layer] ?? 0) + 1;
  }

  let header = dxfPair(0, "SECTION") + dxfPair(2, "HEADER");
  header += dxfPair(9, "$ACADVER") + dxfPair(1, "AC1015");
  header += dxfPair(9, "$INSUNITS") + dxfPair(70, 6);
  header += dxfPair(9, "$LUNITS") + dxfPair(70, 2);
  header += dxfPair(9, "$LUPREC") + dxfPair(70, 4);
  header += dxfPair(0, "ENDSEC");

  let tables = dxfPair(0, "SECTION") + dxfPair(2, "TABLES");
  tables +=
    dxfPair(0, "TABLE") +
    dxfPair(2, "LAYER") +
    dxfPair(70, layers.length);
  for (const layer of layers) {
    tables += dxfPair(0, "LAYER");
    tables += dxfPair(2, layer.name);
    tables += dxfPair(70, 0);
    tables += dxfPair(62, layer.defaultVisible ? layer.color : -layer.color);
    tables += dxfPair(6, "CONTINUOUS");
  }
  tables += dxfPair(0, "ENDTAB") + dxfPair(0, "ENDSEC");

  let entitySection = dxfPair(0, "SECTION") + dxfPair(2, "ENTITIES");
  for (const entity of entities) entitySection += dxfPolyline(entity);
  entitySection += dxfPair(0, "ENDSEC");

  return {
    dxfText: `${header}${tables}${entitySection}${dxfPair(0, "EOF")}`,
    layers,
    entityCountByLayer,
  };
}

function buildReadme(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  dxfFilename: string;
  geojsonFilename: string;
  metadataFilename: string;
  layers: CadLayerDefinition[];
}): string {
  const origin = input.basePackage.planning.coordinateSystem.originLngLat;
  return [
    "PARCELGRID CAD Design Base Package",
    "=================================",
    `Project: ${input.basePackage.projectId}`,
    `Scenario: ${input.basePackage.scenarioId} v${input.basePackage.scenarioVersion}`,
    `Geometry hash: ${input.basePackage.planningGeometryHash}`,
    `Cadastral hash: ${input.cadastral.cadastralHash}`,
    "",
    "파일",
    `- ${input.dxfFilename}: AutoCAD·BricsCAD·DraftSight용 2D 설계 기준선`,
    `- ${input.geojsonFilename}: WGS84 지적·도로 원좌표 확인용`,
    `- ${input.metadataFilename}: 좌표·해시·레이어·출처 기록`,
    "",
    "CAD 열기",
    "1. DXF는 AutoCAD R2000 ASCII 형식입니다.",
    "2. 도면 단위는 meter입니다. UNITS에서 Insertion scale=Meters를 확인하세요.",
    "3. 사무실 기본 도면이 millimeter이면 전체 DXF를 1000배로 한 번만 스케일하세요.",
    "4. 동쪽은 +X, 북쪽은 +Y이며 SketchUp DAE와 동일한 로컬 원점을 사용합니다.",
    "5. DWG가 필요하면 DXF를 연 뒤 Save As로 DWG 사본을 만드세요.",
    `6. WGS84 원점은 ${origin.join(", ")} 입니다.`,
    "",
    "레이어",
    ...input.layers.map(
      (layer) =>
        `- ${layer.name}: ${layer.purpose} · ${layer.defaultVisible ? "기본 ON" : "기본 OFF"} · ${layer.accuracy}`
    ),
    "",
    "정확도 원칙",
    "- PG_PROPOSED_*는 잠긴 대표안 Geometry Snapshot의 실제 층별 외곽선입니다.",
    "- PG_ADJACENT_PARCELS와 주변 건물은 참고용이며 혼동 방지를 위해 기본 OFF입니다.",
    "- PG_ROAD_PARCELS_CADASTRAL은 지목=도로 지적 필지입니다.",
    "- PG_ROAD_BOUNDARY_UPIS는 도시계획 도로 참고 경계이며 현황 포장면이나 측량 성과도가 아닙니다.",
    "- 인허가·실시설계 전에는 건축사와 측량 성과도로 경계·도로 폭을 재확인해야 합니다.",
    "",
  ].join("\n");
}

export function buildPlanningCadPackage(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: CadastralParcelFeature[];
}): PlanningCadExportResult {
  const cad = buildPlanningCadDxf(input);
  const linework = buildCadastralLineworkPackage({
    snapshot: input.cadastral,
    targetBoundary: input.targetBoundary,
    sourceParcels: input.sourceParcels,
  });
  const base = safeFilename(
    `PARCELGRID-${input.basePackage.projectId}-${input.basePackage.planningGeometryHash}-CAD`
  );
  const dxfFilename = `${base}-design-base.dxf`;
  const geojsonFilename = `${base}-source.geojson`;
  const metadataFilename = `${base}-metadata.json`;
  const readmeFilename = "README-PARCELGRID-CAD-KO.txt";
  const metadataText = JSON.stringify(
    {
      exportVersion: PLANNING_CAD_EXPORT_VERSION,
      projectId: input.basePackage.projectId,
      scenarioId: input.basePackage.scenarioId,
      scenarioVersion: input.basePackage.scenarioVersion,
      generatedAt: input.basePackage.generatedAt,
      planningGeometryHash: input.basePackage.planningGeometryHash,
      contextGeometryHash: input.basePackage.contextGeometryHash,
      cadastralHash: input.cadastral.cadastralHash,
      coordinateSystem: {
        unit: "meter",
        eastAxis: "+X",
        northAxis: "+Y",
        relationToSketchupDae: "DXF Y = - DAE Z",
        originLngLat: input.basePackage.planning.coordinateSystem.originLngLat,
      },
      files: {
        dxf: dxfFilename,
        geojson: geojsonFilename,
        metadata: metadataFilename,
        readme: readmeFilename,
      },
      layers: cad.layers.map((layer) => ({
        ...layer,
        entityCount: cad.entityCountByLayer[layer.name] ?? 0,
      })),
      validation: {
        planning: input.basePackage.planning.validation,
        context: input.basePackage.context.validation,
        cadastral: input.cadastral.validation,
      },
      sourceNotes: [
        ...input.basePackage.planning.sourceNotes,
        ...input.basePackage.context.sourceNotes,
        ...input.cadastral.sourceNotes,
      ],
      disclaimers: [
        "이 DXF는 개략설계 전달용이며 인허가도·시공도·측량 성과도가 아닙니다.",
        "계획 매스 외의 지적·도로·주변 건물 정보는 해당 출처와 검증 상태를 확인해야 합니다.",
      ],
    },
    null,
    2
  );
  const readmeText = buildReadme({
    ...input,
    dxfFilename,
    geojsonFilename,
    metadataFilename,
    layers: cad.layers,
  });
  const encoder = new TextEncoder();
  const zipBytes = createStoredZip([
    { name: dxfFilename, bytes: encoder.encode(cad.dxfText) },
    { name: geojsonFilename, bytes: encoder.encode(linework.geojsonText) },
    { name: metadataFilename, bytes: encoder.encode(metadataText) },
    { name: readmeFilename, bytes: encoder.encode(readmeText) },
  ]);

  return {
    filename: `${base}.zip`,
    dxfFilename,
    geojsonFilename,
    metadataFilename,
    readmeFilename,
    dxfText: cad.dxfText,
    geojsonText: linework.geojsonText,
    metadataText,
    readmeText,
    zipBytes,
  };
}

export function downloadPlanningCadPackage(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: CadastralParcelFeature[];
}): PlanningCadExportResult {
  const result = buildPlanningCadPackage(input);
  if (typeof window !== "undefined") {
    const data = result.zipBytes.buffer.slice(
      result.zipBytes.byteOffset,
      result.zipBytes.byteOffset + result.zipBytes.byteLength
    ) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return result;
}
