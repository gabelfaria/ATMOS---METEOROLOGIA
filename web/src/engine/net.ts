// Rede do motor local: cache TTL em memória + cópia antiga se a fonte falhar (stale-if-error).
// No app Android, fontes sem CORS (METAR) e as que exigem User-Agent (Nominatim) usam HTTP nativo.

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export class SourceError extends Error {
  source: string;
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.source = source;
    this.message = message;
  }
}

export interface Fetched<T> {
  value: T;
  fetchedAt: number; // epoch s
  stale: boolean;
}

interface Entry {
  value: unknown;
  at: number;
  ttl: number;
}

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<Fetched<unknown>>>();
const MAX_STALE = 6 * 3600;

export const isNative = () => Capacitor.isNativePlatform();

function key(url: string, params?: Record<string, string | number>) {
  return params ? `${url}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : url;
}

async function rawGet(source: string, url: string, kind: 'json' | 'text' | 'blob', native: boolean): Promise<unknown> {
  // No Android, todo JSON/texto vai pelo HTTP nativo: status real (ex.: 429) e sem depender de CORS.
  if ((native || kind !== 'blob') && isNative()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { 'User-Agent': 'ATMOS-Weather/0.2 (Android; github.com/gabelfaria/ATMOS---METEOROLOGIA)', Accept: 'application/json' },
      responseType: kind === 'json' ? 'json' : 'text',
      connectTimeout: 20000,
      readTimeout: 20000,
    });
    if (res.status === 429) throw new SourceError(source, 'limite de requisições atingido (HTTP 429)');
    if (res.status >= 400) throw new SourceError(source, `HTTP ${res.status}`);
    return kind === 'json' && typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new SourceError(
      source,
      (e as Error).name === 'AbortError' ? 'sem resposta em 20 s' : 'sem resposta (sem internet ou a fonte recusou — possível limite de uso)',
    );
  } finally {
    clearTimeout(t);
  }
  if (res.status === 429) throw new SourceError(source, 'limite de requisições atingido (HTTP 429)');
  if (!res.ok) {
    let reason = '';
    try {
      reason = (await res.json()).reason ?? '';
    } catch {
      /* sem corpo */
    }
    throw new SourceError(source, `HTTP ${res.status} ${reason}`.trim());
  }
  if (kind === 'json') {
    const v = await res.json();
    if (v && typeof v === 'object' && !Array.isArray(v) && v.error) throw new SourceError(source, String(v.reason ?? 'erro'));
    return v;
  }
  return kind === 'text' ? res.text() : res.blob();
}

export async function get<T>(
  source: string,
  url: string,
  params?: Record<string, string | number>,
  opts: { ttl?: number; kind?: 'json' | 'text' | 'blob'; native?: boolean } = {},
): Promise<Fetched<T>> {
  const { ttl = 600, kind = 'json', native = false } = opts;
  const k = key(url, params);
  const now = Date.now() / 1000;
  const e = mem.get(k);
  if (e && now - e.at < e.ttl) return { value: e.value as T, fetchedAt: e.at, stale: false };
  const running = inflight.get(k);
  if (running) return running as Promise<Fetched<T>>;
  const p = (async () => {
    try {
      let value: unknown;
      try {
        value = await rawGet(source, k, kind, native);
      } catch (first) {
        await new Promise((r) => setTimeout(r, 1500));
        value = await rawGet(source, k, kind, native).catch(() => {
          throw first;
        });
      }
      const at = Date.now() / 1000;
      if (mem.size > 800) mem.delete(mem.keys().next().value!);
      mem.set(k, { value, at, ttl });
      return { value, fetchedAt: at, stale: false };
    } catch (err) {
      if (e && Date.now() / 1000 - e.at < MAX_STALE) return { value: e.value, fetchedAt: e.at, stale: true };
      throw err instanceof SourceError ? err : new SourceError(source, String(err));
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p as Promise<Fetched<T>>;
}

export function clearCache() {
  mem.clear();
}

/** Ao puxar para atualizar: descarta dados de curta duração (radar, estações, alertas, condição atual),
 *  mantendo as rodadas de modelo (que só mudam a cada poucas horas) para poupar a cota das APIs. */
export function expireShortLived() {
  for (const [k, e] of mem) if (e.ttl <= 900) mem.delete(k);
}
