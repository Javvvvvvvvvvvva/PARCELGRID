import type {
  CadastralContextSnapshot,
  CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import { cadastralFrontageIdentity, cadastralTargetPolygonsMatch, cadastralTargetTopologyScope, validateCadastralTarget, validateCadastralFrontageIdentities } from "@/lib/geo/cadastral-context";
import { localParcelPolygons, sourceParcelPolygons, type LocalParcelPolygon, type Wgs84ParcelPolygon } from "@/lib/geo/parcel-topology";
import { openParcelRing, validateLocalParcelTopology } from "@/lib/geo/parcel-topology-geometry";
import { parcelProjectionOrigin, projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { planningRingToLocalMeters } from "@/lib/planning/planning-geometry";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export const CADASTRAL_LINEWORK_EXPORT_VERSION =
  "cadastral-linework-export-v2" as const;

export function parcelExportProvenance(
  parcel: Pick<CadastralParcelFeature, "boundarySource">
) {
  const boundarySource = parcel.boundarySource ?? "continuous-cadastral";
  return {
    boundarySource,
    source: boundarySource === "upis-planned-road"
      ? "VWorld LT_C_UPISUQ151"
      : "VWorld LP_PA_CBND_BUBUN",
  };
}

const EXPORT_COORDINATE_TOLERANCE_M = 0.000001;

export function createContextExportDeadline(): () => void {
  const deadline = performance.now() + 2_000;
  return () => {
    if (performance.now() >= deadline) {
      throw new DOMException("Context export validation time limit exceeded.", "TimeoutError");
    }
  };
}

function ringsMatch(first: LocalPlanPoint[], second: LocalPlanPoint[], checkDeadline: () => void): boolean {
  checkDeadline();
  const a = openParcelRing(first);
  const b = openParcelRing(second);
  if (a.length !== b.length || a.length < 3) return false;
  const matches = (p: LocalPlanPoint, q: LocalPlanPoint) =>
    Math.abs(p.x - q.x) <= EXPORT_COORDINATE_TOLERANCE_M &&
    Math.abs(p.z - q.z) <= EXPORT_COORDINATE_TOLERANCE_M;
  return b.some((point, start) => matches(a[0], point) && [1, -1].some((direction) =>
    a.every((value, index) => matches(value, b[(start + direction * index + b.length) % b.length]))
  ));
}

function unorderedMatch<T>(first: T[], second: T[], matches: (a: T, b: T) => boolean, checkDeadline: () => void): boolean {
  if (first.length !== second.length) return false;
  const remaining = [...second];
  return first.every((item) => {
    checkDeadline();
    const index = remaining.findIndex((candidate) => matches(item, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

function sourceLocalPolygons(polygons: Wgs84ParcelPolygon[], origin: [number, number]): LocalParcelPolygon[] {
  try {
    return polygons.map((part) => ({
      outer: planningRingToLocalMeters(part.outer, origin),
      holes: part.holes.map((ring) => planningRingToLocalMeters(ring, origin)),
    }));
  } catch {
    throw new Error("Export source topology is malformed.");
  }
}

export function assertCadastralExportSnapshot(
  snapshot: CadastralContextSnapshot,
  checkDeadline = createContextExportDeadline()
): void {
  checkDeadline();
  if (!snapshot.validation.usable || snapshot.validation.status === "fail" ||
    snapshot.validation.issues.some((issue) => issue.severity === "fail")) {
    throw new Error("Cadastral context validation failed; unvalidated diagnostic exports are not supported.");
  }
  if (!validateCadastralTarget(snapshot.targetParcel, checkDeadline)) {
    throw new Error("Export target snapshot topology is invalid.");
  }
  const pnus = new Set([snapshot.targetParcel.pnu]);
  for (const parcel of [...snapshot.adjacentParcels, ...snapshot.roadParcels]) {
    checkDeadline();
    if (!parcel.pnu || pnus.has(parcel.pnu) || !validateLocalParcelTopology(localParcelPolygons(parcel), checkDeadline)) {
      throw new Error(`Export snapshot parcel ${parcel.pnu} is invalid or duplicated.`);
    }
    pnus.add(parcel.pnu);
  }
  if (!validateCadastralFrontageIdentities(snapshot, checkDeadline)) {
    throw new Error("Export frontage identities do not match the validated snapshot.");
  }
  checkDeadline();
}

function bindCadastralExportSources(input: {
  snapshot: CadastralContextSnapshot;
  targetBoundary?: [number, number][];
  targetBoundaryPolygons?: Wgs84ParcelPolygon[];
  sourceParcels: CadastralParcelFeature[];
}) {
  const { snapshot } = input;
  const checkDeadline = createContextExportDeadline();
  assertCadastralExportSnapshot(snapshot, checkDeadline);
  const origin = snapshot.coordinateSystem.originLngLat;
  const targetSource = sourceParcelPolygons({ boundary: input.targetBoundary ?? [], polygons: input.targetBoundaryPolygons });
  parcelProjectionOrigin(targetSource);
  const target = projectParcelPolygons(targetSource, origin);
  if (!validateLocalParcelTopology(target, checkDeadline) || !cadastralTargetPolygonsMatch(target, localParcelPolygons(snapshot.targetParcel), checkDeadline)) {
    throw new Error("Export target boundary does not match the validated snapshot.");
  }
  const remaining = new Map([...snapshot.adjacentParcels, ...snapshot.roadParcels].map((parcel) => [parcel.pnu, parcel]));
  const bound = [];
  for (const source of input.sourceParcels) {
    checkDeadline();
    // The engine excludes target records; the separately bound targetBoundary is authoritative.
    if (source.pnu === snapshot.targetParcel.pnu) continue;
    const parcel = remaining.get(source.pnu);
    if (!parcel) throw new Error(`Export source parcel ${source.pnu} is absent from the snapshot or duplicated.`);
    const polygons = sourceParcelPolygons(source);
    const local = sourceLocalPolygons(polygons, origin);
    if (!validateLocalParcelTopology(local, checkDeadline) || !unorderedMatch(local, localParcelPolygons(parcel), (a, b) =>
      ringsMatch(a.outer, b.outer, checkDeadline) &&
        unorderedMatch(a.holes, b.holes, (aRing, bRing) => ringsMatch(aRing, bRing, checkDeadline), checkDeadline),
      checkDeadline
    )) {
      throw new Error(`Export source topology for ${source.pnu} does not match the validated snapshot.`);
    }
    if (parcelExportProvenance(source).boundarySource !== parcelExportProvenance(parcel).boundarySource) {
      throw new Error(`Export source provenance for ${source.pnu} does not match the validated snapshot.`);
    }
    bound.push({ parcel, polygons });
    remaining.delete(source.pnu);
  }
  checkDeadline();
  if (remaining.size) throw new Error("Export source parcels are missing validated snapshot neighbors.");
  return { boundParcels: bound, targetSource };
}

interface ExportFile {
  name: string;
  bytes: Uint8Array;
}

export interface CadastralLineworkExportResult {
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
  return normalized || "parcelgrid-cadastral";
}

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

export function cadastralDxfIdentity(identity: Record<string, unknown>): string {
  const value = JSON.stringify(identity);
  let output = dxfPair(1001, "PARCELGRID");
  for (let index = 0; index < value.length; index += 250) output += dxfPair(1000, value.slice(index, index + 250));
  return output;
}

export function cadastralDxfAppIdTable(): string {
  return dxfPair(0, "TABLE") + dxfPair(2, "APPID") + dxfPair(70, 1)
    + dxfPair(0, "APPID") + dxfPair(2, "PARCELGRID") + dxfPair(70, 0) + dxfPair(0, "ENDTAB");
}

function dxfPolyline(
  layer: string,
  points: LocalPlanPoint[],
  closed: boolean
): string {
  if (points.length < 2) return "";
  let output = "";
  output += dxfPair(0, "LWPOLYLINE");
  output += dxfPair(8, layer);
  output += dxfPair(90, points.length);
  output += dxfPair(70, closed ? 1 : 0);
  for (const point of points) {
    output += dxfPair(10, point.x.toFixed(6));
    output += dxfPair(20, (-point.z).toFixed(6));
  }
  return output;
}

function dxfLayers(snapshot: CadastralContextSnapshot): string[] {
  const layers = [
    "PG_SITE_BOUNDARY",
    "PG_SITE_BOUNDARY_HOLES",
    "PG_ADJACENT_PARCELS",
    "PG_ADJACENT_PARCELS_HOLES",
    "PG_ROAD_PARCELS",
    "PG_ROAD_PARCELS_HOLES",
    "PG_ROAD_BOUNDARY_UPIS",
    "PG_ROAD_BOUNDARY_UPIS_HOLES",
    "PG_FRONTAGE",
    "PG_ROAD_WIDTH_SAMPLES",
  ];
  if (snapshot.roadParcels.length === 0) {
    return layers.filter((layer) => !layer.startsWith("PG_ROAD_PARCELS") && !layer.startsWith("PG_ROAD_BOUNDARY_UPIS"));
  }
  return layers;
}

export function buildCadastralDxf(snapshot: CadastralContextSnapshot): string {
  assertCadastralExportSnapshot(snapshot);
  const layers = dxfLayers(snapshot);
  let tables = dxfPair(0, "SECTION") + dxfPair(2, "TABLES");
  tables +=
    dxfPair(0, "TABLE") +
    dxfPair(2, "LAYER") +
    dxfPair(70, layers.length);
  for (const layer of layers) {
    tables += dxfPair(0, "LAYER");
    tables += dxfPair(2, layer);
    tables += dxfPair(70, 0);
    tables += dxfPair(
      62,
      layer.startsWith("PG_ROAD_PARCELS") || layer.startsWith("PG_ROAD_BOUNDARY_UPIS")
        ? 8
        : layer === "PG_FRONTAGE"
          ? 5
          : 7
    );
    tables += dxfPair(6, "CONTINUOUS");
  }
  tables += dxfPair(0, "ENDTAB") + cadastralDxfAppIdTable() + dxfPair(0, "ENDSEC");

  let entities = dxfPair(0, "SECTION") + dxfPair(2, "ENTITIES");
  for (const [polygonIndex, polygon] of localParcelPolygons(snapshot.targetParcel).entries()) {
    entities += dxfPolyline("PG_SITE_BOUNDARY", polygon.outer, true);
    entities += cadastralDxfIdentity({ pnu: snapshot.targetParcel.pnu, polygonIndex, ringIndex: 0 });
    for (const [holeIndex, hole] of polygon.holes.entries()) {
      entities += dxfPolyline("PG_SITE_BOUNDARY_HOLES", hole, true);
      entities += cadastralDxfIdentity({ pnu: snapshot.targetParcel.pnu, polygonIndex, ringIndex: holeIndex + 1 });
    }
  }
  for (const parcel of snapshot.adjacentParcels) {
    for (const polygon of localParcelPolygons(parcel)) {
      entities += dxfPolyline("PG_ADJACENT_PARCELS", polygon.outer, true);
      for (const hole of polygon.holes) {
        entities += dxfPolyline("PG_ADJACENT_PARCELS_HOLES", hole, true);
      }
    }
  }
  for (const parcel of snapshot.roadParcels) {
    const layer = parcelExportProvenance(parcel).boundarySource === "upis-planned-road"
      ? "PG_ROAD_BOUNDARY_UPIS" : "PG_ROAD_PARCELS";
    for (const polygon of localParcelPolygons(parcel)) {
      entities += dxfPolyline(layer, polygon.outer, true);
      for (const hole of polygon.holes) {
        entities += dxfPolyline(`${layer}_HOLES`, hole, true);
      }
    }
  }
  for (const frontage of snapshot.frontages) {
    entities += dxfPolyline("PG_FRONTAGE", frontage.frontage, false);
    entities += cadastralDxfIdentity(cadastralFrontageIdentity(frontage));
    for (const sample of frontage.widthSamples) {
      entities += dxfPolyline(
        "PG_ROAD_WIDTH_SAMPLES",
        [sample.from, sample.to],
        false
      );
      entities += cadastralDxfIdentity(cadastralFrontageIdentity(frontage));
    }
  }
  entities += dxfPair(0, "ENDSEC");

  const header =
    dxfPair(0, "SECTION") +
    dxfPair(2, "HEADER") +
    dxfPair(9, "$ACADVER") +
    dxfPair(1, "AC1015") +
    dxfPair(9, "$INSUNITS") +
    dxfPair(70, 6) +
    dxfPair(0, "ENDSEC");

  return `${header}${tables}${entities}${dxfPair(0, "EOF")}`;
}

function localToLngLat(
  point: LocalPlanPoint,
  origin: [number, number]
): [number, number] {
  const [originLng, originLat] = origin;
  const lngScale = 111_000 * Math.cos((originLat * Math.PI) / 180);
  return [
    originLng + point.x / lngScale,
    originLat - point.z / 111_000,
  ];
}

function closeLngLatRing(ring: [number, number][], hole = false): [number, number][] {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, first];
  const area = closed.slice(0, -1).reduce((sum, point, index) => {
    const next = closed[index + 1];
    return sum + (point[0] - first[0]) * (next[1] - first[1]) -
      (next[0] - first[0]) * (point[1] - first[1]);
  }, 0);
  return (area < 0) === hole ? closed : [...closed].reverse();
}

export function buildCadastralGeoJson(input: {
  snapshot: CadastralContextSnapshot;
  targetBoundary?: [number, number][];
  targetBoundaryPolygons?: Wgs84ParcelPolygon[];
  sourceParcels: CadastralParcelFeature[];
}): string {
  const { snapshot } = input;
  const { boundParcels, targetSource } = bindCadastralExportSources(input);
  const origin = snapshot.coordinateSystem.originLngLat;
  const roadPnus = new Set(
    snapshot.roadParcels.map((parcel) => parcel.pnu)
  );
  const features: Array<Record<string, unknown>> = [];

  {
    const coordinates = targetSource.map(part => [closeLngLatRing(part.outer), ...part.holes.map(hole => closeLngLatRing(hole, true))]);
    features.push({
      type: "Feature",
      properties: {
        layer: "PG_SITE_BOUNDARY",
        pnu: snapshot.targetParcel.pnu,
        source: "target-boundary-input",
        topologyScope: cadastralTargetTopologyScope(snapshot.targetParcel),
        measuredAreaSqm: snapshot.targetParcel.measuredAreaSqm,
        identityScope: "snapshot-ring-order",
      },
      geometry: coordinates.length === 1
        ? { type: "Polygon", coordinates: coordinates[0] }
        : { type: "MultiPolygon", coordinates },
    });
  }

  for (const { parcel, polygons } of boundParcels) {
    const provenance = parcelExportProvenance(parcel);
    const coordinates = polygons.map((part) => [
      closeLngLatRing(part.outer),
      ...part.holes.map((hole) => closeLngLatRing(hole, true)),
    ]);
    features.push({
      type: "Feature",
      properties: {
        layer: provenance.boundarySource === "upis-planned-road"
          ? "PG_ROAD_BOUNDARY_UPIS"
          : roadPnus.has(parcel.pnu) ? "PG_ROAD_PARCELS"
          : "PG_ADJACENT_PARCELS",
        pnu: parcel.pnu,
        jibun: parcel.jibun,
        jimok: parcel.jimok,
        jimokCode: parcel.jimokCode,
        lotAreaSqm: parcel.officialAreaSqm,
        measuredAreaSqm: parcel.measuredAreaSqm,
        distanceM: parcel.distanceM,
        ...provenance,
      },
      geometry: coordinates.length === 1
        ? { type: "Polygon", coordinates: coordinates[0] }
        : { type: "MultiPolygon", coordinates },
    });
  }

  for (const frontage of snapshot.frontages) {
    features.push({
      type: "Feature",
      properties: {
        layer: "PG_FRONTAGE",
        ...cadastralFrontageIdentity(frontage),
        identityScope: "snapshot-ring-order",
        frontageLengthM: frontage.frontageLengthM,
        widthMinM: frontage.widthMinM,
        widthAvgM: frontage.widthAvgM,
        widthMaxM: frontage.widthMaxM,
        status: frontage.status,
      },
      geometry: {
        type: "LineString",
        coordinates: frontage.frontage.map((point) =>
          localToLngLat(point, origin)
        ),
      },
    });
    for (const sample of frontage.widthSamples) {
      features.push({
        type: "Feature",
        properties: {
          layer: "PG_ROAD_WIDTH_SAMPLES",
          ...cadastralFrontageIdentity(frontage),
          identityScope: "snapshot-ring-order",
          positionRatio: sample.positionRatio,
          gapM: sample.gapM,
          widthM: sample.widthM,
        },
        geometry: {
          type: "LineString",
          coordinates: [sample.from, sample.to].map((point) =>
            localToLngLat(point, origin)
          ),
        },
      });
    }
  }

  return JSON.stringify(
    {
      type: "FeatureCollection",
      name: `PARCELGRID_${snapshot.cadastralHash}`,
      sourceBinding: "validated-snapshot",
      crsNote: "RFC 7946 WGS84 longitude/latitude",
      features,
    },
    null,
    2
  );
}

function buildMetadata(snapshot: CadastralContextSnapshot) {
  return {
    exportVersion: CADASTRAL_LINEWORK_EXPORT_VERSION,
    cadastralVersion: snapshot.version,
    projectId: snapshot.projectId,
    generatedAt: snapshot.generatedAt,
    cadastralHash: snapshot.cadastralHash,
    sourceBinding: "validated-snapshot",
    topologyScope: { target: cadastralTargetTopologyScope(snapshot.targetParcel), neighbors: "all-components-and-holes" },
    targetParcel: snapshot.targetParcel,
    frontageIdentityScope: "snapshot-ring-order",
    coordinateSystem: {
      dxf: {
        unit: "meter",
        eastAxis: "+X",
        northAxis: "+Y",
        relationToDae: "DXF Y = - DAE Z",
        originLngLat: snapshot.coordinateSystem.originLngLat,
      },
      geojson: {
        crs: "WGS84 longitude/latitude",
      },
    },
    summary: snapshot.summary,
    frontages: snapshot.frontages,
    validation: snapshot.validation,
    sourceNotes: snapshot.sourceNotes,
    disclaimers: [
      "PG_ROAD_PARCELS와 도로 폭은 연속지적도의 지목=도로 필지에서 파생한 지적상 정보입니다. PG_ROAD_BOUNDARY_UPIS는 도시계획 도로 참고 경계입니다.",
      "현황 포장·차도·보도 폭과 다를 수 있으며 현황측량·경계측량을 대체하지 않습니다.",
      "건축 인허가 및 실시설계 전에는 건축사와 측량 성과도로 재확인해야 합니다.",
    ],
  };
}

function buildReadme(snapshot: CadastralContextSnapshot): string {
  return [
    "PARCELGRID Cadastral & Road Linework Package",
    "============================================",
    `Cadastral hash: ${snapshot.cadastralHash}`,
    `Project: ${snapshot.projectId}`,
    "",
    "파일",
    "- cadastral-road-linework.dxf: SketchUp/AutoCAD용 로컬 미터 선형",
    "- cadastral-source.geojson: 출처가 구분된 WGS84 경계와 파생 폭 샘플",
    "- cadastral-metadata.json: 출처·해시·폭 계산·검증 경고",
    "",
    "DXF 좌표",
    "- 단위: meter",
    "- 동쪽: +X",
    "- 북쪽: +Y",
    "- DAE 모델과의 관계: DXF Y = - DAE Z",
    `- WGS84 원점: ${snapshot.coordinateSystem.originLngLat.join(", ")}`,
    "",
    "레이어",
    "- PG_SITE_BOUNDARY: 대상 필지 경계",
    "- PG_ADJACENT_PARCELS: 인접 필지 경계",
    "- PG_ROAD_PARCELS: 지목이 도로인 지적 필지",
    "- PG_ROAD_BOUNDARY_UPIS: UPIS 도시계획 도로 참고 경계",
    "- *_HOLES: 대상·인접 필지·도로의 내부 제외 경계",
    "- PG_FRONTAGE: 대상 필지의 접도 경계",
    "- PG_ROAD_WIDTH_SAMPLES: 도로 필지 반대편까지 수직 폭 샘플",
    "",
    "주의",
    "- 원본 경계·출처가 검증된 snapshot과 일치할 때만 내보냅니다. 유효하지 않거나 누락된 필지의 진단용 export는 지원하지 않습니다.",
    "- 대상·인접 필지·도로는 모든 분리 도형과 내부 홀을 보존합니다. 접도 식별자는 snapshot의 조각·링·변 순서를 기준으로 합니다.",
    "- 계산된 폭은 지적상 도로 폭입니다.",
    "- 실제 포장·차도·보도·경계석 폭과 다를 수 있습니다.",
    "- 이 파일은 측량 성과도나 법적 경계확정 자료를 대체하지 않습니다.",
    "",
    "검증 경고",
    ...(snapshot.validation.issues.length > 0
      ? snapshot.validation.issues.map((issue) => `- ${issue.message}`)
      : ["- 없음"]),
    "",
  ].join("\n");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
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

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function buildZip(files: ExportFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(name.length),
      u16(0),
      name,
      file.bytes,
    ]);
    locals.push(local);
    const central = concatBytes([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const localBytes = concatBytes(locals);
  const centralBytes = concatBytes(centrals);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.length),
    u32(localBytes.length),
    u16(0),
  ]);
  return concatBytes([localBytes, centralBytes, end]);
}

export function buildCadastralLineworkPackage(input: {
  snapshot: CadastralContextSnapshot;
  targetBoundary?: [number, number][];
  targetBoundaryPolygons?: Wgs84ParcelPolygon[];
  sourceParcels: CadastralParcelFeature[];
}): CadastralLineworkExportResult {
  const base = safeFilename(
    `PARCELGRID-${input.snapshot.projectId}-${input.snapshot.cadastralHash}`
  );
  const dxfFilename = `${base}-cadastral-road-linework.dxf`;
  const geojsonFilename = `${base}-cadastral-source.geojson`;
  const metadataFilename = `${base}-cadastral-metadata.json`;
  const readmeFilename = "README-CADASTRAL-KO.txt";
  const geojsonText = buildCadastralGeoJson(input);
  const dxfText = buildCadastralDxf(input.snapshot);
  const metadataText = JSON.stringify(
    buildMetadata(input.snapshot),
    null,
    2
  );
  const readmeText = buildReadme(input.snapshot);
  const encoder = new TextEncoder();
  const zipBytes = buildZip([
    { name: dxfFilename, bytes: encoder.encode(dxfText) },
    { name: geojsonFilename, bytes: encoder.encode(geojsonText) },
    { name: metadataFilename, bytes: encoder.encode(metadataText) },
    { name: readmeFilename, bytes: encoder.encode(readmeText) },
  ]);
  return {
    filename: `${base}.zip`,
    dxfFilename,
    geojsonFilename,
    metadataFilename,
    readmeFilename,
    dxfText,
    geojsonText,
    metadataText,
    readmeText,
    zipBytes,
  };
}

export function downloadCadastralLineworkPackage(input: {
  snapshot: CadastralContextSnapshot;
  targetBoundary?: [number, number][];
  targetBoundaryPolygons?: Wgs84ParcelPolygon[];
  sourceParcels: CadastralParcelFeature[];
}): CadastralLineworkExportResult {
  const result = buildCadastralLineworkPackage(input);
  if (typeof window !== "undefined") {
    const data = result.zipBytes.buffer.slice(
      result.zipBytes.byteOffset,
      result.zipBytes.byteOffset + result.zipBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([data], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
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
