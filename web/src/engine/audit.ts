// Histórico local (no aparelho) + verificação contra METAR (porta de audit/store.py e verify.py).
import type { Audit, AuditLead, Observation } from '../api/types';
import { load, save } from '../lib/storage';
import { roundCell } from './geo';
import { fetchNearbyMetar, fetchStationHistory } from './obs';
import { fetchPreviousRuns } from './openmeteo';
import { brier, mae, r1 } from './stats';

const KEY = 'atmos:history';
interface Issue {
  cell: string;
  issuedAt: number;
  temps: [number, number, number][]; // [válido, prazo h, valor]
  probs: [number, number][]; // [início do bloco, prob]
  rain24h: number | null;
  maxProb24h: number | null;
  maxGust24h: number | null;
}
const cellKey = (lat: number, lon: number) => roundCell(lat, lon).join(',');

export function previousSummary(lat: number, lon: number, before: number) {
  const all = load<Issue[]>(KEY, []).filter((i) => i.cell === cellKey(lat, lon) && i.issuedAt <= before);
  const i = all.sort((a, b) => b.issuedAt - a.issuedAt)[0];
  return i ? { issuedAt: i.issuedAt, rain24h: i.rain24h, maxProb24h: i.maxProb24h } : null;
}

export function recordIssue(lat: number, lon: number, issue: Omit<Issue, 'cell'>) {
  const cell = cellKey(lat, lon);
  const all = load<Issue[]>(KEY, []);
  const last = all.filter((i) => i.cell === cell).reduce((m, i) => Math.max(m, i.issuedAt), 0);
  if (issue.issuedAt - last < 3600) return false;
  // mantém só 10 dias para não pesar no armazenamento
  const keep = all.filter((i) => issue.issuedAt - i.issuedAt < 10 * 86400);
  keep.push({ cell, ...issue });
  save(KEY, keep);
  return true;
}

function obsByHour(h: Observation[]) {
  const out = new Map<number, Observation>();
  for (const o of h) {
    const t = o.observedAt;
    const hr = Math.round(t / 3600) * 3600;
    if (Math.abs(t - hr) > 900) continue;
    const c = out.get(hr);
    if (!c || Math.abs(t - hr) < Math.abs(c.observedAt - hr)) out.set(hr, o);
  }
  return out;
}
function wetWindows(h: Observation[]) {
  const out = new Map<number, boolean>();
  for (const o of h) {
    const b = Math.floor(o.observedAt / 10800) * 10800;
    out.set(b, (out.get(b) ?? false) || o.weather.precipAtStation);
  }
  return out;
}

export function contingency(pairs: [boolean, boolean][]): AuditLead['precipitation'] {
  const hits = pairs.filter(([f, o]) => f && o).length;
  const misses = pairs.filter(([f, o]) => !f && o).length;
  const fa = pairs.filter(([f, o]) => f && !o).length;
  const cn = pairs.length - hits - misses - fa;
  const d = (a: number, b: number) => (b ? r1(a / b, 2) : null);
  return { hits, misses, falseAlarms: fa, correctNegatives: cn, n: pairs.length, pod: d(hits, hits + misses), far: d(fa, hits + fa), csi: d(hits, hits + misses + fa) };
}

const NAMES: Record<string, string> = { ecmwf_ifs025: 'ECMWF IFS (0,25°)', gfs_seamless: 'NOAA GFS', icon_seamless: 'DWD ICON', ukmo_seamless: 'UKMO Global', gem_seamless: 'ECCC GEM' };

export function bestModel(models: NonNullable<Audit['archive']>['models']): NonNullable<Audit['archive']>['best'] {
  const r = models.filter((m) => m.leads.day1.temperature.mae !== null).sort((a, b) => a.leads.day1.temperature.mae! - b.leads.day1.temperature.mae!);
  if (r.length < 2) return { declared: false, reason: 'Modelos insuficientes para comparação' };
  const n = r[0].leads.day1.temperature.n;
  const margin = r[1].leads.day1.temperature.mae! - r[0].leads.day1.temperature.mae!;
  if (n < 72) return { declared: false, reason: `Amostra de ${n} h é pequena (mínimo 72 h) para apontar um melhor modelo`, leader: r[0].model };
  if (margin < 0.3) return { declared: false, reason: `Diferença entre os dois primeiros (${margin.toFixed(2)} °C) é pequena demais`, leader: r[0].model };
  return { declared: true, model: r[0].model, name: r[0].name, reason: `Menor erro médio de temperatura (prazo 24–47 h) com margem de ${margin.toFixed(2)} °C, n=${n}` };
}

export async function auditForPoint(lat: number, lon: number): Promise<Audit> {
  let near;
  try {
    near = await fetchNearbyMetar(lat, lon);
  } catch (e) {
    return { available: false, reason: `Observações indisponíveis: ${(e as Error).message}` };
  }
  const st = near.stations.find((s) => s.distanceKm <= 60);
  if (!st) return { available: false, reason: 'Nenhuma estação METAR a até 60 km para verificação' };
  let hist: Observation[];
  let prev;
  try {
    [hist, prev] = await Promise.all([fetchStationHistory(st.station), fetchPreviousRuns(st.lat, st.lon)]);
  } catch (e) {
    return { available: false, reason: `Dados de verificação indisponíveis: ${(e as Error).message}` };
  }
  const now = Date.now() / 1000;
  const oh = obsByHour(hist);
  const wet = wetWindows(hist);
  const models = Object.entries(prev.models).map(([id, vs]) => {
    const lead = (tv: string, pv: string): AuditLead => {
      const errs: number[] = [];
      const blocks = new Map<number, (number | null)[]>();
      prev.times.forEach((t, i) => {
        if (t > now) return;
        const v = vs[tv]?.[i];
        const o = oh.get(Math.floor(t / 3600) * 3600);
        if (v !== null && v !== undefined && o && typeof o.temperature === 'number') errs.push(v - o.temperature);
        const b = Math.floor((t - 3600) / 10800) * 10800;
        if (!blocks.has(b)) blocks.set(b, []);
        blocks.get(b)!.push(vs[pv]?.[i] ?? null);
      });
      const pairs: [boolean, boolean][] = [];
      blocks.forEach((v, b) => {
        if (v.length === 3 && v.every((x) => x !== null) && wet.has(b)) pairs.push([(v as number[]).reduce((a, c) => a + c, 0) >= 0.5, wet.get(b)!]);
      });
      const m = mae(errs);
      return { temperature: { mae: m === null ? null : r1(m, 2), bias: errs.length ? r1(errs.reduce((a, c) => a + c, 0) / errs.length, 2) : null, n: errs.length }, precipitation: contingency(pairs) };
    };
    return { model: id, name: NAMES[id] ?? id, leads: { day1: lead('temperature_2m_previous_day1', 'precipitation_previous_day1'), day2: lead('temperature_2m_previous_day2', 'precipitation_previous_day2') } };
  }).filter((m) => m.leads.day1.temperature.n > 0 || m.leads.day2.temperature.n > 0);

  // previsões do próprio ATMOS guardadas neste aparelho
  const cell = cellKey(lat, lon);
  const mine = load<Issue[]>(KEY, []).filter((i) => i.cell === cell);
  const byLead: Record<string, number[]> = {};
  const bp: [number, number][] = [];
  for (const i of mine) {
    for (const [t, lh, v] of i.temps) {
      const o = oh.get(Math.floor(t / 3600) * 3600);
      if (!o || typeof o.temperature !== 'number' || t > now) continue;
      (byLead[lh <= 6 ? '0-6h' : lh <= 24 ? '7-24h' : '25-48h'] ??= []).push(v - o.temperature);
    }
    for (const [b, p] of i.probs) if (b + 10800 <= now && wet.has(b)) bp.push([p, wet.get(b) ? 1 : 0]);
  }
  const clim = bp.length ? bp.reduce((s, [, o]) => s + o, 0) / bp.length : null;
  const bs = brier(bp);
  const ref = clim === null ? null : brier(bp.map(([, o]) => [clim, o]));
  return {
    available: true,
    station: { station: st.station, name: st.name, lat: st.lat, lon: st.lon, distanceKm: st.distanceKm },
    observationsUsed: hist.length,
    periodStart: hist[0]?.observedAt,
    periodEnd: hist[hist.length - 1]?.observedAt,
    archive: { models, best: bestModel(models) },
    own: {
      temperature: Object.fromEntries(Object.entries(byLead).map(([k, v]) => [k, { mae: r1(mae(v)!, 2), n: v.length }])),
      rainProbability: { brier: bs === null ? null : r1(bs, 3), brierSkillVsSampleClimatology: bs !== null && ref ? r1(1 - bs / ref, 2) : null, n: bp.length },
    },
    notes: [
      'Observação: METAR (medição horária de aeroporto); previsão: ponto de grade mais próximo da estação.',
      'Chuva verificada em blocos de 3 h: METAR registra fenômeno presente, não acumulado em mm.',
      'Amostras curtas (dias) não representam desempenho climatológico.',
    ],
  };
}

export function skillForWeights(a: Audit) {
  const out: Record<string, { temperatureMae: number; n: number }> = {};
  if (!a.available || !a.archive) return out;
  for (const m of a.archive.models) {
    const t = m.leads.day1.temperature;
    const id = m.model === 'ecmwf_ifs025' ? 'ecmwf_ifs' : m.model;
    if (t.mae !== null) out[id] = { temperatureMae: t.mae, n: t.n };
  }
  return out;
}

export function deleteLocal(lat: number, lon: number) {
  const cell = cellKey(lat, lon);
  const all = load<Issue[]>(KEY, []);
  const keep = all.filter((i) => i.cell !== cell);
  save(KEY, keep);
  return all.length - keep.length;
}
