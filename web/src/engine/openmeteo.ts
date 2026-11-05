// Adaptador Open-Meteo (porta de backend/atmos/adapters/openmeteo.py). Horários em epoch UTC.
import { get } from './net';

export const ATTRIBUTION = 'Weather data by Open-Meteo.com (CC BY 4.0)';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const PREVIOUS = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  resolutionKm: number;
  horizonDays: number;
  family: string;
}

export const DETERMINISTIC_MODELS: ModelInfo[] = [
  { id: 'ecmwf_ifs', name: 'ECMWF IFS', provider: 'ECMWF (Europa)', resolutionKm: 9, horizonDays: 15, family: 'ecmwf' },
  { id: 'gfs_seamless', name: 'NOAA GFS', provider: 'NOAA/NCEP (EUA)', resolutionKm: 13, horizonDays: 16, family: 'ncep' },
  { id: 'icon_seamless', name: 'DWD ICON', provider: 'DWD (Alemanha)', resolutionKm: 13, horizonDays: 7, family: 'dwd' },
  { id: 'ukmo_seamless', name: 'UKMO Global', provider: 'Met Office (Reino Unido)', resolutionKm: 10, horizonDays: 7, family: 'ukmo' },
  { id: 'meteofrance_seamless', name: 'Météo-France ARPEGE', provider: 'Météo-France', resolutionKm: 25, horizonDays: 4, family: 'meteofrance' },
  { id: 'gem_seamless', name: 'ECCC GEM', provider: 'ECCC (Canadá)', resolutionKm: 15, horizonDays: 10, family: 'eccc' },
];
export const MODEL_BY_ID = Object.fromEntries(DETERMINISTIC_MODELS.map((m) => [m.id, m]));

export const ENSEMBLE_MODELS = [
  { id: 'ecmwf_ifs025', name: 'ECMWF ENS', members: 51 },
  { id: 'gfs025', name: 'NCEP GEFS', members: 31 },
  { id: 'icon_seamless', name: 'DWD ICON-EPS', members: 40 },
];
export const ENSEMBLE_NAME: Record<string, string> = Object.fromEntries(ENSEMBLE_MODELS.map((m) => [m.id, m.name]));

export const HOURLY_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'cloud_cover',
  'visibility', 'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'cape',
];
const CURRENT_VARS = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation', 'weather_code', 'cloud_cover',
  'pressure_msl', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'uv_index', 'is_day',
];

export type Series = (number | null)[];
export interface MultiModel {
  times: number[];
  models: Record<string, Record<string, Series>>;
  timezone: string;
  utcOffsetSeconds: number;
  gridLat: number | null;
  gridLon: number | null;
  elevation: number | null;
  fetchedAt: number;
  stale: boolean;
}
export interface Ensemble {
  times: number[];
  ensembles: Record<string, Record<string, Series[]>>;
  timezone: string;
  fetchedAt: number;
  stale: boolean;
}

const base = (lat: number, lon: number) => ({
  latitude: Math.round(lat * 1000) / 1000,
  longitude: Math.round(lon * 1000) / 1000,
  timezone: 'auto',
  timeformat: 'unixtime',
  wind_speed_unit: 'kmh',
});

export function splitByModel(block: Record<string, Series>, vars: string[], models: string[]) {
  const out: Record<string, Record<string, Series>> = Object.fromEntries(models.map((m) => [m, {}]));
  for (const v of vars) {
    if (models.length === 1 && block[v]) {
      out[models[0]][v] = block[v];
      continue;
    }
    for (const m of models) if (block[`${v}_${m}`]) out[m][v] = block[`${v}_${m}`];
  }
  return out;
}

const SUFFIX: Record<string, string> = { ecmwf_ifs025_ensemble: 'ecmwf_ifs025', ncep_gefs025: 'gfs025', icon_seamless_eps: 'icon_seamless' };

export function parseEnsemble(block: Record<string, Series>, vars: string[]) {
  const acc: Record<string, Record<string, Map<number, Series>>> = {};
  const sorted = [...vars].sort((a, b) => b.length - a.length);
  for (const [k, series] of Object.entries(block)) {
    if (k === 'time') continue;
    const v = sorted.find((x) => k.startsWith(x + '_'));
    if (!v) continue;
    const rest = k.slice(v.length + 1);
    const m = /^member(\d+)_(.+)$/.exec(rest);
    const n = m ? Number(m[1]) : 0;
    const suffix = m ? m[2] : rest;
    const id = SUFFIX[suffix] ?? suffix;
    ((acc[id] ??= {})[v] ??= new Map()).set(n, series);
  }
  const out: Record<string, Record<string, Series[]>> = {};
  for (const [id, vs] of Object.entries(acc)) {
    out[id] = {};
    for (const [v, mem] of Object.entries(vs)) out[id][v] = [...mem.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function fetchMultimodel(lat: number, lon: number): Promise<MultiModel> {
  const models = DETERMINISTIC_MODELS.map((m) => m.id);
  const r = await get<any>('open-meteo', FORECAST, { ...base(lat, lon), hourly: HOURLY_VARS.join(','), models: models.join(','), forecast_days: 3, past_hours: 3 }, { ttl: 1800 });
  const d = r.value;
  const h = d.hourly ?? {};
  return {
    times: h.time ?? [],
    models: splitByModel(h, HOURLY_VARS, models),
    timezone: d.timezone ?? 'UTC',
    utcOffsetSeconds: d.utc_offset_seconds ?? 0,
    gridLat: d.latitude ?? null,
    gridLon: d.longitude ?? null,
    elevation: d.elevation ?? null,
    fetchedAt: r.fetchedAt,
    stale: r.stale,
  };
}

export async function fetchCurrent(lat: number, lon: number) {
  const r = await get<any>('open-meteo', FORECAST, { ...base(lat, lon), current: CURRENT_VARS.join(','), forecast_days: 1 }, { ttl: 900 });
  return { current: r.value.current ?? {}, timezone: r.value.timezone ?? 'UTC', utcOffsetSeconds: r.value.utc_offset_seconds ?? 0, fetchedAt: r.fetchedAt, stale: r.stale };
}

export async function fetchEnsembleHourly(lat: number, lon: number): Promise<Ensemble> {
  const vars = ['precipitation', 'wind_gusts_10m', 'temperature_2m'];
  const r = await get<any>('open-meteo-ensemble', ENSEMBLE, { ...base(lat, lon), hourly: vars.join(','), models: ENSEMBLE_MODELS.map((m) => m.id).join(','), forecast_days: 3 }, { ttl: 3600 });
  const b = r.value.hourly ?? {};
  return { times: b.time ?? [], ensembles: parseEnsemble(b, vars), timezone: r.value.timezone, fetchedAt: r.fetchedAt, stale: r.stale };
}

export async function fetchEnsembleDaily(lat: number, lon: number): Promise<Ensemble> {
  const vars = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_gusts_10m_max'];
  const r = await get<any>('open-meteo-ensemble', ENSEMBLE, { ...base(lat, lon), daily: vars.join(','), models: ENSEMBLE_MODELS.map((m) => m.id).join(','), forecast_days: 16 }, { ttl: 3 * 3600 });
  const b = r.value.daily ?? {};
  return { times: b.time ?? [], ensembles: parseEnsemble(b, vars), timezone: r.value.timezone, fetchedAt: r.fetchedAt, stale: r.stale };
}

export const AUDIT_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'ukmo_seamless', 'gem_seamless'];

export async function fetchPreviousRuns(lat: number, lon: number) {
  const vars = ['temperature_2m', 'temperature_2m_previous_day1', 'temperature_2m_previous_day2', 'precipitation_previous_day1', 'precipitation_previous_day2'];
  const r = await get<any>('open-meteo-previous-runs', PREVIOUS, { ...base(lat, lon), hourly: vars.join(','), models: AUDIT_MODELS.join(','), past_days: 5, forecast_days: 1 }, { ttl: 6 * 3600 });
  const b = r.value.hourly ?? {};
  return { times: (b.time ?? []) as number[], models: splitByModel(b, vars, AUDIT_MODELS) };
}

const GRID_VARS = ['temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'cloud_cover'];

export async function fetchGrid(lat0: number, lon0: number) {
  const clat = Math.round(lat0 * 2) / 2;
  const clon = Math.round(lon0 * 2) / 2;
  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = -4; i <= 4; i++)
    for (let j = -4; j <= 4; j++) {
      lats.push(Math.round((clat + i * 0.25) * 1000) / 1000);
      lons.push(Math.round((clon + j * 0.25) * 1000) / 1000);
    }
  const r = await get<any>('open-meteo-grid', FORECAST, {
    latitude: lats.join(','), longitude: lons.join(','), hourly: GRID_VARS.join(','), models: 'ecmwf_ifs025',
    forecast_hours: 48, timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh',
  }, { ttl: 3 * 3600 });
  const data = Array.isArray(r.value) ? r.value : [r.value];
  let times: number[] = [];
  const points = data.map((d: any) => {
    times = d.hourly?.time ?? times;
    return { lat: d.latitude, lon: d.longitude, values: Object.fromEntries(GRID_VARS.map((v) => [v, d.hourly?.[v] ?? []])) };
  });
  return { model: 'ecmwf_ifs025', step: 0.25, times, points, fetchedAt: r.fetchedAt, stale: r.stale };
}

export async function geocode(name: string) {
  const r = await get<any>('open-meteo-geocoding', GEOCODING, { name, count: 8, language: 'pt', format: 'json' }, { ttl: 86400 });
  return ((r.value.results ?? []) as any[]).map((x) => ({
    name: x.name,
    label: [x.name, x.admin2, x.admin1, x.country].filter(Boolean).join(', '),
    lat: x.latitude,
    lon: x.longitude,
    timezone: x.timezone,
    source: 'Open-Meteo Geocoding (GeoNames)',
  }));
}
