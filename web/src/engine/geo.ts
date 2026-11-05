export const COMPASS_8 = ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'];
const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dp = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number) {
  const p1 = rad(lat1);
  const p2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const x = Math.sin(dl) * Math.cos(p2);
  const y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(x, y)) + 360) % 360;
}

export const compass8 = (d: number) => COMPASS_8[Math.floor((((d % 360) + 360) % 360 + 22.5) / 45) % 8];

export function pointInRing(lon: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) {
      const x = ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

export function pointInGeometry(lon: number, lat: number, g: { type: string; coordinates: unknown } | null) {
  if (!g) return false;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as number[][][][];
  return polys.some((p) => p.length > 0 && pointInRing(lon, lat, p[0]) && !p.slice(1).some((h) => pointInRing(lon, lat, h)));
}

export function lonLatToWorldPx(lon: number, lat: number, z: number, tile = 256): [number, number] {
  const scale = tile * 2 ** z;
  const s = Math.sin(rad(Math.max(Math.min(lat, 85.0511), -85.0511)));
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

export const metersPerPx = (lat: number, z: number, tile = 256) => (Math.cos(rad(lat)) * 2 * Math.PI * 6378137) / (tile * 2 ** z);

export function roundCell(lat: number, lon: number, step = 0.1): [number, number] {
  return [Math.round(Math.round(lat / step) * step * 1e4) / 1e4, Math.round(Math.round(lon / step) * step * 1e4) / 1e4];
}
