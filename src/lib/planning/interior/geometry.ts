import { featureCollection, intersect, kinks, polygon } from "@turf/turf";
import type { Polygon, MultiPolygon } from "geojson";
import { polygonAreaSqm, type LocalPlanPoint } from "../planning-massing";
import { interiorLayoutSchema, type InteriorLayout, type InteriorSpace, type InteriorAssessment, type InteriorIssue } from "./types";

const EPS = 1e-5;
export function rotatePoint(p: LocalPlanPoint, deg: number): LocalPlanPoint {
  const angle = deg * Math.PI / 180;
  return { x: p.x * Math.cos(angle) - p.z * Math.sin(angle), z: p.x * Math.sin(angle) + p.z * Math.cos(angle) };
}

/** Rectangles represent partition centre lines; clear faces use half the assumed wall thickness. */
export function spacePolygon(space: InteriorSpace, insetM = 0): LocalPlanPoint[] {
  const w = Math.max(0, space.widthM / 2 - insetM);
  const d = Math.max(0, space.depthM / 2 - insetM);
  return [{ x: -w, z: -d }, { x: w, z: -d }, { x: w, z: d }, { x: -w, z: d }].map(p => {
    const r = rotatePoint(p, space.rotationDeg);
    return { x: space.center.x + r.x, z: space.center.z + r.z };
  });
}

export function clearSpaceArea(space: InteriorSpace, wallM: number): number {
  return Math.max(0, space.widthM - wallM) * Math.max(0, space.depthM - wallM);
}

export function outlineKey(points: LocalPlanPoint[]): string {
  return JSON.stringify(points.map(p => [Number(p.x.toFixed(5)), Number(p.z.toFixed(5))]));
}

function turfPolygon(points: LocalPlanPoint[]) {
  const ring = points.map(p => [p.x, p.z]);
  return polygon([[...ring, [...ring[0]]]]);
}

function metricArea(geometry: Polygon | MultiPolygon): number {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polys.reduce((sum, rings) => sum + rings.reduce((area, ring, i) => area + (i === 0 ? 1 : -1) * polygonAreaSqm(ring.map(([x, z]) => ({ x, z }))), 0), 0);
}

export function intersectionArea(a: LocalPlanPoint[], b: LocalPlanPoint[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const result = intersect(featureCollection([turfPolygon(a), turfPolygon(b)]));
  return result ? metricArea(result.geometry) : 0;
}

export function polygonContains(container: LocalPlanPoint[], child: LocalPlanPoint[]): boolean {
  const area = polygonAreaSqm(child);
  return area > EPS && Math.abs(intersectionArea(container, child) - area) < Math.max(EPS, area * 1e-7);
}

function distance(a: LocalPlanPoint, b: LocalPlanPoint) { return Math.hypot(a.x - b.x, a.z - b.z); }

/** Shared segment, not just a touching vertex. Used for real doorway adjacency. */
export function sharedEdge(a: LocalPlanPoint[], b: LocalPlanPoint[]): [LocalPlanPoint, LocalPlanPoint] | null {
  let best: [LocalPlanPoint, LocalPlanPoint] | null = null;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    const len = distance(p, q);
    if (len < EPS) continue;
    const ux = (q.x - p.x) / len, uz = (q.z - p.z) / len;
    for (let j = 0; j < b.length; j++) {
      const r = b[j], s = b[(j + 1) % b.length];
      if (Math.abs((r.x - p.x) * uz - (r.z - p.z) * ux) > EPS || Math.abs((s.x - p.x) * uz - (s.z - p.z) * ux) > EPS) continue;
      const t1 = (r.x - p.x) * ux + (r.z - p.z) * uz;
      const t2 = (s.x - p.x) * ux + (s.z - p.z) * uz;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
      if (hi - lo > EPS && (!best || hi - lo > distance(...best))) best = [{ x: p.x + ux * lo, z: p.z + uz * lo }, { x: p.x + ux * hi, z: p.z + uz * hi }];
    }
  }
  return best;
}

export function doorSegment(layout: InteriorLayout, door: InteriorLayout["doors"][number]): [LocalPlanPoint, LocalPlanPoint] | null {
  const a = layout.spaces.find(s => s.id === door.from), b = layout.spaces.find(s => s.id === door.to);
  if (!a || !b || a.id === b.id) return null;
  const edge = sharedEdge(spacePolygon(a), spacePolygon(b));
  if (!edge) return null;
  const len = distance(...edge), ux = (edge[1].x - edge[0].x) / len, uz = (edge[1].z - edge[0].z) / len;
  const t = (door.center.x - edge[0].x) * ux + (door.center.z - edge[0].z) * uz;
  const perpendicular = Math.abs((door.center.x - edge[0].x) * uz - (door.center.z - edge[0].z) * ux);
  if (perpendicular > EPS || t - door.widthM / 2 < -EPS || t + door.widthM / 2 > len + EPS) return null;
  return [{ x: door.center.x - ux * door.widthM / 2, z: door.center.z - uz * door.widthM / 2 }, { x: door.center.x + ux * door.widthM / 2, z: door.center.z + uz * door.widthM / 2 }];
}

export function connectAdjacentSpaces(layout: InteriorLayout): InteriorLayout {
  const common = layout.spaces.filter(s => s.kind === "core" || s.kind === "corridor");
  const commonIds = new Set(common.map(s => s.id));
  const doors = layout.doors.filter(d => !commonIds.has(d.from) && !commonIds.has(d.to));
  for (const space of layout.spaces) for (const target of common) {
    if (space.id === target.id || doors.some(d => d.from === target.id && d.to === space.id)) continue;
    const edge = sharedEdge(spacePolygon(space), spacePolygon(target));
    if (!edge || distance(...edge) < 1) continue;
    let id = `door-common-${doors.length}`;
    while (doors.some(d => d.id === id)) id += "x";
    doors.push({ id, from: space.id, to: target.id, center: { x: (edge[0].x + edge[1].x) / 2, z: (edge[0].z + edge[1].z) / 2 }, widthM: Math.min(0.9, distance(...edge) - 0.1) });
  }
  return { ...layout, doors: doors.slice(0, 128) };
}

export function connectSpaces(layout: InteriorLayout, from: string, to: string, widthM = 0.9): InteriorLayout {
  const a = layout.spaces.find(s => s.id === from), b = layout.spaces.find(s => s.id === to);
  if (!a || !b || a.id === b.id || !Number.isFinite(widthM) || widthM < 0.1 || widthM > 5) throw new Error("문의 연결 공간과 폭을 확인하세요.");
  const edge = sharedEdge(spacePolygon(a), spacePolygon(b));
  if (!edge || distance(...edge) < widthM + 0.1) throw new Error("문을 배치할 충분한 공유 경계가 없습니다.");
  const doors = layout.doors.filter(d => !((d.from === from && d.to === to) || (d.from === to && d.to === from)));
  if (doors.length >= 128) throw new Error("문은 층당 128개까지 배치할 수 있습니다.");
  let id = `door-manual-${doors.length}`;
  while (doors.some(d => d.id === id)) id += "x";
  return { ...layout, doors: [...doors, { id, from, to, center: { x: (edge[0].x + edge[1].x) / 2, z: (edge[0].z + edge[1].z) / 2 }, widthM }] };
}

export function validateInteriorLayout(raw: unknown, outline: LocalPlanPoint[]): InteriorAssessment {
  const issues: InteriorIssue[] = [];
  const area = polygonAreaSqm(outline);
  const result: InteriorAssessment = { valid: false, issues, floorAreaSqm: Number.isFinite(area) ? area : 0, assignedAreaSqm: 0, clearAreaSqm: 0, saleableAreaSqm: 0, rentableAreaSqm: 0, remainingAreaSqm: 0, connectedSpaceIds: [] };
  const parsed = interiorLayoutSchema.safeParse(raw);
  if (!parsed.success) { issues.push({ code: "schema", severity: "fail", message: "내부 평면 데이터 형식·숫자 범위가 올바르지 않습니다." }); return result; }
  const layout = parsed.data;
  try {
    if (outline.length < 3 || outline.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z)) || result.floorAreaSqm <= EPS || kinks(turfPolygon(outline)).features.length) throw new Error("invalid outline");
    if (outlineKey(layout.sourceOutline) !== outlineKey(outline)) issues.push({ code: "stale-outline", severity: "fail", message: "층 외곽이 변경됐습니다. 현재 외곽에서 평면을 다시 검토·연결하세요." });
    const ids = new Set<string>();
    const cores = layout.spaces.filter(s => s.kind === "core");
    if (!cores.length) issues.push({ code: "core-missing", severity: "fail", message: "연결 기준이 될 코어 공간이 필요합니다." });
    const shapes = layout.spaces.map(space => spacePolygon(space));
    layout.spaces.forEach((space, i) => {
      const clear = clearSpaceArea(space, layout.wallThicknessM);
      result.assignedAreaSqm += space.widthM * space.depthM;
      result.clearAreaSqm += clear;
      if (space.revenueModel === "sale") result.saleableAreaSqm += clear;
      if (space.revenueModel === "lease") result.rentableAreaSqm += clear;
      if (ids.has(space.id)) issues.push({ code: "duplicate-id", severity: "fail", spaceId: space.id, message: "중복된 공간 ID가 있습니다." });
      ids.add(space.id);
      if (!polygonContains(outline, shapes[i])) issues.push({ code: "outside", severity: "fail", spaceId: space.id, message: `${space.label}: 층 외곽을 벗어납니다.` });
      if (clear <= EPS || Math.min(space.widthM, space.depthM) - layout.wallThicknessM + EPS < space.minWidthM || clear + EPS < space.minAreaSqm) issues.push({ code: "minimum", severity: "fail", spaceId: space.id, message: `${space.label}: 입력한 최소 폭·면적 또는 유효한 내부 공간을 충족하지 못합니다.` });
      if ((space.kind === "core" || space.kind === "corridor") && (space.revenueModel !== "non-revenue" || space.unitCount !== 0)) issues.push({ code: "common-revenue", severity: "fail", spaceId: space.id, message: `${space.label}: 공용 동선은 수익 면적·세대수로 계산할 수 없습니다.` });
      for (let j = 0; j < i; j++) if (intersectionArea(shapes[i], shapes[j]) > EPS) issues.push({ code: "overlap", severity: "fail", spaceId: space.id, message: `${space.label}과 ${layout.spaces[j].label}이 겹칩니다.` });
    });
    const graph = new Map(layout.spaces.map(s => [s.id, new Set<string>()]));
    const doorIds = new Set<string>();
    for (const door of layout.doors) {
      if (doorIds.has(door.id) || !doorSegment(layout, door)) { issues.push({ code: "door", severity: "fail", message: "문의 연결 공간·위치·폭을 확인하세요. 문은 공유 경계 위에 있어야 합니다." }); continue; }
      doorIds.add(door.id);
      graph.get(door.from)?.add(door.to); graph.get(door.to)?.add(door.from);
    }
    const connected = new Set(cores.map(s => s.id));
    const queue = [...connected];
    while (queue.length) for (const id of graph.get(queue.shift()!) ?? []) if (!connected.has(id)) { connected.add(id); queue.push(id); }
    result.connectedSpaceIds = [...connected];
    for (const space of layout.spaces) if (!connected.has(space.id)) issues.push({ code: "disconnected", severity: "fail", spaceId: space.id, message: `${space.label}: 문을 통한 코어 연결이 없습니다.` });
    for (const relation of layout.relations) {
      const a = layout.spaces.findIndex(s => s.id === relation.from), b = layout.spaces.findIndex(s => s.id === relation.to);
      if (a < 0 || b < 0 || a === b) { issues.push({ code: "relation", severity: "fail", message: "공간 관계가 존재하지 않거나 같은 공간을 참조합니다." }); continue; }
      const adjacent = !!sharedEdge(shapes[a], shapes[b]);
      if (adjacent !== (relation.kind === "adjacent")) issues.push({ code: "preference", severity: "review", message: `${layout.spaces[a].label} · ${layout.spaces[b].label}: ${relation.kind === "adjacent" ? "인접" : "분리"} 선호가 충족되지 않았습니다.` });
    }
  } catch { issues.push({ code: "geometry", severity: "fail", message: "유효하지 않은 다각형으로 공간 검증을 완료하지 못했습니다." }); }
  result.remainingAreaSqm = Math.max(0, result.floorAreaSqm - result.assignedAreaSqm);
  result.valid = !issues.some(i => i.severity === "fail");
  return result;
}
