import { booleanPointInPolygon, point, polygon } from "@turf/turf";
import { z } from "zod";

export const parcelSelectionRequestSchema = z.object({
  address: z.string().trim().min(2).max(200).optional(),
  location: z.object({ lat: z.number().finite().min(33).max(39.5), lng: z.number().finite().min(124).max(132) }).optional(),
  phase: z.enum(["selection", "details"]).default("details"),
  expectedPnu: z.string().regex(/^\d{19}$/).optional(),
}).refine(value => Boolean(value.address) !== Boolean(value.location), "주소 또는 지도 위치 하나를 선택하세요.");

/** The selected coordinate must be inside the returned cadastral boundary, not merely nearby. */
export function boundaryContainsLocation(boundary: [number, number][] | undefined, location: { lat: number; lng: number }): boolean {
  if (!boundary || boundary.length < 3 || boundary.some(p => p.length !== 2 || !p.every(Number.isFinite))) return false;
  try {
    const ring = boundary.map(p => [...p]);
    if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ring.push([...ring[0]]);
    // On a shared edge the user must move the point inside a parcel to disambiguate.
    return booleanPointInPolygon(point([location.lng, location.lat]), polygon([ring]), { ignoreBoundary: true });
  } catch { return false; }
}
