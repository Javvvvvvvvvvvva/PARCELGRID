interface Point { x: number; z: number }

export function ringAreaSqm(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  const origin = points[0];
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length];
    sum += (a.x - origin.x) * (b.z - origin.z) - (b.x - origin.x) * (a.z - origin.z);
  }
  return Math.abs(sum) / 2;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.z - a.z) * (c.x - b.x) - (b.x - a.x) * (c.z - b.z);
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  const epsilon = 1e-8;
  return Math.min(a.x, c.x) - epsilon <= b.x && b.x <= Math.max(a.x, c.x) + epsilon
    && Math.min(a.z, c.z) - epsilon <= b.z && b.z <= Math.max(a.z, c.z) + epsilon;
}

export function segmentsIntersect(p1: Point, q1: Point, p2: Point, q2: Point): boolean {
  const epsilon = 1e-8;
  const o1 = orientation(p1, q1, p2), o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1), o4 = orientation(p2, q2, q1);
  const opposite = (a: number, b: number) => (a > epsilon && b < -epsilon) || (a < -epsilon && b > epsilon);
  if (opposite(o1, o2) && opposite(o3, o4)) return true;
  if (Math.abs(o1) <= epsilon && onSegment(p1, p2, q1)) return true;
  if (Math.abs(o2) <= epsilon && onSegment(p1, q2, q1)) return true;
  if (Math.abs(o3) <= epsilon && onSegment(p2, p1, q2)) return true;
  return Math.abs(o4) <= epsilon && onSegment(p2, q1, q2);
}

export function polygonSelfIntersects(points: Point[], checkDeadline?: () => void): boolean {
  checkDeadline?.();
  if (points.length < 4) return false;
  let comparisons = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if ((i + 1) % points.length === j || i === (j + 1) % points.length) continue;
      if (++comparisons % 1024 === 0) checkDeadline?.();
      if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return true;
    }
  }
  return false;
}
