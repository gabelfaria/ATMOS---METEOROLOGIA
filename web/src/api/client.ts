import { useQuery } from '@tanstack/react-query';
import type {
  Audit,
  CatalogSource,
  Forecast,
  GeoResult,
  Grid,
  RadarFrames,
  SatelliteLayer,
} from './types';

import { Capacitor } from '@capacitor/core';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
/** No APK (ou com VITE_STANDALONE=1) o motor roda no próprio aparelho, sem servidor. */
export const STANDALONE = Capacitor.isNativePlatform() || import.meta.env.VITE_STANDALONE === '1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  if (STANDALONE) {
    const { localApi } = await import('../engine/service');
    try {
      return (await localApi(path, Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, String(v)])))) as T;
    } catch (e) {
      throw new ApiError(502, (e as Error).message);
    }
  }
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : '';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs}`, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor ATMOS');
  }
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const body = await res.json();
      const d = body?.detail;
      msg = typeof d === 'string' ? d : d?.message ? `${d.source}: ${d.message}` : msg;
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ~100 m: precisão suficiente para previsão; evita enviar a posição exata do GPS.
export const coarse = (v: number) => Math.round(v * 1000) / 1000;

export function useForecast(lat?: number, lon?: number) {
  return useQuery({
    queryKey: ['forecast', lat && coarse(lat), lon && coarse(lon)],
    queryFn: () => get<Forecast>('/api/forecast', { lat: coarse(lat!), lon: coarse(lon!) }),
    enabled: lat !== undefined && lon !== undefined,
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useRadarFrames(enabled = true) {
  return useQuery({
    queryKey: ['radar-frames'],
    queryFn: () => get<RadarFrames>('/api/radar/frames'),
    refetchInterval: 5 * 60 * 1000,
    enabled,
  });
}

export function useSatellite(layerId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['satellite', layerId],
    queryFn: () => get<SatelliteLayer>(`/api/satellite/${layerId}`),
    refetchInterval: 10 * 60 * 1000,
    enabled,
  });
}

export function useGrid(lat: number | undefined, lon: number | undefined, enabled: boolean) {
  const clat = lat === undefined ? undefined : Math.round(lat * 2) / 2;
  const clon = lon === undefined ? undefined : Math.round(lon * 2) / 2;
  return useQuery({
    queryKey: ['grid', clat, clon],
    queryFn: () => get<Grid>('/api/grid', { lat: clat!, lon: clon! }),
    enabled: enabled && clat !== undefined,
    staleTime: 60 * 60 * 1000,
    retry: 0,
  });
}

export function useAlertsGeo(enabled: boolean) {
  return useQuery({
    queryKey: ['alerts-geo'],
    queryFn: () => get<GeoJSON.FeatureCollection>('/api/alerts/geojson'),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

export function useAudit(lat?: number, lon?: number) {
  return useQuery({
    queryKey: ['audit', lat && coarse(lat), lon && coarse(lon)],
    queryFn: () => get<Audit>('/api/audit', { lat: coarse(lat!), lon: coarse(lon!) }),
    enabled: lat !== undefined,
    staleTime: 60 * 60 * 1000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: () => get<{ sources: CatalogSource[] }>('/api/sources'),
    staleTime: Infinity,
  });
}

export const geocode = (q: string) => get<{ results: GeoResult[]; errors?: string[] }>('/api/geocode', { q });
export const reverse = (lat: number, lon: number) =>
  get<{ label: string | null }>('/api/reverse', { lat: coarse(lat), lon: coarse(lon) });
export const deleteServerData = async (lat: number, lon: number) => {
  if (STANDALONE) return get<{ deletedRows: number }>('/api/privacy', { lat, lon });
  const res = await fetch(`${BASE}/api/privacy?lat=${coarse(lat)}&lon=${coarse(lon)}`, { method: 'DELETE' });
  if (!res.ok) throw new ApiError(res.status, 'Falha ao apagar');
  return res.json() as Promise<{ deletedRows: number }>;
};
