import type { PlanningGeometrySnapshot } from "../planning-geometry";
import { createStoredZip } from "../sketchup-dae-export";
import { doorSegment, spacePolygon, validateInteriorLayout } from "./geometry";
import type { InteriorLayout } from "./types";

export interface InteriorExportInput { planning: PlanningGeometrySnapshot; floorId: string; layout: InteriorLayout }
function pair(code: number, value: string | number) { return `${code}\n${value}\n`; }
/** R2000 text uses DXF Unicode escapes, including Korean labels; no record injection. */
function dxfText(value: string) {
  return value.split("").map(c => {
    const n = c.charCodeAt(0);
    return n > 126 || c === "\\" ? `\\U+${n.toString(16).padStart(4, "0").toUpperCase()}` : n < 32 ? " " : c;
  }).join("");
}
function linework(points: Array<{ x: number; z: number }>, layer: string, closed = true) {
  return pair(0, "LWPOLYLINE") + pair(100, "AcDbEntity") + pair(8, layer) + pair(100, "AcDbPolyline") + pair(90, points.length) + pair(70, closed ? 1 : 0) + points.map(p => pair(10, p.x.toFixed(6)) + pair(20, (-p.z).toFixed(6))).join("");
}

export function inspectInteriorExport(input: InteriorExportInput) {
  const floor = input.planning.building.floors.find(f => f.id === input.floorId);
  if (!floor) throw new Error("내보낼 층을 찾지 못했습니다.");
  const assessment = validateInteriorLayout(input.layout, floor.shape);
  if (!assessment.valid) throw new Error(assessment.issues.find(i => i.severity === "fail")?.message ?? "내부 평면 검증이 필요합니다.");
  if (!floor.interior || JSON.stringify(floor.interior.layout) !== JSON.stringify(input.layout)) throw new Error("화면과 저장된 계획의 내부 평면이 다릅니다. 저장 후 다시 내보내세요.");
  return { floor, assessment };
}

export function buildInteriorDxfPackage(input: InteriorExportInput) {
  const { floor, assessment } = inspectInteriorExport(input);
  const layers = ["PG_FLOOR_OUTLINE", "PG_SPACE_CENTERLINE", "PG_CLEAR_FACE", "PG_DOOR_OPENING", "PG_LABEL"];
  let dxf = pair(999, `PARCELGRID CONCEPT INTERIOR | ${input.planning.geometryHash}`);
  dxf += pair(0, "SECTION") + pair(2, "HEADER") + pair(9, "$ACADVER") + pair(1, "AC1015") + pair(9, "$INSUNITS") + pair(70, 6) + pair(9, "$MEASUREMENT") + pair(70, 1) + pair(0, "ENDSEC");
  dxf += pair(0, "SECTION") + pair(2, "TABLES") + pair(0, "TABLE") + pair(2, "LTYPE") + pair(5, "10") + pair(330, "0") + pair(100, "AcDbSymbolTable") + pair(70, 1);
  dxf += pair(0, "LTYPE") + pair(5, "12") + pair(330, "10") + pair(100, "AcDbSymbolTableRecord") + pair(100, "AcDbLinetypeTableRecord") + pair(2, "CONTINUOUS") + pair(70, 0) + pair(3, "Solid line") + pair(72, 65) + pair(73, 0) + pair(40, 0) + pair(0, "ENDTAB");
  dxf += pair(0, "TABLE") + pair(2, "LAYER") + pair(5, "11") + pair(330, "0") + pair(100, "AcDbSymbolTable") + pair(70, layers.length);
  for (const [i, layer] of layers.entries()) dxf += pair(0, "LAYER") + pair(5, (32 + i).toString(16).toUpperCase()) + pair(330, "11") + pair(100, "AcDbSymbolTableRecord") + pair(100, "AcDbLayerTableRecord") + pair(2, layer) + pair(70, 0) + pair(62, i + 1) + pair(6, "CONTINUOUS");
  dxf += pair(0, "ENDTAB") + pair(0, "ENDSEC") + pair(0, "SECTION") + pair(2, "ENTITIES");
  dxf += linework(floor.shape, "PG_FLOOR_OUTLINE");
  for (const space of input.layout.spaces) {
    dxf += linework(spacePolygon(space), "PG_SPACE_CENTERLINE");
    dxf += linework(spacePolygon(space, input.layout.wallThicknessM / 2), "PG_CLEAR_FACE");
    dxf += pair(0, "TEXT") + pair(100, "AcDbEntity") + pair(8, "PG_LABEL") + pair(100, "AcDbText") + pair(10, space.center.x.toFixed(6)) + pair(20, (-space.center.z).toFixed(6)) + pair(30, 0) + pair(40, 0.22) + pair(1, dxfText(space.label)) + pair(100, "AcDbText");
  }
  for (const door of input.layout.doors) {
    const segment = doorSegment(input.layout, door);
    if (segment) dxf += linework(segment, "PG_DOOR_OPENING", false);
  }
  dxf += pair(0, "ENDSEC") + pair(0, "EOF");
  const metadata = {
    documentType: "concept-interior-layout", stage: "concept", projectId: input.planning.projectId,
    scenarioId: input.planning.scenarioId, scenarioVersion: input.planning.scenarioVersion,
    geometryHash: input.planning.geometryHash, floorId: floor.id, level: floor.level,
    coordinateSystem: { unit: "meter", eastAxis: "+X", northAxis: "+Y", originLngLat: input.planning.coordinateSystem.originLngLat },
    areaBasis: "Space polygons are assumed partition centre lines; clear faces offset inward by half the assumed wall thickness. Not certified saleable area.",
    assessment, layout: input.layout,
  };
  const stem = `PARCELGRID-${input.planning.geometryHash}-${floor.level < 0 ? "B" : "F"}${Math.abs(floor.level)}-interior`;
  const metadataText = JSON.stringify(metadata, null, 2);
  const readme = "PARCELGRID 내부 구획 검토용\n\nDXF 단위: meter, X=동, Y=북. 원점은 metadata.json의 WGS84 원점입니다.\nPG_SPACE_CENTERLINE=구획 벽중심선 가정, PG_CLEAR_FACE=입력 벽두께로 추정한 내부 경계. 문 선은 개구 위치입니다.\n허가·실시설계 도면이 아니며 계단 상세·방화·접근성·구조·설비는 별도 검토가 필요합니다.\n한글은 DXF Unicode escape로 저장했습니다.\n";
  const encoder = new TextEncoder();
  return { filename: `${stem}.zip`, dxf, metadataText, bytes: createStoredZip([{ name: `${stem}.dxf`, bytes: encoder.encode(dxf) }, { name: "metadata.json", bytes: encoder.encode(metadataText) }, { name: "README.txt", bytes: encoder.encode(readme) }]) };
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
