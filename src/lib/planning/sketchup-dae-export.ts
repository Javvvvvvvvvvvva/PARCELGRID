import { ShapeUtils, Vector2 } from "three";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import type {
  LocalContextPolygon,
  SketchupExportPackageSnapshot,
  SketchupLayerName,
} from "@/lib/planning/sketchup-export-package";

export const SKETCHUP_DAE_EXPORT_VERSION = "sketchup-dae-export-v1" as const;

interface MeshData {
  id: string;
  name: string;
  layer: SketchupLayerName;
  materialId: string;
  positions: number[];
  triangles: number[];
}

interface ExportFile {
  name: string;
  bytes: Uint8Array;
}

export interface SketchupDaeExportResult {
  filename: string;
  daeFilename: string;
  metadataFilename: string;
  readmeFilename: string;
  daeText: string;
  metadataText: string;
  readmeText: string;
  zipBytes: Uint8Array;
}

export class SketchupExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SketchupExportBlockedError";
  }
}

const MATERIALS = {
  parcel: { id: "mat-parcel", color: [0.77, 0.71, 0.61, 1] },
  proposed: { id: "mat-proposed", color: [0.72, 0.82, 0.9, 1] },
  contextVerified: { id: "mat-context-verified", color: [0.62, 0.66, 0.7, 0.68] },
  contextEstimated: { id: "mat-context-estimated", color: [0.76, 0.79, 0.82, 0.42] },
  roads: { id: "mat-roads", color: [0.29, 0.33, 0.38, 1] },
  north: { id: "mat-north", color: [0.9, 0.18, 0.15, 1] },
} as const;

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]+/g, "_");
  return /^[A-Za-z_]/.test(normalized) ? normalized : `id_${normalized}`;
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9가-힣_.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "parcelgrid-export";
}

function ensureTopWinding(
  a: LocalPlanPoint,
  b: LocalPlanPoint,
  c: LocalPlanPoint
): [number, number, number] {
  const normalY =
    (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  return normalY >= 0 ? [0, 1, 2] : [0, 2, 1];
}

function prismMesh(input: {
  id: string;
  name: string;
  layer: SketchupLayerName;
  materialId: string;
  outer: LocalPlanPoint[];
  holes?: LocalPlanPoint[][];
  bottomY: number;
  topY: number;
}): MeshData | null {
  const outer = openRing(input.outer);
  const holes = (input.holes ?? []).map(openRing).filter((ring) => ring.length >= 3);
  if (outer.length < 3 || input.topY <= input.bottomY) return null;

  const rings = [outer, ...holes];
  const flatPoints = rings.flat();
  const contour = outer.map((point) => new Vector2(point.x, point.z));
  const holeVectors = holes.map((ring) =>
    ring.map((point) => new Vector2(point.x, point.z))
  );
  const capFaces = ShapeUtils.triangulateShape(contour, holeVectors);
  if (capFaces.length === 0) return null;

  const positions: number[] = [];
  for (const point of flatPoints) {
    positions.push(point.x, input.bottomY, point.z);
  }
  for (const point of flatPoints) {
    positions.push(point.x, input.topY, point.z);
  }

  const triangles: number[] = [];
  const topOffset = flatPoints.length;
  for (const face of capFaces) {
    const [a, b, c] = face;
    const winding = ensureTopWinding(flatPoints[a], flatPoints[b], flatPoints[c]);
    const ordered = [face[winding[0]], face[winding[1]], face[winding[2]]];
    triangles.push(ordered[0] + topOffset, ordered[1] + topOffset, ordered[2] + topOffset);
    triangles.push(ordered[2], ordered[1], ordered[0]);
  }

  let ringStart = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const next = (index + 1) % ring.length;
      const bottomA = ringStart + index;
      const bottomB = ringStart + next;
      const topA = bottomA + topOffset;
      const topB = bottomB + topOffset;
      triangles.push(bottomA, bottomB, topB, bottomA, topB, topA);
    }
    ringStart += ring.length;
  }

  return {
    id: xmlId(input.id),
    name: input.name,
    layer: input.layer,
    materialId: input.materialId,
    positions,
    triangles,
  };
}

function mergeMeshes(input: {
  id: string;
  name: string;
  layer: SketchupLayerName;
  materialId: string;
  meshes: Array<MeshData | null>;
}): MeshData | null {
  const positions: number[] = [];
  const triangles: number[] = [];
  for (const mesh of input.meshes) {
    if (!mesh) continue;
    const offset = positions.length / 3;
    positions.push(...mesh.positions);
    triangles.push(...mesh.triangles.map((index) => index + offset));
  }
  if (positions.length === 0 || triangles.length === 0) return null;
  return {
    id: xmlId(input.id),
    name: input.name,
    layer: input.layer,
    materialId: input.materialId,
    positions,
    triangles,
  };
}

function ribbonPolygon(
  start: LocalPlanPoint,
  end: LocalPlanPoint,
  widthM: number
): LocalPlanPoint[] | null {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  const half = widthM / 2;
  const nx = (-dz / length) * half;
  const nz = (dx / length) * half;
  return [
    { x: start.x + nx, z: start.z + nz },
    { x: end.x + nx, z: end.z + nz },
    { x: end.x - nx, z: end.z - nz },
    { x: start.x - nx, z: start.z - nz },
  ];
}

function contextBuildingMesh(
  building: SketchupExportPackageSnapshot["context"]["buildings"][number]
): MeshData | null {
  const layer: SketchupLayerName =
    building.accuracy === "verified"
      ? "PG_CONTEXT_BUILDINGS_VERIFIED"
      : "PG_CONTEXT_BUILDINGS_ESTIMATED";
  const materialId =
    building.accuracy === "verified"
      ? MATERIALS.contextVerified.id
      : MATERIALS.contextEstimated.id;
  return mergeMeshes({
    id: `${layer}-${building.id}`,
    name: building.name || building.id,
    layer,
    materialId,
    meshes: building.polygons.map((polygon, index) =>
      prismMesh({
        id: `${building.id}-${index}`,
        name: building.name || building.id,
        layer,
        materialId,
        outer: polygon.outer,
        holes: polygon.holes,
        bottomY: 0,
        topY: building.heightM,
      })
    ),
  });
}

function createMeshes(snapshot: SketchupExportPackageSnapshot): MeshData[] {
  const meshes: MeshData[] = [];
  const parcel = prismMesh({
    id: "PG_PARCEL-01",
    name: "Target Parcel",
    layer: "PG_PARCEL",
    materialId: MATERIALS.parcel.id,
    outer: snapshot.planning.parcel.polygon,
    bottomY: -0.04,
    topY: 0,
  });
  if (parcel) meshes.push(parcel);

  for (const floor of snapshot.planning.building.floors) {
    const mesh = prismMesh({
      id: `PG_PROPOSED_MASS-${floor.id}`,
      name: `${floor.label} ${floor.dominantUse}`,
      layer: "PG_PROPOSED_MASS",
      materialId: MATERIALS.proposed.id,
      outer: floor.shape,
      bottomY: floor.baseHeightM,
      topY: floor.topHeightM,
    });
    if (mesh) meshes.push(mesh);
  }

  for (const building of snapshot.context.buildings) {
    const mesh = contextBuildingMesh(building);
    if (mesh) meshes.push(mesh);
  }

  snapshot.planning.roads.forEach((road, roadIndex) => {
    const segments: Array<MeshData | null> = [];
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const polygon = ribbonPolygon(road.points[index], road.points[index + 1], 0.16);
      if (!polygon) continue;
      segments.push(
        prismMesh({
          id: `road-${roadIndex}-${index}`,
          name: road.name || `Road ${roadIndex + 1}`,
          layer: "PG_ROADS",
          materialId: MATERIALS.roads.id,
          outer: polygon,
          bottomY: 0.015,
          topY: 0.035,
        })
      );
    }
    const roadMesh = mergeMeshes({
      id: `PG_ROADS-${roadIndex}`,
      name: road.name || `Road ${roadIndex + 1}`,
      layer: "PG_ROADS",
      materialId: MATERIALS.roads.id,
      meshes: segments,
    });
    if (roadMesh) meshes.push(roadMesh);
  });

  const parcelPoints = snapshot.planning.parcel.polygon;
  const minX = Math.min(...parcelPoints.map((point) => point.x));
  const maxX = Math.max(...parcelPoints.map((point) => point.x));
  const minZ = Math.min(...parcelPoints.map((point) => point.z));
  const maxZ = Math.max(...parcelPoints.map((point) => point.z));
  const extent = Math.max(8, maxX - minX, maxZ - minZ);
  const arrowLength = Math.max(4, extent * 0.42);
  const arrowX = minX - Math.max(2, extent * 0.16);
  const arrowBaseZ = maxZ;
  const stem = ribbonPolygon(
    { x: arrowX, z: arrowBaseZ },
    { x: arrowX, z: arrowBaseZ - arrowLength },
    Math.max(0.12, extent * 0.012)
  );
  const headSize = Math.max(0.65, extent * 0.055);
  const head: LocalPlanPoint[] = [
    { x: arrowX, z: arrowBaseZ - arrowLength - headSize },
    { x: arrowX - headSize * 0.72, z: arrowBaseZ - arrowLength + headSize * 0.28 },
    { x: arrowX + headSize * 0.72, z: arrowBaseZ - arrowLength + headSize * 0.28 },
  ];
  const northMesh = mergeMeshes({
    id: "PG_NORTH-01",
    name: "True North (-Z)",
    layer: "PG_NORTH",
    materialId: MATERIALS.north.id,
    meshes: [
      stem
        ? prismMesh({
            id: "north-stem",
            name: "True North",
            layer: "PG_NORTH",
            materialId: MATERIALS.north.id,
            outer: stem,
            bottomY: 0.05,
            topY: 0.09,
          })
        : null,
      prismMesh({
        id: "north-head",
        name: "True North",
        layer: "PG_NORTH",
        materialId: MATERIALS.north.id,
        outer: head,
        bottomY: 0.05,
        topY: 0.09,
      }),
    ],
  });
  if (northMesh) meshes.push(northMesh);

  return meshes;
}

function materialLibraries(): string {
  const materials = Object.values(MATERIALS);
  const effects = materials
    .map(({ id, color }) => {
      const [r, g, b, a] = color;
      return `<effect id="${id}-effect"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${r} ${g} ${b} ${a}</color></diffuse><transparency><float>${a}</float></transparency></lambert></technique><extra><technique profile="GOOGLEEARTH"><double_sided>1</double_sided></technique></extra></profile_COMMON></effect>`;
    })
    .join("");
  const libraryMaterials = materials
    .map(({ id }) => `<material id="${id}" name="${id}"><instance_effect url="#${id}-effect"/></material>`)
    .join("");
  return `<library_effects>${effects}</library_effects><library_materials>${libraryMaterials}</library_materials>`;
}

function geometryXml(mesh: MeshData): string {
  const positionsId = `${mesh.id}-positions`;
  const verticesId = `${mesh.id}-vertices`;
  return `<geometry id="${mesh.id}-geometry" name="${xmlEscape(mesh.name)}"><mesh><source id="${positionsId}"><float_array id="${positionsId}-array" count="${mesh.positions.length}">${mesh.positions.join(" ")}</float_array><technique_common><accessor source="#${positionsId}-array" count="${mesh.positions.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${verticesId}"><input semantic="POSITION" source="#${positionsId}"/></vertices><triangles count="${mesh.triangles.length / 3}" material="${mesh.materialId}-symbol"><input semantic="VERTEX" source="#${verticesId}" offset="0"/><p>${mesh.triangles.join(" ")}</p></triangles></mesh></geometry>`;
}

function visualSceneXml(
  snapshot: SketchupExportPackageSnapshot,
  meshes: MeshData[]
): string {
  const layerOrder: SketchupLayerName[] = [
    "PG_PARCEL",
    "PG_PROPOSED_MASS",
    "PG_CONTEXT_BUILDINGS_VERIFIED",
    "PG_CONTEXT_BUILDINGS_ESTIMATED",
    "PG_ROADS",
    "PG_NORTH",
  ];
  const layerNodes = layerOrder
    .map((layer) => {
      const children = meshes
        .filter((mesh) => mesh.layer === layer)
        .map(
          (mesh) =>
            `<node id="${mesh.id}-node" name="${xmlEscape(mesh.name)}" type="NODE"><instance_geometry url="#${mesh.id}-geometry"><bind_material><technique_common><instance_material symbol="${mesh.materialId}-symbol" target="#${mesh.materialId}"/></technique_common></bind_material></instance_geometry></node>`
        )
        .join("");
      return `<node id="${layer}-node" name="${layer}" type="NODE">${children}</node>`;
    })
    .join("");
  const metadata = `<node id="PG_METADATA-node" name="PG_METADATA" type="NODE"><extra><technique profile="PARCELGRID"><package_hash>${snapshot.exportPackageHash}</package_hash><planning_hash>${snapshot.planningGeometryHash}</planning_hash><context_hash>${snapshot.contextGeometryHash}</context_hash><unit>meter</unit><north_axis>-Z</north_axis><east_axis>+X</east_axis><origin_lng>${snapshot.planning.coordinateSystem.originLngLat[0]}</origin_lng><origin_lat>${snapshot.planning.coordinateSystem.originLngLat[1]}</origin_lat></technique></extra></node>`;
  return `<library_visual_scenes><visual_scene id="ParcelGridScene" name="PARCELGRID ${snapshot.exportPackageHash}"><node id="PARCELGRID_PACKAGE" name="PARCELGRID_${snapshot.exportPackageHash}" type="NODE">${layerNodes}${metadata}</node></visual_scene></library_visual_scenes>`;
}

export function buildSketchupDae(snapshot: SketchupExportPackageSnapshot): string {
  if (!snapshot.validation.exportable) {
    throw new SketchupExportBlockedError(
      snapshot.validation.blockingReasons[0] ??
        "계획 매스 검증을 통과하지 못해 SketchUp 파일을 만들 수 없습니다."
    );
  }
  const meshes = createMeshes(snapshot);
  const geometries = meshes.map(geometryXml).join("");
  const created = xmlEscape(snapshot.generatedAt);
  return `<?xml version="1.0" encoding="utf-8"?>\n<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><contributor><authoring_tool>PARCELGRID ${SKETCHUP_DAE_EXPORT_VERSION}</authoring_tool><comments>${snapshot.exportPackageHash} | verified planning mass with GIS context</comments></contributor><created>${created}</created><modified>${created}</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>${materialLibraries()}<library_geometries>${geometries}</library_geometries>${visualSceneXml(snapshot, meshes)}<scene><instance_visual_scene url="#ParcelGridScene"/></scene></COLLADA>`;
}

function metadataFor(snapshot: SketchupExportPackageSnapshot) {
  return {
    exportVersion: SKETCHUP_DAE_EXPORT_VERSION,
    packageVersion: snapshot.version,
    projectId: snapshot.projectId,
    scenarioId: snapshot.scenarioId,
    scenarioVersion: snapshot.scenarioVersion,
    generatedAt: snapshot.generatedAt,
    hashes: {
      planning: snapshot.planningGeometryHash,
      context: snapshot.contextGeometryHash,
      package: snapshot.exportPackageHash,
    },
    coordinateSystem: snapshot.planning.coordinateSystem,
    validation: snapshot.validation,
    layers: snapshot.layers,
    planning: {
      scenarioName: snapshot.planning.scenarioName,
      parcel: snapshot.planning.parcel,
      building: {
        totalHeightM: snapshot.planning.building.totalHeightM,
        basementDepthM: snapshot.planning.building.basementDepthM,
        totalProgramAreaSqm: snapshot.planning.building.totalProgramAreaSqm,
        totalGeometryAreaSqm: snapshot.planning.building.totalGeometryAreaSqm,
        preliminaryFarPct: snapshot.planning.building.preliminaryFarPct,
        preliminaryBcrPct: snapshot.planning.building.preliminaryBcrPct,
        floors: snapshot.planning.building.floors.map((floor) => ({
          id: floor.id,
          label: floor.label,
          level: floor.level,
          baseHeightM: floor.baseHeightM,
          topHeightM: floor.topHeightM,
          floorHeightM: floor.floorHeightM,
          programAreaSqm: floor.programAreaSqm,
          geometryAreaSqm: floor.visualAreaSqm,
          shape: floor.shape,
        })),
      },
      roads: snapshot.planning.roads,
      sourceNotes: snapshot.planning.sourceNotes,
    },
    context: {
      radiusM: snapshot.context.radiusM,
      summary: snapshot.context.summary,
      buildings: snapshot.context.buildings.map((building) => ({
        id: building.id,
        name: building.name,
        heightM: building.heightM,
        groundFloors: building.groundFloors,
        heightSource: building.heightSource,
        accuracy: building.accuracy,
        source: building.source,
        sourceFootprintAreaSqm: building.sourceFootprintAreaSqm,
        measuredFootprintAreaSqm: building.measuredFootprintAreaSqm,
      })),
      issues: snapshot.context.validation.issues,
      sourceNotes: snapshot.context.sourceNotes,
    },
    importNotes: [
      "SketchUp에서 File > Import > COLLADA (.dae)로 가져오세요.",
      "모델 단위는 meter, 정북은 -Z, 동쪽은 +X, 위쪽은 +Y입니다.",
      "DAE는 PG_* 이름의 그룹 계층을 보존합니다. SketchUp 버전에 따라 Tags 자동 생성 여부는 다를 수 있습니다.",
      "PG_PROPOSED_MASS만 설계 기준 치수로 사용하고, PG_CONTEXT_BUILDINGS_ESTIMATED는 높이 추정 맥락 레이어로 사용하세요.",
      "도로는 실제 폭이 아닌 VWorld 중심선을 0.16m 참고 띠로 표시합니다.",
    ],
  };
}

function buildReadme(snapshot: SketchupExportPackageSnapshot): string {
  return [
    "PARCELGRID SketchUp DAE Export Package",
    "======================================",
    `Package hash: ${snapshot.exportPackageHash}`,
    `Planning hash: ${snapshot.planningGeometryHash}`,
    `Context hash: ${snapshot.contextGeometryHash}`,
    `Scenario: ${snapshot.planning.scenarioName} v${snapshot.scenarioVersion}`,
    "",
    "가져오기",
    "1. SketchUp 데스크톱에서 File > Import를 선택합니다.",
    "2. 파일 형식에서 COLLADA File (*.dae)를 선택합니다.",
    "3. 이 ZIP에 포함된 .dae 파일을 가져옵니다.",
    "4. 모델 단위는 meter입니다.",
    "",
    "좌표 기준",
    "- 동쪽: +X",
    "- 북쪽: -Z",
    "- 위쪽: +Y",
    `- WGS84 원점: ${snapshot.planning.coordinateSystem.originLngLat.join(", ")}`,
    "",
    "그룹 계층",
    ...snapshot.layers.map(
      (layer) => `- ${layer.name}: ${layer.objectCount}개 · ${layer.purpose}`
    ),
    "",
    "정확도 주의",
    "- PG_PROPOSED_MASS는 Geometry Contract를 통과한 설계 시작 기준 매스입니다.",
    "- PG_CONTEXT_BUILDINGS_VERIFIED는 GIS 외곽과 등록 높이를 사용합니다.",
    "- PG_CONTEXT_BUILDINGS_ESTIMATED는 GIS 외곽에 층수/기본 층고 기반 추정 높이를 사용합니다.",
    "- PG_ROADS는 실제 도로 경계나 폭이 아니라 VWorld 도로 중심선 참고 표현입니다.",
    "- DAE 그룹명은 유지되지만 SketchUp Tags 자동 생성은 버전에 따라 다를 수 있습니다.",
    "",
    "검증 경고",
    ...(snapshot.validation.warnings.length > 0
      ? snapshot.validation.warnings.map((warning) => `- ${warning}`)
      : ["- 없음"]),
    "",
  ].join("\n");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function createStoredZip(files: ExportFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x0800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, 0);
    writeU16(localView, 12, 0);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, file.bytes.length);
    writeU32(localView, 22, file.bytes.length);
    writeU16(localView, 26, name.length);
    writeU16(localView, 28, 0);
    localHeader.set(name, 30);
    localChunks.push(localHeader, file.bytes);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x0800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, 0);
    writeU16(centralView, 14, 0);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, file.bytes.length);
    writeU32(centralView, 24, file.bytes.length);
    writeU16(centralView, 28, name.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralChunks.push(centralHeader);

    localOffset += localHeader.length + file.bytes.length;
  }

  const localData = concatBytes(localChunks);
  const centralData = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 4, 0);
  writeU16(endView, 6, 0);
  writeU16(endView, 8, files.length);
  writeU16(endView, 10, files.length);
  writeU32(endView, 12, centralData.length);
  writeU32(endView, 16, localData.length);
  writeU16(endView, 20, 0);
  return concatBytes([localData, centralData, end]);
}

export function buildSketchupDaeExport(
  snapshot: SketchupExportPackageSnapshot
): SketchupDaeExportResult {
  const daeText = buildSketchupDae(snapshot);
  const metadataText = `${JSON.stringify(metadataFor(snapshot), null, 2)}\n`;
  const readmeText = buildReadme(snapshot);
  const base = safeFilename(
    `PARCELGRID-${snapshot.projectId}-${snapshot.planning.scenarioName}-${snapshot.exportPackageHash}`
  );
  const daeFilename = `${base}.dae`;
  const metadataFilename = `${base}-metadata.json`;
  const readmeFilename = "README-KO.txt";
  const encoder = new TextEncoder();
  const zipBytes = createStoredZip([
    { name: daeFilename, bytes: encoder.encode(daeText) },
    { name: metadataFilename, bytes: encoder.encode(metadataText) },
    { name: readmeFilename, bytes: encoder.encode(readmeText) },
  ]);
  return {
    filename: `${base}.zip`,
    daeFilename,
    metadataFilename,
    readmeFilename,
    daeText,
    metadataText,
    readmeText,
    zipBytes,
  };
}

export function downloadSketchupDaeExport(
  snapshot: SketchupExportPackageSnapshot
): SketchupDaeExportResult {
  const result = buildSketchupDaeExport(snapshot);
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return result;
}
