// METAR (NOAA AWC), avisos INMET, Nominatim e GOES-19 (GIBS).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Observation, OfficialAlert } from '../api/types';
import { bearingDeg, compass8, haversineKm, pointInGeometry } from './geo';
import { get } from './net';

export const METAR_ATTR = 'METAR: NOAA Aviation Weather Center / DECEA';
export const INMET_ATTR = 'Avisos: INMET — Instituto Nacional de Meteorologia';

const WX: Record<string, string> = {
  TS: 'trovoada', SH: 'pancadas', RA: 'chuva', DZ: 'garoa', GR: 'granizo', GS: 'granizo pequeno',
  BR: 'névoa úmida', FG: 'nevoeiro', HZ: 'névoa seca', FU: 'fumaça', SQ: 'rajadas (tempestade)',
};

export function parseWx(wx?: string | null): Observation['weather'] {
  const r: Observation['weather'] = { raw: wx ?? '', precipAtStation: false, precipVicinity: false, thunder: false, thunderVicinity: false, intensity: null, description: [] };
  if (!wx) return r;
  for (const tok of wx.split(/\s+/)) {
    const vic = tok.startsWith('VC');
    let core = vic ? tok.slice(2) : tok;
    let intensity: string | null = null;
    if (core.startsWith('-')) [intensity, core] = ['fraca', core.slice(1)];
    else if (core.startsWith('+')) [intensity, core] = ['forte', core.slice(1)];
    const codes: string[] = core.match(/[A-Z]{2}/g) ?? [];
    const precip = codes.some((c) => ['RA', 'DZ', 'GR', 'GS'].includes(c));
    const thunder = codes.includes('TS');
    if (vic) {
      r.precipVicinity ||= precip || codes.includes('SH');
      r.thunderVicinity ||= thunder;
    } else {
      r.precipAtStation ||= precip;
      r.thunder ||= thunder;
      if (precip) r.intensity = intensity ?? 'moderada';
    }
    let words = codes.filter((c) => c !== 'SH' || codes.length === 1).map((c) => WX[c] ?? c);
    if (codes.includes('SH') && codes.includes('RA')) words = words.map((w) => (w === 'chuva' ? 'pancadas de chuva' : w));
    let desc = thunder && words.length > 1 ? 'trovoada com ' + words.filter((w) => w !== 'trovoada').join(' e ') : words.join(' ');
    if (precip && !vic) desc += ` ${intensity ?? 'moderada'}`;
    if (vic) desc += ' nas proximidades';
    r.description.push(desc.trim());
  }
  return r;
}

export function normalizeMetar(m: any, lat?: number, lon?: number): Observation {
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const visib = m.visib;
  const visKm = typeof visib === 'number' ? Math.round(visib * 1.609344 * 10) / 10 : typeof visib === 'string' && visib.endsWith('+') ? 10 : null;
  const t = num(m.temp);
  const td = num(m.dewp);
  let hum: number | null = null;
  if (t !== null && td !== null) hum = Math.round(Math.min(100, 100 * Math.exp((17.625 * td) / (243.04 + td) - (17.625 * t) / (243.04 + t))));
  const o: Observation = {
    station: m.icaoId, name: m.name, lat: m.lat, lon: m.lon, observedAt: m.obsTime, temperature: t, dewpoint: td, humidity: hum,
    windSpeed: num(m.wspd) === null ? null : Math.round(m.wspd * 1.852),
    windGust: num(m.wgst) === null ? null : Math.round(m.wgst * 1.852),
    windDirection: num(m.wdir), pressure: num(m.altim), visibilityKm: visKm, weather: parseWx(m.wxString), raw: m.rawOb,
    distanceKm: 0, bearing: '',
  };
  if (lat !== undefined && lon !== undefined) {
    o.distanceKm = Math.round(haversineKm(lat, lon, o.lat, o.lon) * 10) / 10;
    o.bearing = compass8(bearingDeg(lat, lon, o.lat, o.lon));
  }
  return o;
}

const AWC = 'https://aviationweather.gov/api/data/metar';

export async function fetchNearbyMetar(lat: number, lon: number) {
  const clat = Math.round(lat * 2) / 2;
  const clon = Math.round(lon * 2) / 2;
  const bbox = `${clat - 1.5},${clon - 1.5},${clat + 1.5},${clon + 1.5}`;
  const r = await get<any[]>('aviationweather', AWC, { bbox, format: 'json', hours: 3 }, { ttl: 600, native: true });
  const obs = (Array.isArray(r.value) ? r.value : []).map((m) => normalizeMetar(m, lat, lon));
  const latest = new Map<string, Observation>();
  const precip = new Map<string, boolean>();
  for (const o of obs) {
    precip.set(o.station, (precip.get(o.station) ?? false) || o.weather.precipAtStation);
    const cur = latest.get(o.station);
    if (!cur || (o.observedAt ?? 0) > (cur.observedAt ?? 0)) latest.set(o.station, o);
  }
  const stations = [...latest.values()].sort((a, b) => a.distanceKm - b.distanceKm);
  stations.forEach((s) => (s.recentPrecip = precip.get(s.station)));
  return { stations, fetchedAt: r.fetchedAt, stale: r.stale };
}

export async function fetchStationHistory(station: string) {
  const r = await get<any[]>('aviationweather', AWC, { ids: station, format: 'json', hours: 120 }, { ttl: 3600, native: true });
  return (Array.isArray(r.value) ? r.value : []).map((m) => normalizeMetar(m)).sort((a, b) => a.observedAt - b.observedAt);
}

// --- INMET
type RawAlert = OfficialAlert & { geometry: any };
const SEV: Record<string, number> = { 'Perigo Potencial': 1, Perigo: 2, 'Grande Perigo': 3 };

function brt(s?: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5]) / 1000 : null; // Brasília = UTC−3
}
const list = (s: unknown): string[] => {
  if (!s) return [];
  if (Array.isArray(s)) return s.map(String);
  const str = String(s).trim();
  if (str.startsWith('[')) {
    try {
      return JSON.parse(str.replace(/'/g, '"'));
    } catch {
      return [str.replace(/^\['|'\]$/g, '')];
    }
  }
  return [str];
};

export function normalizeInmet(a: any, period: string): RawAlert {
  let geometry = null;
  try {
    geometry = JSON.parse(a.poligono ?? 'null');
  } catch {
    /* sem polígono */
  }
  return {
    id: `inmet-${a.id_aviso}-${a.id_sequencia}`, kind: 'official', authority: 'INMET', event: a.descricao, severity: a.severidade ?? '',
    level: SEV[a.severidade] ?? 0, color: a.aviso_cor, start: brt(a.inicio), end: brt(a.fim), risks: list(a.riscos),
    instructions: list(a.instrucoes), states: a.estados, period, inForce: false, url: 'https://avisos.inmet.gov.br/', source: INMET_ATTR, geometry,
  };
}

export async function fetchInmet() {
  const r = await get<any>('inmet', 'https://apiprevmet3.inmet.gov.br/avisos/ativos', undefined, { ttl: 600 });
  const alerts: RawAlert[] = [];
  for (const p of ['hoje', 'futuro']) for (const a of r.value?.[p] ?? []) alerts.push(normalizeInmet(a, p));
  return { alerts, fetchedAt: r.fetchedAt, stale: r.stale };
}

export function alertsForPoint(alerts: RawAlert[], lat: number, lon: number, now = Date.now() / 1000): OfficialAlert[] {
  return alerts
    .filter((a) => a.geometry && pointInGeometry(lon, lat, a.geometry) && !(a.end && a.end < now))
    .map(({ geometry: _g, ...rest }) => ({ ...rest, inForce: !!(rest.start && rest.start <= now) }))
    .sort((a, b) => b.level - a.level || (a.start ?? 0) - (b.start ?? 0));
}

export function alertsGeoJSON(alerts: RawAlert[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: alerts.filter((a) => a.geometry).map((a) => ({
      type: 'Feature', geometry: a.geometry,
      properties: { id: a.id, event: a.event, severity: a.severity, level: a.level, color: a.color, start: a.start, end: a.end, period: a.period },
    })),
  };
}

// --- Nominatim (endereços, bairros, reverso)
const NOMI = 'https://nominatim.openstreetmap.org';
export async function nominatimSearch(q: string) {
  const r = await get<any[]>('nominatim', `${NOMI}/search`, { q, format: 'jsonv2', limit: 6, 'accept-language': 'pt-BR' }, { ttl: 7 * 86400, native: true });
  return (r.value ?? []).map((x) => ({ name: x.name || String(x.display_name).split(',')[0], label: x.display_name, lat: +x.lat, lon: +x.lon, timezone: null, source: '© OpenStreetMap contributors (Nominatim)' }));
}
export async function nominatimReverse(lat: number, lon: number) {
  const r = await get<any>('nominatim', `${NOMI}/reverse`, { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, format: 'jsonv2', zoom: 14, 'accept-language': 'pt-BR' }, { ttl: 30 * 86400, native: true });
  const a = r.value?.address ?? {};
  const parts = [a.suburb ?? a.neighbourhood ?? a.city_district ?? a.village, a.city ?? a.town ?? a.municipality, a.state].filter(Boolean);
  return { label: parts.length ? [...new Set(parts)].join(', ') : null };
}

// --- GOES-19 via NASA GIBS
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const SAT_LAYERS: Record<string, { layer: string; matrix: string; maxZoom: number; name: string; unit: string; resolution: string; note: string }> = {
  satellite_visible: { layer: 'GOES-East_ABI_Band2_Red_Visible_1km', matrix: 'GoogleMapsCompatible_Level7', maxZoom: 7, name: 'Satélite visível (GOES-19, banda 2)', unit: 'refletância', resolution: '1 km', note: 'Só tem informação durante o dia.' },
  satellite_infrared: { layer: 'GOES-East_ABI_Band13_Clean_Infrared', matrix: 'GoogleMapsCompatible_Level6', maxZoom: 6, name: 'Satélite infravermelho (GOES-19, banda 13)', unit: 'temperatura de brilho', resolution: '2 km', note: '' },
  satellite_geocolor: { layer: 'GOES-East_ABI_GeoColor', matrix: 'GoogleMapsCompatible_Level7', maxZoom: 7, name: 'Nuvens — GeoColor (GOES-19)', unit: 'composição', resolution: '1–2 km', note: '' },
};

export function expandDomain(domain: string, start: number, end: number): number[] {
  const out = new Set<number>();
  const p = (s: string) => Date.parse(s) / 1000;
  for (const part of domain.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, b, step] = part.split('/');
    if (!b) {
      const t = p(a);
      if (t >= start && t <= end) out.add(t);
      continue;
    }
    const st = (Number(/PT(\d+)M/.exec(step ?? '')?.[1] ?? 10) || 10) * 60;
    for (let t = p(a); t <= p(b); t += st) if (t >= start && t <= end) out.add(t);
  }
  return [...out].sort((x, y) => x - y);
}

export async function satelliteTimes(id: string) {
  const meta = SAT_LAYERS[id];
  const end = Math.floor(Date.now() / 1000 / 60) * 60;
  const start = end - 3 * 3600;
  const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16) + ':00Z';
  const endQ = end - (end % 600);
  const url = `${GIBS}/1.0.0/${meta.layer}/default/${meta.matrix}/all/${iso(start)}--${iso(endQ)}.xml`;
  const r = await get<string>('gibs', url, undefined, { ttl: 300, kind: 'text' });
  const m = /<Domain>([\s\S]*?)<\/Domain>/.exec(r.value);
  return {
    id, ...meta, times: m ? expandDomain(m[1], start, end) : [],
    tileTemplate: `${GIBS}/${meta.layer}/default/{time}/${meta.matrix}/{z}/{y}/{x}.png`,
    attribution: 'GOES-19 ABI (NOAA) via NASA GIBS',
  };
}
