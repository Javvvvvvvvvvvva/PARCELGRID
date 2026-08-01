import type { PlanningGeometrySnapshot } from "./planning-geometry";
import type { PlanningExternalGeometryFormat } from "./types";

export const EXTERNAL_GEOMETRY_VERIFICATION_VERSION =
  "external-geometry-verification-v1" as const;

const COORDINATE_TOLERANCE_M = 0.0005;
const ORIGIN_TOLERANCE_DEG = 0.000000001;

export interface ExternalGeometryVerificationIssue {
  code: string;
  message: string;
}

export interface ExternalGeometryVerificationResult {
  version: typeof EXTERNAL_GEOMETRY_VERIFICATION_VERSION;
  status: "pass" | "fail";
  format: PlanningExternalGeometryFormat;
  primaryFileName: string;
  companionFileNames: string[];
  totalSizeBytes: number;
  sourceFileSha256: string | null;
  embeddedGeometryHash: string | null;
  expectedFloorCount: number;
  matchedFloorCount: number;
  issues: ExternalGeometryVerificationIssue[];
}

export interface ExternalGeometryUploadFile {
  name: string;
  size: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
}

function addIssue(
  issues: ExternalGeometryVerificationIssue[],
  code: string,
  message: string
): void {
  issues.push({ code, message });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
}

function openRing<T extends { x: number; z: number }>(points: T[]): T[] {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  return Math.abs(first.x - last.x) <= COORDINATE_TOLERANCE_M &&
    Math.abs(first.z - last.z) <= COORDINATE_TOLERANCE_M
    ? points.slice(0, -1)
    : points;
}

function point3Matches(first: Point3, second: Point3): boolean {
  return (
    Math.abs(first.x - second.x) <= COORDINATE_TOLERANCE_M &&
    Math.abs(first.y - second.y) <= COORDINATE_TOLERANCE_M &&
    Math.abs(first.z - second.z) <= COORDINATE_TOLERANCE_M
  );
}

function uniquePoints(points: Point3[]): Point3[] {
  const result: Point3[] = [];
  for (const point of points) {
    if (!result.some((candidate) => point3Matches(candidate, point))) {
      result.push(point);
    }
  }
  return result;
}

function expectedFloorVertices(
  floor: PlanningGeometrySnapshot["building"]["floors"][number]
): Point3[] {
  return uniquePoints(
    openRing(floor.shape).flatMap((point) => [
      { x: point.x, y: floor.baseHeightM, z: point.z },
      { x: point.x, y: floor.topHeightM, z: point.z },
    ])
  );
}

function vertexSetsMatch(actualInput: Point3[], expectedInput: Point3[]): boolean {
  const actual = uniquePoints(actualInput);
  const expected = uniquePoints(expectedInput);
  return (
    actual.length === expected.length &&
    expected.every((point) =>
      actual.some((candidate) => point3Matches(candidate, point))
    )
  );
}

function tagValue(text: string, tag: string): string | null {
  const escaped = escapeRegExp(tag);
  const match = text.match(
    new RegExp("<" + escaped + "(?:\\s[^>]*)?>([^<]+)</" + escaped + ">", "i")
  );
  return match?.[1]?.trim() ?? null;
}

function readNumbers(value: string): number[] {
  return value
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);
}

function originMatches(
  lng: number | null,
  lat: number | null,
  expected: PlanningGeometrySnapshot
): boolean {
  if (lng == null || lat == null) return false;
  return (
    Math.abs(lng - expected.coordinateSystem.originLngLat[0]) <=
      ORIGIN_TOLERANCE_DEG &&
    Math.abs(lat - expected.coordinateSystem.originLngLat[1]) <=
      ORIGIN_TOLERANCE_DEG
  );
}

function finalResult(input: {
  format: PlanningExternalGeometryFormat;
  primaryFileName: string;
  companionFileNames?: string[];
  totalSizeBytes?: number;
  sourceFileSha256?: string | null;
  embeddedGeometryHash: string | null;
  expectedFloorCount: number;
  matchedFloorCount: number;
  issues: ExternalGeometryVerificationIssue[];
}): ExternalGeometryVerificationResult {
  return {
    version: EXTERNAL_GEOMETRY_VERIFICATION_VERSION,
    status: input.issues.length === 0 ? "pass" : "fail",
    format: input.format,
    primaryFileName: input.primaryFileName,
    companionFileNames: input.companionFileNames ?? [],
    totalSizeBytes: input.totalSizeBytes ?? 0,
    sourceFileSha256: input.sourceFileSha256 ?? null,
    embeddedGeometryHash: input.embeddedGeometryHash,
    expectedFloorCount: input.expectedFloorCount,
    matchedFloorCount: input.matchedFloorCount,
    issues: input.issues,
  };
}

export function verifyDaeGeometryText(
  daeText: string,
  expected: PlanningGeometrySnapshot,
  primaryFileName = "model.dae"
): ExternalGeometryVerificationResult {
  const issues: ExternalGeometryVerificationIssue[] = [];
  if (!/<COLLADA\b/i.test(daeText)) {
    addIssue(issues, "dae-invalid", "COLLADA DAE 문서가 아닙니다.");
  }

  const planningHash = tagValue(daeText, "planning_hash");
  if (!planningHash) {
    addIssue(
      issues,
      "dae-planning-hash-missing",
      "DAE에 PARCELGRID planning_hash가 없습니다."
    );
  } else if (planningHash !== expected.geometryHash) {
    addIssue(
      issues,
      "dae-planning-hash-mismatch",
      "DAE의 Geometry Hash가 현재 계획안과 다릅니다."
    );
  }

  const unitMatch = daeText.match(/<unit\b[^>]*\bmeter=["']([^"']+)["']/i);
  const unitScale = unitMatch ? Number(unitMatch[1]) : Number.NaN;
  if (!Number.isFinite(unitScale) || Math.abs(unitScale - 1) > 1e-9) {
    addIssue(issues, "dae-unit", "DAE 단위가 meter(1.0)가 아닙니다.");
  }
  if (tagValue(daeText, "north_axis") !== "-Z") {
    addIssue(
      issues,
      "dae-north-axis",
      "DAE 정북축이 PARCELGRID 기준 -Z가 아닙니다."
    );
  }
  if (tagValue(daeText, "east_axis") !== "+X") {
    addIssue(
      issues,
      "dae-east-axis",
      "DAE 동쪽축이 PARCELGRID 기준 +X가 아닙니다."
    );
  }

  const lngValue = tagValue(daeText, "origin_lng");
  const latValue = tagValue(daeText, "origin_lat");
  if (
    !originMatches(
      lngValue == null ? null : Number(lngValue),
      latValue == null ? null : Number(latValue),
      expected
    )
  ) {
    addIssue(
      issues,
      "dae-origin",
      "DAE의 WGS84 로컬 원점이 현재 대상 필지와 다릅니다."
    );
  }

  const geometryIds = Array.from(
    daeText.matchAll(
      /<geometry\b[^>]*\bid=["']PG_PROPOSED_MASS-([^"']+)-geometry["']/gi
    ),
    (match) => match[1]
  );
  if (geometryIds.length !== expected.building.floors.length) {
    addIssue(
      issues,
      "dae-floor-count",
      "DAE 계획 매스 " +
        geometryIds.length +
        "개와 현재 계획 층 " +
        expected.building.floors.length +
        "개가 다릅니다."
    );
  }

  let matchedFloorCount = 0;
  for (const floor of expected.building.floors) {
    const floorId = escapeRegExp(floor.id);
    const geometryMatch = daeText.match(
      new RegExp(
        "<geometry\\b[^>]*\\bid=[\"']PG_PROPOSED_MASS-" +
          floorId +
          "-geometry[\"'][^>]*>([\\s\\S]*?)</geometry>",
        "i"
      )
    );
    if (!geometryMatch) {
      addIssue(
        issues,
        "dae-floor-missing",
        floor.label + "의 PG_PROPOSED_MASS 형상을 찾을 수 없습니다."
      );
      continue;
    }
    const positionsMatch = geometryMatch[1].match(
      new RegExp(
        "<float_array\\b[^>]*\\bid=[\"']PG_PROPOSED_MASS-" +
          floorId +
          "-positions-array[\"'][^>]*>([\\s\\S]*?)</float_array>",
        "i"
      )
    );
    const values = positionsMatch ? readNumbers(positionsMatch[1]) : [];
    if (values.length === 0 || values.length % 3 !== 0) {
      addIssue(
        issues,
        "dae-floor-positions",
        floor.label + "의 3D 좌표 배열이 유효하지 않습니다."
      );
      continue;
    }
    const actual: Point3[] = [];
    for (let index = 0; index < values.length; index += 3) {
      actual.push({
        x: values[index],
        y: values[index + 1],
        z: values[index + 2],
      });
    }
    if (!vertexSetsMatch(actual, expectedFloorVertices(floor))) {
      addIssue(
        issues,
        "dae-floor-geometry-mismatch",
        floor.label + "의 외곽선 또는 층 높이가 현재 계획 매스와 다릅니다."
      );
      continue;
    }
    matchedFloorCount += 1;
  }

  return finalResult({
    format: "dae",
    primaryFileName,
    embeddedGeometryHash: planningHash,
    expectedFloorCount: expected.building.floors.length,
    matchedFloorCount,
    issues,
  });
}

interface DxfPolyline {
  layer: string;
  points: Array<{ x: number; z: number }>;
  closed: boolean;
}

function parseDxfPolylines(text: string): DxfPolyline[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const pairs: Array<{ code: number; value: string }> = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    if (Number.isFinite(code)) {
      pairs.push({ code, value: lines[index + 1].trim() });
    }
  }

  const polylines: DxfPolyline[] = [];
  for (let index = 0; index < pairs.length; index += 1) {
    if (pairs[index].code !== 0 || pairs[index].value !== "LWPOLYLINE") continue;
    const entity: DxfPolyline = { layer: "", points: [], closed: false };
    let pendingX: number | null = null;
    index += 1;
    for (; index < pairs.length && pairs[index].code !== 0; index += 1) {
      const pair = pairs[index];
      if (pair.code === 8) entity.layer = pair.value;
      if (pair.code === 70) entity.closed = (Number(pair.value) & 1) === 1;
      if (pair.code === 10) pendingX = Number(pair.value);
      if (pair.code === 20 && pendingX != null) {
        entity.points.push({ x: pendingX, z: -Number(pair.value) });
        pendingX = null;
      }
    }
    index -= 1;
    if (entity.layer && entity.points.length >= 2) polylines.push(entity);
  }
  return polylines;
}

function ringMatches(
  actualInput: Array<{ x: number; z: number }>,
  expectedInput: Array<{ x: number; z: number }>
): boolean {
  const actual = openRing(actualInput);
  const expected = openRing(expectedInput);
  if (actual.length !== expected.length || actual.length === 0) return false;
  const matches = (
    first: { x: number; z: number },
    second: { x: number; z: number }
  ) =>
    Math.abs(first.x - second.x) <= COORDINATE_TOLERANCE_M &&
    Math.abs(first.z - second.z) <= COORDINATE_TOLERANCE_M;

  return actual.some((candidate, startIndex) => {
    if (!matches(expected[0], candidate)) return false;
    return [1, -1].some((direction) =>
      expected.every((point, index) => {
        const actualIndex =
          (startIndex + direction * index + actual.length * 2) % actual.length;
        return matches(point, actual[actualIndex]);
      })
    );
  });
}

function dxfFloorLayer(level: number): string {
  const suffix = Math.abs(level).toString().padStart(2, "0");
  return level < 0
    ? "PG_PROPOSED_MASS_B" + suffix
    : "PG_PROPOSED_MASS_F" + suffix;
}

interface CadMetadata {
  planningGeometryHash?: string;
  coordinateSystem?: {
    unit?: string;
    eastAxis?: string;
    northAxis?: string;
    originLngLat?: [number, number];
  };
}

export function verifyDxfGeometryText(
  dxfText: string,
  metadataText: string | null,
  expected: PlanningGeometrySnapshot,
  primaryFileName = "model.dxf",
  metadataFileName = "metadata.json"
): ExternalGeometryVerificationResult {
  const issues: ExternalGeometryVerificationIssue[] = [];
  let metadata: CadMetadata | null = null;
  if (!metadataText) {
    addIssue(
      issues,
      "dxf-metadata-missing",
      "DXF는 층 높이와 원점을 확인할 수 있도록 같은 패키지의 metadata.json이 필요합니다."
    );
  } else {
    try {
      metadata = JSON.parse(metadataText) as CadMetadata;
    } catch {
      addIssue(
        issues,
        "dxf-metadata-invalid",
        "CAD metadata.json을 읽을 수 없습니다."
      );
    }
  }

  const planningHash = metadata?.planningGeometryHash ?? null;
  if (planningHash !== expected.geometryHash) {
    addIssue(
      issues,
      "dxf-planning-hash",
      planningHash
        ? "CAD metadata의 Geometry Hash가 현재 계획안과 다릅니다."
        : "CAD metadata에 planningGeometryHash가 없습니다."
    );
  }
  const coordinateSystem = metadata?.coordinateSystem;
  if (
    coordinateSystem?.unit !== "meter" ||
    coordinateSystem.eastAxis !== "+X" ||
    coordinateSystem.northAxis !== "+Y"
  ) {
    addIssue(
      issues,
      "dxf-coordinate-system",
      "CAD 좌표계가 meter · 동쪽 +X · 북쪽 +Y 기준이 아닙니다."
    );
  }
  const origin = coordinateSystem?.originLngLat;
  if (
    !originMatches(
      Array.isArray(origin) ? Number(origin[0]) : null,
      Array.isArray(origin) ? Number(origin[1]) : null,
      expected
    )
  ) {
    addIssue(
      issues,
      "dxf-origin",
      "CAD metadata의 WGS84 로컬 원점이 현재 대상 필지와 다릅니다."
    );
  }

  const unitPair = /\$INSUNITS\s*\n\s*70\s*\n\s*6(?:\s|$)/.test(
    dxfText.replace(/\r/g, "")
  );
  if (!unitPair) {
    addIssue(issues, "dxf-unit", "DXF의 $INSUNITS가 meter(6)가 아닙니다.");
  }

  const polylines = parseDxfPolylines(dxfText);
  let matchedFloorCount = 0;
  for (const floor of expected.building.floors) {
    const layer = dxfFloorLayer(floor.level);
    const candidates = polylines.filter((polyline) => polyline.layer === layer);
    if (
      !candidates.some(
        (polyline) =>
          polyline.closed && ringMatches(polyline.points, floor.shape)
      )
    ) {
      addIssue(
        issues,
        "dxf-floor-geometry-mismatch",
        layer + " 외곽선이 현재 " + floor.label + " 계획 형상과 다릅니다."
      );
      continue;
    }
    matchedFloorCount += 1;
  }

  return finalResult({
    format: "dxf",
    primaryFileName,
    companionFileNames: metadataText ? [metadataFileName] : [],
    embeddedGeometryHash: planningHash,
    expectedFloorCount: expected.building.floors.length,
    matchedFloorCount,
    issues,
  });
}

interface GlbJson {
  asset?: {
    extras?: {
      PARCELGRID?: Record<string, unknown>;
      parcelgrid?: Record<string, unknown>;
    };
  };
  nodes?: Array<{ name?: string }>;
}

function parseGlbJson(buffer: ArrayBuffer): GlbJson | null {
  if (buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) > buffer.byteLength
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.byteLength) return null;
    if (type === 0x4e4f534a) {
      const text = new TextDecoder()
        .decode(buffer.slice(start, end))
        .replace(/[\u0000\s]+$/g, "");
      return JSON.parse(text) as GlbJson;
    }
    offset = end;
  }
  return null;
}

export function verifyGlbGeometryBuffer(
  buffer: ArrayBuffer,
  expected: PlanningGeometrySnapshot,
  primaryFileName = "model.glb"
): ExternalGeometryVerificationResult {
  const issues: ExternalGeometryVerificationIssue[] = [];
  let json: GlbJson | null = null;
  try {
    json = parseGlbJson(buffer);
  } catch {
    json = null;
  }
  if (!json) {
    addIssue(issues, "glb-invalid", "GLB 2.0 파일을 읽을 수 없습니다.");
    return finalResult({
      format: "glb",
      primaryFileName,
      embeddedGeometryHash: null,
      expectedFloorCount: expected.building.floors.length,
      matchedFloorCount: 0,
      issues,
    });
  }

  const extras =
    json.asset?.extras?.PARCELGRID ??
    json.asset?.extras?.parcelgrid ??
    null;
  const planningHash =
    typeof extras?.planningGeometryHash === "string"
      ? extras.planningGeometryHash
      : null;
  if (planningHash !== expected.geometryHash) {
    addIssue(
      issues,
      "glb-planning-hash",
      planningHash
        ? "GLB의 Geometry Hash가 현재 계획안과 다릅니다."
        : "GLB asset.extras에 PARCELGRID planningGeometryHash가 없습니다."
    );
  }

  const coordinateSystem = extras?.coordinateSystem as
    | {
        unit?: string;
        eastAxis?: string;
        northAxis?: string;
        originLngLat?: [number, number];
      }
    | undefined;
  if (
    coordinateSystem?.unit !== "meter" ||
    coordinateSystem.eastAxis !== "+X" ||
    coordinateSystem.northAxis !== "-Z"
  ) {
    addIssue(
      issues,
      "glb-coordinate-system",
      "GLB 좌표계가 meter · 동쪽 +X · 정북 -Z 기준이 아닙니다."
    );
  }
  const origin = coordinateSystem?.originLngLat;
  if (
    !originMatches(
      Array.isArray(origin) ? Number(origin[0]) : null,
      Array.isArray(origin) ? Number(origin[1]) : null,
      expected
    )
  ) {
    addIssue(
      issues,
      "glb-origin",
      "GLB의 WGS84 로컬 원점이 현재 대상 필지와 다릅니다."
    );
  }

  const floorSignatures = Array.isArray(extras?.floors)
    ? (extras?.floors as Array<{
        id?: string;
        baseHeightM?: number;
        topHeightM?: number;
        shape?: Array<{ x?: number; z?: number }>;
      }>)
    : [];
  let matchedFloorCount = 0;
  for (const floor of expected.building.floors) {
    const signature = floorSignatures.find((item) => item.id === floor.id);
    const shape = (signature?.shape ?? []).map((point) => ({
      x: Number(point.x),
      z: Number(point.z),
    }));
    const nodeExists = (json.nodes ?? []).some((node) =>
      node.name?.includes("PG_PROPOSED_MASS-" + floor.id)
    );
    if (
      !signature ||
      !nodeExists ||
      Math.abs(Number(signature.baseHeightM) - floor.baseHeightM) >
        COORDINATE_TOLERANCE_M ||
      Math.abs(Number(signature.topHeightM) - floor.topHeightM) >
        COORDINATE_TOLERANCE_M ||
      !ringMatches(shape, floor.shape)
    ) {
      addIssue(
        issues,
        "glb-floor-signature",
        floor.label +
          "의 PG_PROPOSED_MASS 노드와 외곽선·높이 서명이 현재 계획과 다릅니다."
      );
      continue;
    }
    matchedFloorCount += 1;
  }

  return finalResult({
    format: "glb",
    primaryFileName,
    embeddedGeometryHash: planningHash,
    expectedFloorCount: expected.building.floors.length,
    matchedFloorCount,
    issues,
  });
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function verifyExternalGeometryFiles(
  files: ExternalGeometryUploadFile[],
  expected: PlanningGeometrySnapshot
): Promise<ExternalGeometryVerificationResult> {
  const modelFiles = files.filter((file) =>
    /\.(dae|glb|dxf)$/i.test(file.name)
  );
  if (modelFiles.length !== 1) {
    const fallback = modelFiles[0] ?? files[0];
    return finalResult({
      format: fallback?.name.toLowerCase().endsWith(".dxf")
        ? "dxf"
        : fallback?.name.toLowerCase().endsWith(".glb")
          ? "glb"
          : "dae",
      primaryFileName: fallback?.name ?? "선택 파일 없음",
      companionFileNames: files
        .filter((file) => file !== fallback)
        .map((file) => file.name),
      totalSizeBytes: files.reduce((sum, file) => sum + file.size, 0),
      embeddedGeometryHash: null,
      expectedFloorCount: expected.building.floors.length,
      matchedFloorCount: 0,
      issues: [
        {
          code: "model-file-count",
          message:
            modelFiles.length === 0
              ? "DAE·GLB·DXF 중 하나의 모델 파일을 선택하세요."
              : "한 번에 하나의 모델 파일만 연결할 수 있습니다.",
        },
      ],
    });
  }

  const model = modelFiles[0];
  const lowerName = model.name.toLowerCase();
  const buffer = await model.arrayBuffer();
  let result: ExternalGeometryVerificationResult;
  if (lowerName.endsWith(".dae")) {
    result = verifyDaeGeometryText(
      new TextDecoder().decode(buffer),
      expected,
      model.name
    );
  } else if (lowerName.endsWith(".dxf")) {
    const metadata = files.find(
      (file) =>
        file !== model &&
        file.name.toLowerCase().endsWith(".json") &&
        /metadata/i.test(file.name)
    );
    result = verifyDxfGeometryText(
      new TextDecoder().decode(buffer),
      metadata ? await metadata.text() : null,
      expected,
      model.name,
      metadata?.name ?? "metadata.json"
    );
  } else {
    result = verifyGlbGeometryBuffer(buffer, expected, model.name);
  }

  const checksum = await sha256Hex(buffer);
  const checksumIssues = [...result.issues];
  if (!checksum) {
    addIssue(
      checksumIssues,
      "checksum-unavailable",
      "브라우저에서 SHA-256 원본 파일 지문을 만들 수 없습니다."
    );
  }
  return {
    ...result,
    status: checksumIssues.length === 0 ? "pass" : "fail",
    companionFileNames: files
      .filter((file) => file !== model)
      .map((file) => file.name),
    totalSizeBytes: files.reduce((sum, file) => sum + file.size, 0),
    sourceFileSha256: checksum,
    issues: checksumIssues,
  };
}
