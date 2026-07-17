import {
  createFloorProgram,
  createFloorZone,
  defaultRevenueModelForUse,
  sortFloorPrograms,
} from "@/lib/planning/scenario-utils";
import type {
  FloorProgram,
  FloorUseType,
  FloorZone,
} from "@/lib/planning/types";

function cloneZone(zone: FloorZone): FloorZone {
  return {
    ...createFloorZone(
      zone.useType,
      zone.areaSqm,
      zone.unitCount,
      zone.label,
      zone.revenueModel ?? defaultRevenueModelForUse(zone.useType)
    ),
    saleableAreaSqm: zone.saleableAreaSqm,
    rentableAreaSqm: zone.rentableAreaSqm,
  };
}

export function cloneFloorProgramAtLevel(
  source: FloorProgram,
  level: number
): FloorProgram {
  return {
    ...createFloorProgram(
      level,
      source.zones.map(cloneZone),
      source.floorHeightM
    ),
    footprintScalePct: source.footprintScalePct,
    northSetbackM: source.northSetbackM,
  };
}

export function normalizeFloorLevels(floors: FloorProgram[]): FloorProgram[] {
  const ground = floors
    .filter((floor) => floor.level > 0)
    .sort((a, b) => a.level - b.level)
    .map((floor, index) => ({
      ...floor,
      level: index + 1,
      label: `${index + 1}층`,
    }));
  const basement = floors
    .filter((floor) => floor.level < 0)
    .sort((a, b) => b.level - a.level)
    .map((floor, index) => ({
      ...floor,
      level: -(index + 1),
      label: `B${index + 1}`,
    }));
  return sortFloorPrograms([...ground, ...basement]);
}

export function nextGroundLevel(floors: FloorProgram[]): number {
  const levels = floors.filter((floor) => floor.level > 0).map((floor) => floor.level);
  return levels.length > 0 ? Math.max(...levels) + 1 : 1;
}

export function nextBasementLevel(floors: FloorProgram[]): number {
  const levels = floors.filter((floor) => floor.level < 0).map((floor) => floor.level);
  return levels.length > 0 ? Math.min(...levels) - 1 : -1;
}

export function addGroundFloor(floors: FloorProgram[]): FloorProgram[] {
  const level = nextGroundLevel(floors);
  const source = [...floors]
    .filter((floor) => floor.level > 0)
    .sort((a, b) => b.level - a.level)[0];
  const floor = source
    ? cloneFloorProgramAtLevel(source, level)
    : createFloorProgram(level, [createFloorZone("residential", 40, 1)]);
  return normalizeFloorLevels([...floors, floor]);
}

export function addBasementFloor(floors: FloorProgram[]): FloorProgram[] {
  const level = nextBasementLevel(floors);
  const source = [...floors]
    .filter((floor) => floor.level < 0)
    .sort((a, b) => a.level - b.level)[0];
  const floor = source
    ? cloneFloorProgramAtLevel(source, level)
    : createFloorProgram(
        level,
        [createFloorZone("parking", 50, 0, undefined, "non-revenue")],
        3.3
      );
  return normalizeFloorLevels([...floors, floor]);
}

export function duplicateFloorProgram(
  floors: FloorProgram[],
  floorId: string
): FloorProgram[] {
  const source = floors.find((floor) => floor.id === floorId);
  if (!source) return floors;
  const level = source.level < 0 ? nextBasementLevel(floors) : nextGroundLevel(floors);
  return normalizeFloorLevels([
    ...floors,
    cloneFloorProgramAtLevel(source, level),
  ]);
}

export function removeFloorProgram(
  floors: FloorProgram[],
  floorId: string
): FloorProgram[] {
  if (floors.length <= 1) return floors;
  return normalizeFloorLevels(floors.filter((floor) => floor.id !== floorId));
}

export function updateFloorProgram(
  floors: FloorProgram[],
  floorId: string,
  patch: Partial<Omit<FloorProgram, "id" | "zones">>
): FloorProgram[] {
  return floors.map((floor) =>
    floor.id === floorId ? { ...floor, ...patch, id: floor.id } : floor
  );
}

export function addZoneToFloor(
  floors: FloorProgram[],
  floorId: string,
  useType: FloorUseType
): FloorProgram[] {
  const defaultUnitCount =
    useType === "residential" || useType === "retail" || useType === "office"
      ? 1
      : 0;
  return floors.map((floor) =>
    floor.id === floorId
      ? {
          ...floor,
          zones: [
            ...floor.zones,
            createFloorZone(useType, 20, defaultUnitCount),
          ],
        }
      : floor
  );
}

export function updateFloorZone(
  floors: FloorProgram[],
  floorId: string,
  zoneId: string,
  patch: Partial<Omit<FloorZone, "id">>
): FloorProgram[] {
  return floors.map((floor) =>
    floor.id === floorId
      ? {
          ...floor,
          zones: floor.zones.map((zone) =>
            zone.id === zoneId ? { ...zone, ...patch, id: zone.id } : zone
          ),
        }
      : floor
  );
}

export function removeFloorZone(
  floors: FloorProgram[],
  floorId: string,
  zoneId: string
): FloorProgram[] {
  return floors.map((floor) =>
    floor.id === floorId
      ? { ...floor, zones: floor.zones.filter((zone) => zone.id !== zoneId) }
      : floor
  );
}
