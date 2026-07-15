import type {
  CadastralContextSnapshot,
  CadastralParcelFeature,
} from "@/lib/geo/cadastral-context";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export const CADASTRAL_LINEWORK_EXPORT_VERSION =
  "cadastral-linework-export-v1" as const;

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
    "PG_ADJACENT_PARCELS",
    "PG_ROAD_PARCELS",
    "PG_FRONTAGE",
    "PG_ROAD_WIDTH_SAMPLES",
  ];
  if (snapshot.roadParcels.length === 0) {
    return layers.filter((layer) => layer !== "PG_ROAD_PARCELS");
  }
  return layers;
}

export function buildCadastralDxf(snapshot: CadastralContextSnapshot): string {
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
      layer === "PG_ROAD_PARCELS"
        ? 8
        : layer === "PG_FRONTAGE"
          ? 5
          : 7
    );
    tables += dxfPair(6, "CONTINUOUS");
  }
  tables += dxfPair(0, "ENDTAB") + dxfPair(0, "ENDSEC");

  let entities = dxfPair(0, "SECTION") + dxfPair(2, "ENTITIES");
  entities += dxfPolyline(
    "PG_SITE_BOUNDARY",
    snapshot.targetParcel.polygon,
    true
  );
  for (const parcel of snapshot.adjacentParcels) {
    entities += dxfPolyline(
      "PG_ADJACENT_PARCELS",
      parcel.polygon,
      true
    );
  }
  for (const parcel of snapshot.roadParcels) {
    entities += dxfPolyline("PG_ROAD_PARCELS", parcel.polygon, true);
  }
  for (const frontage of snapshot.frontages) {
    entities += dxfPolyline("PG_FRONTAGE", frontage.frontage, false);
    for (const sample of frontage.widthSamples) {
      entities += dxfPolyline(
        "PG_ROAD_WIDTH_SAMPLES",
        [sample.from, sample.to],
        false
      );
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

function closeLngLatRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1]
    ? ring
    : [...ring, first];
}

export function buildCadastralGeoJson(input: {
  snapshot: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: CadastralParcelFeature[];
}): string {
  const { snapshot } = input;
  const origin = snapshot.coordinateSystem.originLngLat;
  const roadPnus = new Set(
    snapshot.roadParcels.map((parcel) => parcel.pnu)
  );
  const features: Array<Record<string, unknown>> = [];

  if (input.targetBoundary.length >= 3) {
    features.push({
      type: "Feature",
      properties: {
        layer: "PG_SITE_BOUNDARY",
        pnu: snapshot.targetParcel.pnu,
        source: "VWorld LP_PA_CBND_BUBUN",
      },
      geometry: {
        type: "Polygon",
        coordinates: [closeLngLatRing(input.targetBoundary)],
      },
    });
  }

  for (const parcel of input.sourceParcels) {
    if (parcel.boundary.length < 3) continue;
    features.push({
      type: "Feature",
      properties: {
        layer: roadPnus.has(parcel.pnu)
          ? "PG_ROAD_PARCELS"
          : "PG_ADJACENT_PARCELS",
        pnu: parcel.pnu,
        jibun: parcel.jibun,
        jimok: parcel.jimok,
        jimokCode: parcel.jimokCode,
        lotAreaSqm: parcel.lotAreaSqm,
        distanceM: parcel.distanceM,
        source: "VWorld LP_PA_CBND_BUBUN",
      },
      geometry: {
        type: "Polygon",
        coordinates: [closeLngLatRing(parcel.boundary)],
      },
    });
  }

  for (const frontage of snapshot.frontages) {
    features.push({
      type: "Feature",
      properties: {
        layer: "PG_FRONTAGE",
        roadParcelPnu: frontage.roadParcelPnu,
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
          roadParcelPnu: frontage.roadParcelPnu,
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
      "PG_ROAD_PARCELS와 도로 폭은 연속지적도의 지목=도로 필지에서 파생한 지적상 정보입니다.",
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
    "- cadastral-source.geojson: VWorld WGS84 원본 경계와 파생 폭 샘플",
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
    "- PG_FRONTAGE: 대상 필지의 접도 경계",
    "- PG_ROAD_WIDTH_SAMPLES: 도로 필지 반대편까지 수직 폭 샘플",
    "",
    "주의",
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
  targetBoundary: [number, number][];
  sourceParcels: CadastralParcelFeature[];
}): CadastralLineworkExportResult {
  const base = safeFilename(
    `PARCELGRID-${input.snapshot.projectId}-${input.snapshot.cadastralHash}`
  );
  const dxfFilename = `${base}-cadastral-road-linework.dxf`;
  const geojsonFilename = `${base}-cadastral-source.geojson`;
  const metadataFilename = `${base}-cadastral-metadata.json`;
  const readmeFilename = "README-CADASTRAL-KO.txt";
  const dxfText = buildCadastralDxf(input.snapshot);
  const geojsonText = buildCadastralGeoJson(input);
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
  targetBoundary: [number, number][];
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
