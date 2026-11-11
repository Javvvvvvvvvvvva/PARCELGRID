import { openingOnEdge, planRectangle, sharedPlanEdge, type PlanPoint } from "./layout-geometry";

export interface PathSpace { id: string; center: PlanPoint; widthM: number; depthM: number; rotationDeg: number }
export interface PathDoor { from: string; to: string; center: PlanPoint; widthM: number }
export function pathSpaceShape(space: PathSpace) {
  return planRectangle(space.center, space.widthM, space.depthM, space.rotationDeg);
}
export function pathDoorSegment(spaces: PathSpace[], door: PathDoor, wallM: number) {
  const a = spaces.find(s => s.id === door.from), b = spaces.find(s => s.id === door.to);
  return a && b && a.id !== b.id
    ? openingOnEdge(sharedPlanEdge(pathSpaceShape(a), pathSpaceShape(b)), door.center, door.widthM, wallM / 2) : null;
}
export function connectPathSpaces(spaces: PathSpace[], allowed: (a: PathSpace, b: PathSpace) => boolean, widthM: number, wallM: number): PathDoor[] {
  const doors: PathDoor[] = [];
  for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) {
    const a = spaces[i], b = spaces[j];
    if (!allowed(a, b)) continue;
    const edge = sharedPlanEdge(pathSpaceShape(a), pathSpaceShape(b));
    if (!edge) continue;
    const center = { x: (edge[0].x + edge[1].x) / 2, z: (edge[0].z + edge[1].z) / 2 };
    if (openingOnEdge(edge, center, widthM, wallM / 2)) doors.push({ from: a.id, to: b.id, center, widthM });
  }
  return doors;
}
/** A centreline candidate inside convex spaces, not a shortest-path or legal travel-distance determination. */
export function traceSpacePath(input: {
  spaces: PathSpace[]; doors: PathDoor[]; startId: string; targetId: string;
  transitIds: Set<string>; wallM: number; minimumDoorWidthM: number;
}): PlanPoint[] | null {
  const byId = new Map(input.spaces.map(s => [s.id, s]));
  if (!byId.has(input.startId) || !byId.has(input.targetId)) return null;
  const queue = [input.startId], previous = new Map<string, { id: string; door: PlanPoint } | null>([[input.startId, null]]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === input.targetId) break;
    for (const door of input.doors) {
      const next = door.from === current ? door.to : door.to === current ? door.from : null;
      if (!next || previous.has(next) || !input.transitIds.has(next) ||
          door.widthM + 1e-5 < input.minimumDoorWidthM || !pathDoorSegment(input.spaces, door, input.wallM)) continue;
      previous.set(next, { id: current, door: door.center }); queue.push(next);
    }
  }
  if (!previous.has(input.targetId)) return null;
  const reversed = [byId.get(input.targetId)!.center];
  let current = input.targetId;
  while (previous.get(current)) {
    const prev = previous.get(current)!;
    reversed.push(prev.door, byId.get(prev.id)!.center); current = prev.id;
  }
  return reversed.reverse();
}
export function pathLength(points: PlanPoint[]): number {
  return points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
}
