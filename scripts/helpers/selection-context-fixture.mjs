// Synthetic geography in meters around the requested center; never live data.
export function selectionContextFixture(request, mode = 'normal') {
  const coordinate = (x, y) => [request.center.lng + x / (111000 * Math.cos(request.center.lat * Math.PI / 180)), request.center.lat + y / 111000];
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]].map(([a, b]) => coordinate(a, b));
  const feature = (id, kind, x, y, w = 14, h = 18) => ({ id, kind, pnu: kind === 'building' ? null : '1132010500102810099', label: id,
    polygons: [[rect(x, y, w, h)]], labelPosition: coordinate(x + w / 2, y + h / 2) });
  const parcelFeatures = [[-32, 2], [-16, 2], [16, 2], [32, 2], [-32, -32], [-16, -32], [0, -32], [16, -32], [32, -32]].map(([x, y], i) => feature(`281-${30 + i}`, 'parcel', x, y));
  const buildingFeatures = [feature('건물 A', 'building', -5, -5, 9, 10), feature('건물 B', 'building', -29, 4, 9, 13), feature('건물 C', 'building', 19, 4, 9, 13)];
  buildingFeatures[1].polygons[0].push(rect(-27, 6, 3, 4)); // courtyard
  buildingFeatures[2].polygons.push([rect(33, 4, 7, 13)]); // a second footprint part
  if (mode === 'delay') buildingFeatures[0] = feature('오래된 건물 응답', 'building', 55, 40, 9, 10);
  const layer = (dataset, features) => ({ status: 'available', features, source: 'VWorld', dataset, sourceUrl: 'https://api.vworld.kr/req/data',
    queriedAt: '2026-10-08T00:00:00.000Z', sourceUpdatedAt: null, crs: 'EPSG:4326', radiusM: 80, receivedCount: features.length,
    omittedCount: 0, limited: false, message: '합성 응답 · 브라우저 동작 검증용' });
  const layers = { parcels: layer('LP_PA_CBND_BUBUN', parcelFeatures), buildings: layer('dt_d010', buildingFeatures), roads: layer('LP_PA_CBND_BUBUN', [feature('281-도로', 'road', -42, -12, 94, 10)]) };
  if (mode === 'partial') { layers.buildings.status = 'error'; layers.buildings.features = []; layers.parcels.status = 'partial'; layers.parcels.limited = true; }
  if (mode === 'empty' || mode === 'unavailable') for (const entry of Object.values(layers)) { entry.features = []; entry.status = mode; }
  return { ...request, revision: mode === 'identity' ? 'wrong-selection-revision' : request.revision, layers };
}
