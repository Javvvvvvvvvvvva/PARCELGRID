const LOCALITY_TOKEN = /(?:동|읍|면|리)$/;
const ADMIN_TOKEN = /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;

export function extractDong(address: string): string | null {
  const match = address.match(/([가-힣]+(?:동|읍|면|리))/);
  return match ? match[1] : null;
}

export function extractAdministrativeArea(address: string): string | null {
  const tokens = address.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const administrative: string[] = [];
  for (const [index, token] of tokens.entries()) {
    if (
      LOCALITY_TOKEN.test(token) ||
      /(?:대로|로|길)$/.test(token) ||
      /^\d/.test(token)
    ) {
      break;
    }
    if (index === 0 || ADMIN_TOKEN.test(token)) {
      administrative.push(token);
      continue;
    }
    break;
  }

  return administrative.length > 0 ? administrative.join(" ") : null;
}

export function buildCompGeocodeQuery(
  maskedAddress: string,
  contextAddress: string,
): string | null {
  const locality = extractDong(maskedAddress);
  const administrative = extractAdministrativeArea(contextAddress);
  if (!locality || !administrative) return null;
  return `${administrative} ${locality}`;
}

export function scatterApproximateCoordinate(
  lat: number,
  lng: number,
  index: number,
): { lat: number; lng: number } {
  const goldenAngle = 2.399963;
  const radiusDegrees =
    0.00018 * Math.sqrt((Math.max(0, index) % 40) + 1);
  const theta = index * goldenAngle;
  return {
    lat: lat + radiusDegrees * Math.cos(theta),
    lng: lng + radiusDegrees * Math.sin(theta),
  };
}

export function coordinateDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return (
    2 *
    earthRadiusKm *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}
