import { ShapeUtils, Vector2 } from "three";
import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";
import {
  buildCadastralLineworkPackage,
} from "@/lib/planning/cadastral-linework-export";
import {
  buildSketchupDaeExport,
  createStoredZip,
} from "@/lib/planning/sketchup-dae-export";
import type { SketchupExportPackageSnapshot } from "@/lib/planning/sketchup-export-package";

export const SKETCHUP_SITE_EXPORT_VERSION = "sketchup-site-export-v1" as const;

interface MeshData {
  id: string;
  name: string;
  layer: string;
  materialId: string;
  positions: number[];
  triangles: number[];
}

export interface SketchupSiteExportResult {
  filename: string;
  modelDaeFilename: string;
  siteDaeFilename: string;
  dxfFilename: string;
  geojsonFilename: string;
  metadataFilename: string;
  readmeFilename: string;
  siteDaeText: string;
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
  return normalized || "parcelgrid-site-export";
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

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `SITE-${(hash >>> 0).toString(16).padStart(8, "0").toUpperCase()}`;
}

function openRing(points: LocalPlanPoint[]): LocalPlanPoint[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return first.x === last.x && first.z === last.z ? points.slice(0, -1) : points;
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
  layer: string;
  materialId: string;
  outer: LocalPlanPoint[];
  bottomY: number;
  topY: number;
}): MeshData | null {
  const outer = openRing(input.outer);
  if (outer.length < 3 || input.topY <= input.bottomY) return null;
  const contour = outer.map((point) => new Vector2(point.x, point.z));
  const capFaces = ShapeUtils.triangulateShape(contour, []);
  if (capFaces.length === 0) return null;

  const positions: number[] = [];
  for (const point of outer) positions.push(point.x, input.bottomY, point.z);
  for (const point of outer) positions.push(point.x, input.topY, point.z);

  const triangles: number[] = [];
  const topOffset = outer.length;
  for (const face of capFaces) {
    const [a, b, c] = face;
    const winding = ensureTopWinding(outer[a], outer[b], outer[c]);
    const ordered = [face[winding[0]], face[winding[1]], face[winding[2]]];
    triangles.push(
      ordered[0] + topOffset,
      ordered[1] + topOffset,
      ordered[2] + topOffset
    );
    triangles.push(ordered[2], ordered[1], ordered[0]);
  }
  for (let index = 0; index < outer.length; index += 1) {
    const next = (index + 1) % outer.length;
    const bottomA = index;
    const bottomB = next;
    const topA = bottomA + topOffset;
    const topB = bottomB + topOffset;
    triangles.push(bottomA, bottomB, topB, bottomA, topB, topA);
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

function lineMeshes(input: {
  layer: string;
  name: string;
  idPrefix: string;
  materialId: string;
  points: LocalPlanPoint[];
  widthM: number;
  bottomY: number;
  topY: number;
}): MeshData[] {
  const meshes: MeshData[] = [];
  for (let index = 0; index < input.points.length - 1; index += 1) {
    const polygon = ribbonPolygon(
      input.points[index],
      input.points[index + 1],
      input.widthM
    );
    if (!polygon) continue;
    const mesh = prismMesh({
      id: `${input.idPrefix}-${index}`,
      name: input.name,
      layer: input.layer,
      materialId: input.materialId,
      outer: polygon,
      bottomY: input.bottomY,
      topY: input.topY,
    });
    if (mesh) meshes.push(mesh);
  }
  return meshes;
}

const MATERIALS = [
  { id: "mat-adjacent", color: [0.63, 0.59, 0.53, 0.7] },
  { id: "mat-road-cadastral", color: [0.39, 0.43, 0.48, 0.44] },
  { id: "mat-road-upis", color: [0.2, 0.24, 0.29, 0.5] },
  { id: "mat-road-centerline", color: [0.08, 0.1, 0.14, 0.95] },
  { id: "mat-frontage", color: [0.15, 0.39, 0.92, 1] },
  { id: "mat-width", color: [0.98, 0.45, 0.09, 0.92] },
] as const;

function materialLibraries(): string {
  const effects = MATERIALS.map(({ id, color }) => {
    const [r, g, b, a] = color;
    return `<effect id="${id}-effect"><profile_COMMON><technique sid="common"><lambert><diffuse><color>${r} ${g} ${b} ${a}</color></diffuse><transparency><float>${a}</float></transparency></lambert></technique><extra><technique profile="GOOGLEEARTH"><double_sided>1</double_sided></technique></extra></profile_COMMON></effect>`;
  }).join("");
  const materials = MATERIALS.map(
    ({ id }) =>
      `<material id="${id}" name="${id}"><instance_effect url="#${id}-effect"/></material>`
  ).join("");
  return `<library_effects>${effects}</library_effects><library_materials>${materials}</library_materials>`;
}

function geometryXml(mesh: MeshData): string {
  const positionsId = `${mesh.id}-positions`;
  const verticesId = `${mesh.id}-vertices`;
  return `<geometry id="${mesh.id}-geometry" name="${xmlEscape(mesh.name)}"><mesh><source id="${positionsId}"><float_array id="${positionsId}-array" count="${mesh.positions.length}">${mesh.positions.join(" ")}</float_array><technique_common><accessor source="#${positionsId}-array" count="${mesh.positions.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source><vertices id="${verticesId}"><input semantic="POSITION" source="#${positionsId}"/></vertices><triangles count="${mesh.triangles.length / 3}" material="${mesh.materialId}-symbol"><input semantic="VERTEX" source="#${verticesId}" offset="0"/><p>${mesh.triangles.join(" ")}</p></triangles></mesh></geometry>`;
}

function createSiteMeshes(input: {
  cadastral: CadastralContextSnapshot;
  planning: SketchupExportPackageSnapshot["planning"];
}): MeshData[] {
  const meshes: MeshData[] = [];

  for (const parcel of input.cadastral.adjacentParcels) {
    const ring = openRing(parcel.polygon);
    meshes.push(
      ...lineMeshes({
        layer: "PG_ADJACENT_PARCELS",
        name: parcel.jibun || parcel.pnu,
        idPrefix: `adjacent-${parcel.pnu}`,
        materialId: "mat-adjacent",
        points: [...ring, ring[0]],
        widthM: 0.055,
        bottomY: 0.025,
        topY: 0.045,
      })
    );
  }

  for (const parcel of input.cadastral.roadParcels) {
    const upis = parcel.jimokCode === "UPIS-UQ151";
    const mesh = prismMesh({
      id: `${upis ? "upis-road" : "cadastral-road"}-${parcel.pnu}`,
      name: parcel.jibun || parcel.pnu,
      layer: upis ? "PG_ROAD_BOUNDARY_UPIS" : "PG_ROAD_PARCELS_CADASTRAL",
      materialId: upis ? "mat-road-upis" : "mat-road-cadastral",
      outer: parcel.polygon,
      bottomY: -0.025,
      topY: -0.005,
    });
    if (mesh) meshes.push(mesh);
  }

  input.planning.roads.forEach((road, roadIndex) => {
    meshes.push(
      ...lineMeshes({
        layer: "PG_ROAD_CENTERLINE_REFERENCE",
        name: road.name || `Road ${roadIndex + 1}`,
        idPrefix: `centerline-${roadIndex}`,
        materialId: "mat-road-centerline",
        points: road.points,
        widthM: 0.12,
        bottomY: 0.025,
        topY: 0.045,
      })
    );
  });

  for (const frontage of input.cadastral.frontages) {
    if (frontage.status === "planned-road-reference") continue;
    meshes.push(
      ...lineMeshes({
        layer: "PG_FRONTAGE",
        name: `Frontage ${frontage.roadParcelJibun || frontage.roadParcelPnu}`,
        idPrefix: `frontage-${frontage.roadParcelPnu}`,
        materialId: "mat-frontage",
        points: frontage.frontage,
        widthM: 0.16,
        bottomY: 0.055,
        topY: 0.08,
      })
    );
    frontage.widthSamples.forEach((sample, sampleIndex) => {
      meshes.push(
        ...lineMeshes({
          layer: "PG_ROAD_WIDTH_SAMPLES",
          name: `Width ${sample.widthM.toFixed(3)}m`,
          idPrefix: `width-${frontage.roadParcelPnu}-${sampleIndex}`,
          materialId: "mat-width",
          points: [sample.from, sample.to],
          widthM: 0.085,
          bottomY: 0.05,
          topY: 0.075,
        })
      );
    });
  }

  return meshes;
}

function visualSceneXml(
  meshes: MeshData[],
  siteHash: string,
  cadastral: CadastralContextSnapshot
): string {
  const layerOrder = [
    "PG_ADJACENT_PARCELS",
    "PG_ROAD_PARCELS_CADASTRAL",
    "PG_ROAD_BOUNDARY_UPIS",
    "PG_ROAD_CENTERLINE_REFERENCE",
    "PG_FRONTAGE",
    "PG_ROAD_WIDTH_SAMPLES",
  ];
  const layers = layerOrder
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
  const metadata = `<node id="PG_SITE_METADATA-node" name="PG_SITE_METADATA" type="NODE"><extra><technique profile="PARCELGRID"><site_hash>${siteHash}</site_hash><cadastral_hash>${cadastral.cadastralHash}</cadastral_hash><unit>meter</unit><north_axis>-Z</north_axis><east_axis>+X</east_axis><origin_lng>${cadastral.coordinateSystem.originLngLat[0]}</origin_lng><origin_lat>${cadastral.coordinateSystem.originLngLat[1]}</origin_lat></technique></extra></node>`;
  return `<library_visual_scenes><visual_scene id="ParcelGridSiteScene" name="PARCELGRID ${siteHash}"><node id="PARCELGRID_SITE_CONTEXT" name="PARCELGRID_SITE_${siteHash}" type="NODE">${layers}${metadata}</node></visual_scene></library_visual_scenes>`;
}

export function buildSiteContextDae(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  siteHash: string;
}): string {
  const meshes = createSiteMeshes({
    cadastral: input.cadastral,
    planning: input.basePackage.planning,
  });
  const geometries = meshes.map(geometryXml).join("");
  const created = xmlEscape(input.basePackage.generatedAt);
  return `<?xml version="1.0" encoding="utf-8"?>\n<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><contributor><authoring_tool>PARCELGRID ${SKETCHUP_SITE_EXPORT_VERSION}</authoring_tool><comments>${input.siteHash} | cadastral and UPIS road context</comments></contributor><created>${created}</created><modified>${created}</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>${materialLibraries()}<library_geometries>${geometries}</library_geometries>${visualSceneXml(meshes, input.siteHash, input.cadastral)}<scene><instance_visual_scene url="#ParcelGridSiteScene"/></scene></COLLADA>`;
}

function buildReadme(input: {
  siteHash: string;
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  modelDaeFilename: string;
  siteDaeFilename: string;
  dxfFilename: string;
}): string {
  return [
    "PARCELGRID SketchUp Integrated Site Package",
    "============================================",
    `Site hash: ${input.siteHash}`,
    `Planning hash: ${input.basePackage.planningGeometryHash}`,
    `Context hash: ${input.basePackage.contextGeometryHash}`,
    `Cadastral hash: ${input.cadastral.cadastralHash}`,
    "",
    "SketchUp 가져오기 순서",
    `1. ${input.modelDaeFilename} 를 COLLADA 형식으로 가져옵니다.`,
    `2. 원점을 이동하지 않은 상태에서 ${input.siteDaeFilename} 를 이어서 가져옵니다.`,
    "3. 두 DAE는 동일한 meter 단위와 WGS84 원점을 사용하므로 자동으로 겹칩니다.",
    `4. 필요하면 ${input.dxfFilename} 를 추가로 가져와 2D 선형을 확인합니다.`,
    "",
    "사이트 컨텍스트 그룹",
    "- PG_ADJACENT_PARCELS: 인접 지적 필지선",
    "- PG_ROAD_PARCELS_CADASTRAL: 연속지적도의 지목=도로 필지",
    "- PG_ROAD_BOUNDARY_UPIS: VWorld 도시계획 도로 경계",
    "- PG_ROAD_CENTERLINE_REFERENCE: 도로명·방향 참고 중심선",
    "- PG_FRONTAGE: 연속지적 도로가 확인된 대상 필지 접도선",
    "- PG_ROAD_WIDTH_SAMPLES: 연속지적 도로 폭 수직 샘플",
    "",
    "좌표",
    "- 단위: meter",
    "- 동쪽: +X",
    "- 북쪽: -Z",
    "- 위쪽: +Y",
    `- WGS84 원점: ${input.basePackage.planning.coordinateSystem.originLngLat.join(", ")}`,
    "",
    "주의",
    "- PG_PROPOSED_MASS만 검증된 설계 시작 기준 매스입니다.",
    "- PG_ROAD_BOUNDARY_UPIS는 도시계획 도로 도형이며 현황 포장·차도·보도 경계나 측량 성과도를 대체하지 않습니다.",
    "- 도로 폭 최소/평균/최대값은 연속지적도 도로 필지가 확인된 경우에만 수직 샘플로 계산합니다.",
    "- 인허가와 실시설계 전에는 건축사 및 측량 성과도로 경계를 재확인해야 합니다.",
    "",
  ].join("\n");
}

export function buildSketchupSiteExport(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: Parameters<typeof buildCadastralLineworkPackage>[0]["sourceParcels"];
}): SketchupSiteExportResult {
  if (!input.basePackage.validation.exportable) {
    throw new Error(
      input.basePackage.validation.blockingReasons[0] ??
        "계획 매스 Geometry Contract를 통과하지 못했습니다."
    );
  }

  const siteHash = stableHash({
    version: SKETCHUP_SITE_EXPORT_VERSION,
    planning: input.basePackage.planningGeometryHash,
    context: input.basePackage.contextGeometryHash,
    cadastral: input.cadastral.cadastralHash,
  });
  const modelExport = buildSketchupDaeExport(input.basePackage);
  const lineworkExport = buildCadastralLineworkPackage({
    snapshot: input.cadastral,
    targetBoundary: input.targetBoundary,
    sourceParcels: input.sourceParcels,
  });
  const base = safeFilename(
    `PARCELGRID-${input.basePackage.projectId}-${input.basePackage.planning.scenarioName}-${siteHash}`
  );
  const modelDaeFilename = `${base}-model.dae`;
  const siteDaeFilename = `${base}-site-context.dae`;
  const metadataFilename = `${base}-metadata.json`;
  const readmeFilename = "README-SKETCHUP-SITE-KO.txt";
  const siteDaeText = buildSiteContextDae({
    basePackage: input.basePackage,
    cadastral: input.cadastral,
    siteHash,
  });
  const metadataText = `${JSON.stringify(
    {
      exportVersion: SKETCHUP_SITE_EXPORT_VERSION,
      siteHash,
      generatedAt: input.basePackage.generatedAt,
      hashes: {
        planning: input.basePackage.planningGeometryHash,
        context: input.basePackage.contextGeometryHash,
        cadastral: input.cadastral.cadastralHash,
        basePackage: input.basePackage.exportPackageHash,
      },
      coordinateSystem: input.basePackage.planning.coordinateSystem,
      planningValidation: input.basePackage.planning.validation,
      contextSummary: input.basePackage.context.summary,
      cadastralSummary: input.cadastral.summary,
      cadastralValidation: input.cadastral.validation,
      roadBoundaries: input.cadastral.roadParcels.map((parcel) => ({
        id: parcel.pnu,
        label: parcel.jibun,
        source:
          parcel.jimokCode === "UPIS-UQ151"
            ? "VWorld LT_C_UPISUQ151"
            : "VWorld LP_PA_CBND_BUBUN",
        measuredAreaSqm: parcel.measuredAreaSqm,
        distanceM: parcel.distanceM,
      })),
      frontages: input.cadastral.frontages,
    },
    null,
    2
  )}\n`;
  const readmeText = buildReadme({
    siteHash,
    basePackage: input.basePackage,
    cadastral: input.cadastral,
    modelDaeFilename,
    siteDaeFilename,
    dxfFilename: lineworkExport.dxfFilename,
  });
  const encoder = new TextEncoder();
  const zipBytes = createStoredZip([
    { name: modelDaeFilename, bytes: encoder.encode(modelExport.daeText) },
    { name: siteDaeFilename, bytes: encoder.encode(siteDaeText) },
    { name: lineworkExport.dxfFilename, bytes: encoder.encode(lineworkExport.dxfText) },
    {
      name: lineworkExport.geojsonFilename,
      bytes: encoder.encode(lineworkExport.geojsonText),
    },
    { name: metadataFilename, bytes: encoder.encode(metadataText) },
    { name: readmeFilename, bytes: encoder.encode(readmeText) },
  ]);

  return {
    filename: `${base}.zip`,
    modelDaeFilename,
    siteDaeFilename,
    dxfFilename: lineworkExport.dxfFilename,
    geojsonFilename: lineworkExport.geojsonFilename,
    metadataFilename,
    readmeFilename,
    siteDaeText,
    metadataText,
    readmeText,
    zipBytes,
  };
}

export function downloadSketchupSiteExport(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: Parameters<typeof buildCadastralLineworkPackage>[0]["sourceParcels"];
}): SketchupSiteExportResult {
  const result = buildSketchupSiteExport(input);
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
