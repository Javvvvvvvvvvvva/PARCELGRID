export interface PlanViewBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Converts pointer movement in the responsive SVG preview back to the
 * LOCAL_ENU planning coordinate system. Screen-right is +X and screen-down is
 * +Z, matching the placement preview projection.
 */
export function pointerDeltaToPlanMeters({
  deltaClientX,
  deltaClientY,
  viewportWidthPx,
  viewportHeightPx,
  bounds,
}: {
  deltaClientX: number;
  deltaClientY: number;
  viewportWidthPx: number;
  viewportHeightPx: number;
  bounds: PlanViewBounds;
}): { deltaXM: number; deltaZM: number } {
  if (
    !Number.isFinite(viewportWidthPx) ||
    !Number.isFinite(viewportHeightPx) ||
    viewportWidthPx <= 0 ||
    viewportHeightPx <= 0
  ) {
    return { deltaXM: 0, deltaZM: 0 };
  }

  const spanX = Math.max(0, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0, bounds.maxZ - bounds.minZ);
  return {
    deltaXM: (deltaClientX / viewportWidthPx) * spanX,
    deltaZM: (deltaClientY / viewportHeightPx) * spanZ,
  };
}

function pointAngleDeg(point: ScreenPoint, center: ScreenPoint): number {
  return (
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) /
    Math.PI
  );
}

/** Returns the shortest signed rotation between two pointer positions. */
export function pointerRotationDeltaDeg(
  start: ScreenPoint,
  current: ScreenPoint,
  center: ScreenPoint
): number {
  let delta = pointAngleDeg(current, center) - pointAngleDeg(start, center);
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return delta;
}

export function normalizePlacementRotationDeg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let normalized = ((value + 180) % 360 + 360) % 360 - 180;
  if (Object.is(normalized, -0)) normalized = 0;
  return normalized;
}

export function snapPlacementValue(value: number, step = 0.1): number {
  if (!Number.isFinite(value)) return 0;
  const safeStep = Number.isFinite(step) && step > 0 ? step : 0.1;
  const snapped = Math.round(value / safeStep) * safeStep;
  const precision = Math.max(0, Math.ceil(-Math.log10(safeStep)));
  const result = Number(snapped.toFixed(Math.min(8, precision + 1)));
  return Object.is(result, -0) ? 0 : result;
}
