import type { Parcel } from "@/lib/finance/types";

export const REPRESENTATIVE_PARCEL_BASIS_VERSION =
  "representative-parcel-basis-2026.2" as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (record[key] !== undefined) result[key] = canonicalize(record[key]);
        return result;
      }, {});
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stableHash(value: unknown): string {
  const input = JSON.stringify(canonicalize(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

/**
 * 대표안의 법규 통과와 Geometry를 만든 부지 입력만 잠근다.
 * 토지가·공사비 같은 금융 입력은 대표 형상을 무효화하지 않는다.
 */
export function representativeParcelBasis(parcel: Parcel) {
  return {
    version: REPRESENTATIVE_PARCEL_BASIS_VERSION,
    projectId: parcel.id,
    lotAreaSqm: parcel.lotArea,
    boundary: parcel.boundary ?? null,
    boundaryPolygons: parcel.boundaryPolygons ?? null,
    roads: parcel.roads ?? null,
    zoning: parcel.zoning,
    zoneCode: parcel.zoneCode,
    maxFARPct: parcel.maxFAR,
    maxBCRPct: parcel.maxBCR,
    heightLimitM: parcel.heightLimit,
    regulatoryConstraints: parcel.regulatoryConstraints ?? null,
    inputProvenance: parcel.inputProvenance
      ? {
          mode: parcel.inputProvenance.mode,
          parcelFacts: parcel.inputProvenance.parcelFacts,
          geometry: parcel.inputProvenance.geometry,
          zoning: parcel.inputProvenance.zoning,
        }
      : null,
    setback: parcel.setback,
  };
}

export function buildRepresentativeParcelBasisHash(parcel: Parcel): string {
  const fingerprint = stableHash(representativeParcelBasis(parcel));
  return `PG-BASIS-${fingerprint}`;
}

export function representativeParcelBasisInvalidationReason(input: {
  snapshotProjectId: string | null | undefined;
  storedBasisHash: string | null | undefined;
  nextParcel: Parcel;
}): string | null {
  if (!input.snapshotProjectId) return null;
  if (input.snapshotProjectId !== input.nextParcel.id) {
    return "부지가 변경되어 대표 계획안 Geometry Snapshot을 다시 확정해야 합니다.";
  }
  if (
    !input.storedBasisHash ||
    input.storedBasisHash !== buildRepresentativeParcelBasisHash(input.nextParcel)
  ) {
    return "대지 경계·도로 또는 법규 근거가 변경되어 대표 계획안을 다시 확정해야 합니다.";
  }
  return null;
}
