import type {
  BuildingLookupResult,
  estimateUnitAreaSqm,
} from "@/lib/integrations/molit-building";
import type { ParcelInputProvenance } from "@/lib/finance/types";
import type { RegulatoryConstraintSet } from "@/lib/regulatory/constraints";

export interface ParcelLookupBase {
  address: string;
  addressRoad: string | null;
  lat: number;
  lng: number;
  bCode: string;
  lawdCd: string;
  sido: string;
  sigungu: string;
  dong: string;
  jibun: string | null;
  mainAddressNo: string;
  subAddressNo: string;
  mountainYn: "Y" | "N" | "";
  pnu: string;
  currentBuilding: BuildingLookupResult | null;
  existingUnitArea: ReturnType<typeof estimateUnitAreaSqm>;
}

export interface ParcelLookupComplete extends ParcelLookupBase {
  mode: "vworld" | "manual";
  lotArea: number;
  boundary?: [number, number][];
  roads?: { name: string | null; points: [number, number][] }[];
  jimok: string;
  jimokCode: string;
  jimokCategory: "buildable" | "farmland" | "forest" | "other";
  landPrice: number;
  landPriceYear: string;
  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  heightLimit: number;
  regulatoryConstraints: RegulatoryConstraintSet;
  overlays: Array<{ code: string; name: string; conflict: string }>;
  inputProvenance: ParcelInputProvenance;
}

export type ManualLookupReasonCode =
  | "VWORLD_DISABLED"
  | "VWORLD_NOT_CONFIGURED"
  | "VWORLD_UNREACHABLE"
  | "CADASTRAL_NOT_FOUND";

export interface ParcelLookupManualRequired extends ParcelLookupBase {
  mode: "manual-required";
  reason: {
    code: ManualLookupReasonCode;
    message: string;
  };
}

export type ParcelLookupResponse =
  | ParcelLookupComplete
  | ParcelLookupManualRequired;
