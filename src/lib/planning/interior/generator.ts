import { z } from "zod";
import type { LocalPlanPoint } from "../planning-massing";
import { connectAdjacentSpaces, polygonContains, rotatePoint, validateInteriorLayout } from "./geometry";
import { INTERIOR_VERSION, type InteriorGenerationInput, type InteriorGenerationResult, type InteriorLayout, type InteriorSpace } from "./types";

const inputSchema = z.object({
  outline: z.array(z.object({ x: z.number().finite().min(-1e6).max(1e6), z: z.number().finite().min(-1e6).max(1e6) })).min(3).max(500),
  count: z.number().int().min(1).max(12),
  circulationWidthM: z.number().finite().min(0.5).max(10), coreDepthM: z.number().finite().min(1).max(15),
  minRoomWidthM: z.number().finite().min(0.5).max(30), minRoomAreaSqm: z.number().finite().min(1).max(1000),
  wallThicknessM: z.number().finite().min(0).max(0.6),
});

interface Rect { x: number; z: number; width: number; depth: number }
function rectPoints(r: Rect): LocalPlanPoint[] {
  return [{ x: r.x, z: r.z }, { x: r.x + r.width, z: r.z }, { x: r.x + r.width, z: r.z + r.depth }, { x: r.x, z: r.z + r.depth }];
}

/** Independently implemented bounded grid/strip search; no research-model code or weights. */
function interiorRectangle(outline: LocalPlanPoint[]): Rect | null {
  const minX = Math.min(...outline.map(p => p.x)), maxX = Math.max(...outline.map(p => p.x));
  const minZ = Math.min(...outline.map(p => p.z)), maxZ = Math.max(...outline.map(p => p.z));
  const bounds = { x: minX, z: minZ, width: maxX - minX, depth: maxZ - minZ };
  if (bounds.width <= 0 || bounds.depth <= 0) return null;
  if (polygonContains(outline, rectPoints(bounds))) return bounds;
  const n = 16, dx = bounds.width / n, dz = bounds.depth / n;
  const cells = Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => polygonContains(outline, rectPoints({ x: minX + col * dx, z: minZ + row * dz, width: dx, depth: dz }))));
  let best: Rect | null = null;
  for (let top = 0; top < n; top++) {
    const columns = Array<boolean>(n).fill(true);
    for (let bottom = top; bottom < n; bottom++) {
      let start = 0;
      for (let col = 0; col <= n; col++) {
        if (col < n) columns[col] = columns[col] && cells[bottom][col];
        if (col === n || !columns[col]) {
          const rect = { x: minX + start * dx, z: minZ + top * dz, width: (col - start) * dx, depth: (bottom - top + 1) * dz };
          if (rect.width > 0 && (!best || rect.width * rect.depth > best.width * best.depth)) best = rect;
          start = col + 1;
        }
      }
    }
  }
  return best;
}

export function generateInteriorCandidates(raw: InteriorGenerationInput): InteriorGenerationResult {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid-input", candidates: [], message: "공간 수와 폭·면적·외곽 좌표의 입력 범위를 확인하세요." };
  const input = parsed.data;
  const candidates: InteriorGenerationResult["candidates"] = [];
  let longest = 0, angle = 0;
  for (let i = 0; i < input.outline.length; i++) {
    const a = input.outline[i], b = input.outline[(i + 1) % input.outline.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length > longest) { longest = length; angle = Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI; }
  }
  try {
    for (const rotation of [angle, angle + 90].map(v => ((v + 180) % 360 + 360) % 360 - 180)) {
      const rect = interiorRectangle(input.outline.map(p => rotatePoint(p, -rotation)));
      if (!rect || rect.depth <= input.coreDepthM + 1 || rect.width <= input.circulationWidthM + input.minRoomWidthM) continue;
      for (const mode of ["left", "right", "middle"] as const) {
        if (mode === "middle" && input.count < 2) continue;
        const bandX = mode === "left" ? rect.x : mode === "right" ? rect.x + rect.width - input.circulationWidthM : rect.x + (rect.width - input.circulationWidthM) / 2;
        const spaces: InteriorSpace[] = [];
        const add = (id: string, kind: InteriorSpace["kind"], r: Rect, label: string) => spaces.push({
          id, kind, label, center: rotatePoint({ x: r.x + r.width / 2, z: r.z + r.depth / 2 }, rotation),
          widthM: r.width, depthM: r.depth, rotationDeg: rotation, locked: kind === "core",
          minWidthM: kind === "unit" ? input.minRoomWidthM : 0,
          minAreaSqm: kind === "unit" ? input.minRoomAreaSqm : 0,
          unitCount: kind === "unit" ? 1 : 0, revenueModel: kind === "unit" ? "sale" : "non-revenue",
        });
        add("core", "core", { x: bandX, z: rect.z, width: input.circulationWidthM, depth: input.coreDepthM }, "코어 예비공간");
        add("corridor", "corridor", { x: bandX, z: rect.z + input.coreDepthM, width: input.circulationWidthM, depth: rect.depth - input.coreDepthM }, "공용 복도");
        const strips = mode === "middle"
          ? [{ x: rect.x, width: bandX - rect.x, count: Math.ceil(input.count / 2) }, { x: bandX + input.circulationWidthM, width: rect.x + rect.width - bandX - input.circulationWidthM, count: Math.floor(input.count / 2) }]
          : [{ x: mode === "left" ? bandX + input.circulationWidthM : rect.x, width: rect.width - input.circulationWidthM, count: input.count }];
        let index = 0;
        for (const strip of strips) for (let i = 0; i < strip.count; i++) {
          index++;
          add(`unit-${index}`, "unit", { x: strip.x, z: rect.z + i * rect.depth / strip.count, width: strip.width, depth: rect.depth / strip.count }, `주거 세대 ${index}`);
        }
        const layout: InteriorLayout = connectAdjacentSpaces({ version: INTERIOR_VERSION, sourceOutline: input.outline.map(p => ({ ...p })), wallThicknessM: input.wallThicknessM, spaces, doors: [], relations: [], generator: "parcelgrid-strip-v1", stage: "concept" });
        const assessment = validateInteriorLayout(layout, input.outline);
        if (!assessment.valid) continue;
        const label = `${mode === "middle" ? "중앙" : mode === "left" ? "좌측" : "우측"} 동선 · ${Math.round(rotation)}°`;
        const score = assessment.saleableAreaSqm / assessment.floorAreaSqm;
        candidates.push({ label, layout, score });
      }
    }
  } catch { return { status: "invalid-input", candidates: [], message: "외곽 다각형을 처리하지 못했습니다. 경계 중첩·잘못된 좌표를 확인하세요." }; }
  candidates.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return candidates.length
    ? { status: "candidates", candidates, message: `${candidates.length}개 예비 구획을 찾았습니다. 코어·문·복도는 건축 검토가 필요합니다.` }
    : { status: "no-template-fit", candidates: [], message: "현재 템플릿에서 조건에 맞는 구획을 찾지 못했습니다. 건축 불가능 판정이 아닙니다. 공간 수·최소 폭·면적을 조정하거나 직접 편집하세요." };
}
