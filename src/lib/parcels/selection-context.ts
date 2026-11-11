import { z } from "zod";

export const SELECTION_CONTEXT_RADIUS_M = 80;
export const SELECTION_CONTEXT_LIMIT = 100;
const location = z.object({ lat: z.number().finite().min(33).max(39.5), lng: z.number().finite().min(124).max(132) });
const coordinate = z.tuple([z.number().finite().min(124).max(132), z.number().finite().min(33).max(39.5)]);
const polygon = z.array(z.array(coordinate).min(4).max(1024)).min(1).max(32);

export const selectionContextRequestSchema = z.object({
  pnu: z.string().regex(/^\d{19}$/),
  center: location,
  revision: z.string().min(1).max(80),
}).strict();

export const contextFeatureSchema = z.object({
  id: z.string().min(1).max(200),
  pnu: z.string().regex(/^\d{19}$/).nullable(),
  label: z.string().max(100),
  kind: z.enum(["parcel", "road", "building"]),
  polygons: z.array(polygon).min(1).max(32),
  labelPosition: coordinate,
});

export const contextLayerSchema = z.object({
  status: z.enum(["available", "partial", "empty", "error", "unavailable"]),
  features: z.array(contextFeatureSchema).max(SELECTION_CONTEXT_LIMIT),
  source: z.string(), dataset: z.string(), sourceUrl: z.string().url(),
  queriedAt: z.string().datetime(), sourceUpdatedAt: z.string().nullable(),
  crs: z.literal("EPSG:4326"), radiusM: z.literal(SELECTION_CONTEXT_RADIUS_M),
  receivedCount: z.number().int().nonnegative(), omittedCount: z.number().int().nonnegative(),
  limited: z.boolean(), message: z.string(),
});

export const selectionContextResponseSchema = selectionContextRequestSchema.extend({
  layers: z.object({ parcels: contextLayerSchema, buildings: contextLayerSchema, roads: contextLayerSchema }),
});

export type SelectionContextRequest = z.infer<typeof selectionContextRequestSchema>;
export type SelectionContext = z.infer<typeof selectionContextResponseSchema>;
export type ContextLayer = z.infer<typeof contextLayerSchema>;
export type ContextFeature = z.infer<typeof contextFeatureSchema>;
export type ContextLayerKey = keyof SelectionContext["layers"];

export const CONTEXT_LAYER_LABELS: Record<ContextLayerKey, string> = {
  parcels: "주변 필지", buildings: "건물 외곽", roads: "도로 필지",
};

export function contextMatchesSelection(context: SelectionContext, selection: SelectionContextRequest): boolean {
  return context.pnu === selection.pnu && context.revision === selection.revision &&
    context.center.lat === selection.center.lat && context.center.lng === selection.center.lng;
}
