export interface ParcelAddressIdentity {
  bCode: string;
  mainAddressNo: string;
  subAddressNo?: string;
  mountainYn?: string;
}

function normalizedLotNumber(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d{1,4}$/.test(trimmed)) return null;
  return String(Number(trimmed)).padStart(4, "0");
}

export function pnuFromParcelAddress(
  input: ParcelAddressIdentity,
): string | null {
  if (!/^\d{10}$/.test(input.bCode)) return null;
  const main = normalizedLotNumber(input.mainAddressNo);
  if (!main) return null;
  const sub = input.subAddressNo?.trim()
    ? normalizedLotNumber(input.subAddressNo)
    : "0000";
  if (!sub) return null;

  const special = input.mountainYn === "Y" ? "2" : "1";
  return `${input.bCode}${special}${main}${sub}`;
}

export function manualParcelId(input: {
  bCode: string;
  mainAddressNo: string;
  subAddressNo?: string;
  mountainYn?: string;
  lat: number;
  lng: number;
}): string {
  const pnu = pnuFromParcelAddress(input);
  if (pnu) return pnu;

  const lat = Math.round(input.lat * 1_000_000);
  const lng = Math.round(input.lng * 1_000_000);
  return `manual-${lat}-${lng}`;
}
