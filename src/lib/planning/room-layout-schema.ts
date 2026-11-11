import { z } from "zod";

export const ROOM_LAYOUT_VERSION = "room-layout-2026.1" as const;
export const roomPointSchema = z.object({ x: z.number().finite().min(-1e6).max(1e6), z: z.number().finite().min(-1e6).max(1e6) });
export const roomSettingsSchema = z.object({
  bedrooms: z.number().int().min(0).max(3),
  wallThicknessM: z.number().min(0.05).max(0.4),
  hallWidthM: z.number().min(0.8).max(2.5),
  doorWidthM: z.number().min(0.6).max(1.5),
  serviceDepthM: z.number().min(1.2).max(4),
  minimumBedroomAreaSqm: z.number().min(3).max(30),
  minimumLivingAreaSqm: z.number().min(4).max(40),
});
/** Internal design assumptions, not statutory minimums. */
export const DEFAULT_ROOM_SETTINGS: z.infer<typeof roomSettingsSchema> = {
  bedrooms: 1, wallThicknessM: 0.12, hallWidthM: 0.9, doorWidthM: 0.8,
  serviceDepthM: 1.6, minimumBedroomAreaSqm: 6, minimumLivingAreaSqm: 7,
};
export const roomSpaceSchema = z.object({
  id: z.string().min(1).max(120), label: z.string().min(1).max(120),
  kind: z.enum(["bedroom", "living", "kitchen", "bathroom", "hall"]),
  center: roomPointSchema, widthM: z.number().positive().max(200), depthM: z.number().positive().max(200),
  rotationDeg: z.number().finite().min(-360).max(360),
});
export const roomDoorSchema = z.object({
  from: z.string().min(1).max(120), to: z.string().min(1).max(120),
  center: roomPointSchema, widthM: z.number().positive().max(3),
});
export const roomDraftSchema = z.object({
  version: z.literal(ROOM_LAYOUT_VERSION), unitId: z.string().min(1).max(120),
  parentBasis: z.string().min(1).max(60000), settings: roomSettingsSchema,
  entryDoor: roomDoorSchema,
  spaces: z.array(roomSpaceSchema).min(3).max(20),
  doors: z.array(roomDoorSchema).max(60),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;
export type RoomDraft = z.infer<typeof roomDraftSchema>;
export type RoomSpace = z.infer<typeof roomSpaceSchema>;
