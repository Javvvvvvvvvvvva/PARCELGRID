import { z } from "zod";

export const INTERIOR_VERSION = "parcelgrid-interior-v1" as const;
export const SPACE_KINDS = ["unit", "living", "bedroom", "kitchen", "bathroom", "retail", "core", "corridor", "storage"] as const;
export const SPACE_LABELS: Record<SpaceKind, string> = {
  unit: "주거 세대", living: "거실", bedroom: "침실", kitchen: "주방",
  bathroom: "욕실", retail: "상가", core: "코어", corridor: "복도", storage: "창고",
};
export const SPACE_COLORS: Record<SpaceKind, string> = {
  unit: "#60a5fa", living: "#38bdf8", bedroom: "#a78bfa", kitchen: "#fbbf24",
  bathroom: "#2dd4bf", retail: "#fb923c", core: "#f87171", corridor: "#cbd5e1", storage: "#a3a3a3",
};

const finite = z.number().finite();
const point = z.object({ x: finite.min(-1e6).max(1e6), z: finite.min(-1e6).max(1e6) });
const id = z.string().min(1).max(100);
export const interiorSpaceSchema = z.object({
  id, label: z.string().min(1).max(100), kind: z.enum(SPACE_KINDS),
  center: point, widthM: finite.min(0.2).max(200), depthM: finite.min(0.2).max(200),
  rotationDeg: finite.min(-360).max(360), locked: z.boolean(),
  minWidthM: finite.min(0).max(50), minAreaSqm: finite.min(0).max(10000),
  unitCount: z.number().int().min(0).max(100),
  revenueModel: z.enum(["sale", "lease", "non-revenue"]),
});
export const interiorLayoutSchema = z.object({
  version: z.literal(INTERIOR_VERSION),
  sourceOutline: z.array(point).min(3).max(500),
  wallThicknessM: finite.min(0).max(0.6),
  spaces: z.array(interiorSpaceSchema).max(64),
  doors: z.array(z.object({ id, from: id, to: id, center: point, widthM: finite.min(0.1).max(5) })).max(128),
  relations: z.array(z.object({ id, from: id, to: id, kind: z.enum(["adjacent", "separate"]) })).max(256),
  generator: z.enum(["manual", "parcelgrid-strip-v1"]),
  /** Unit/room geometry is a draft. No structural, fire, or accessibility approval is implied. */
  stage: z.literal("concept"),
});

export type SpaceKind = typeof SPACE_KINDS[number];
export type InteriorSpace = z.infer<typeof interiorSpaceSchema>;
export type InteriorLayout = z.infer<typeof interiorLayoutSchema>;
export type InteriorDoor = InteriorLayout["doors"][number];
export interface InteriorIssue { code: string; severity: "fail" | "review"; message: string; spaceId?: string }
export interface InteriorAssessment {
  valid: boolean;
  issues: InteriorIssue[];
  floorAreaSqm: number;
  assignedAreaSqm: number;
  clearAreaSqm: number;
  saleableAreaSqm: number;
  rentableAreaSqm: number;
  remainingAreaSqm: number;
  connectedSpaceIds: string[];
}

export interface InteriorGenerationInput {
  outline: Array<{ x: number; z: number }>;
  count: number;
  circulationWidthM: number;
  coreDepthM: number;
  minRoomWidthM: number;
  minRoomAreaSqm: number;
  wallThicknessM: number;
}
export interface InteriorGenerationResult {
  status: "candidates" | "no-template-fit" | "invalid-input";
  candidates: Array<{ label: string; layout: InteriorLayout; score: number }>;
  message: string;
}
