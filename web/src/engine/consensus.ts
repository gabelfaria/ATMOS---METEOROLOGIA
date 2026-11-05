// Consenso entre modelos + probabilidades de ensembles (porta de engine/consensus.py).
import type { Block, Confidence, Day, HourRow, ModelRow, Range } from '../api/types';
import { DETERMINISTIC_MODELS, ENSEMBLE_NAME, MODEL_BY_ID, type Ensemble, type MultiModel, type Series } from './openmeteo';
import { circularMeanDeg, r1, weightedMedian, weightedQuantile, weightedStd } from './stats';

export const BLOCK = 3 * 3600;
export const P_ANY = 0.5;
export const P_MOD = 7.5;
export const P_HEAVY = 30;
export const GUST_STRONG = 60;
export const CAPE_STORM = 1000;

export type Weights = Record<string, { weight: number; normalized: number; reasons: string[] }>;
export type Skill = Record<string, { temperatureMae: number; n: number }>;

export function modelWeights(available: string[], skill: Skill = {}): Weights {
  const fam: Record<string, number> = {};
  available.forEach((m) => (fam[MODEL_BY_ID[m].family] = (fam[MODEL_BY_ID[m].family] ?? 0) + 1));
  const maes = Object.values(skill).filter((s) => s.n >= 48).map((s) => s.temperatureMae).sort((a, b) => a - b);
  const ref = maes.length ? maes[maes.length >> 1] : null;
  const out: Weights = {};
  for (const id of available) {
    const info = MODEL_BY_ID[id];
    const reasons: string[] = [];
    const prior = info.resolutionKm <= 13 ? 1 : info.resolutionKm <= 16 ? 0.85 : 0.65;
    reasons.push(`resolução ~${info.resolutionKm} km → ${prior.toFixed(2)}`);
    const dep = 1 / fam[info.family];
    if (dep < 1) reasons.push(`mesma família de outro modelo (${info.family}) → ×${dep.toFixed(2)}`);
    let perf = 1;
    const s = skill[id];
    if (s && ref && s.n >= 48 && s.temperatureMae) {
      perf = Math.max(0.5, Math.min(1.5, ref / s.temperatureMae));
      reasons.push(`desempenho local (EAM ${s.temperatureMae.toFixed(1)} °C, n=${s.n}) → ×${perf.toFixed(2)}`);
    } else reasons.push('sem amostra local suficiente → desempenho neutro');
    out[id] = { weight: r1(prior * dep * perf, 3), normalized: 0, reasons };
  }
  const tot = Object.values(out).reduce((a, b) => a + b.weight, 0) || 1;
  Object.values(out).forEach((v) => (v.normalized = r1(v.weight / tot, 3)));
  return out;
}

export const availableModels = (mm: MultiModel) =>
  DETERMINISTIC_MODELS.filter((m) => (mm.models[m.id]?.temperature_2m ?? []).some((v) => v !== null)).map((m) => m.id);

export const blockStart = (t: number) => Math.floor((t - 3600) / BLOCK) * BLOCK;

const FIELDS: Record<string, string> = {
  temperature: 'temperature_2m', apparentTemperature: 'apparent_temperature', humidity: 'relative_humidity_2m', cloudCover: 'cloud_cover',
  visibility: 'visibility', pressure: 'pressure_msl', windSpeed: 'wind_speed_10m', windGust: 'wind_gusts_10m', cape: 'cape',
};

export function hourlyConsensus(mm: MultiModel, w: Weights, start: number, end: number): HourRow[] {
  const out: HourRow[] = [];
  mm.times.forEach((t, i) => {
    if (t < start || t > end) return;
    const row: Record<string, unknown> = { time: t };
    for (const [field, v] of Object.entries(FIELDS)) {
      const vals: number[] = [];
      const ws: number[] = [];
      for (const [m, x] of Object.entries(w)) {
        const val = mm.models[m]?.[v]?.[i];
        if (val !== null && val !== undefined) {
          vals.push(val);
          ws.push(x.weight);
        }
      }
      if (!vals.length) {
        row[field] = null;
        continue;
      }
      const k = field === 'visibility' ? 1 / 1000 : 1;
      const med = weightedMedian(vals, ws);
      const rg: Range = {
        value: med === null ? null : r1(med * k), min: r1(Math.min(...vals) * k), max: r1(Math.max(...vals) * k),
        spread: vals.length < 2 ? null : r1((weightedStd(vals, ws) ?? 0) * k), n: vals.length,
      };
      row[field] = rg;
    }
    const dirs: number[] = [];
    const dws: number[] = [];
    for (const [m, x] of Object.entries(w)) {
      const d = mm.models[m]?.wind_direction_10m?.[i];
      if (d !== null && d !== undefined) {
        dirs.push(d);
        dws.push(x.weight);
      }
    }
    const d = circularMeanDeg(dirs, dws);
    row.windDirection = d === null ? null : Math.round(d);
    out.push(row as unknown as HourRow);
  });
  return out;
}

function blockSums(times: number[], s: Series | undefined, start: number, end: number) {
  const acc = new Map<number, (number | null)[]>();
  if (!s) return new Map<number, number | null>();
  times.forEach((t, i) => {
    if (t <= start || t > end + BLOCK) return;
    const b = blockStart(t);
    if (!acc.has(b)) acc.set(b, []);
    acc.get(b)!.push(s[i] ?? null);
  });
  const out = new Map<number, number | null>();
  acc.forEach((vs, b) => out.set(b, vs.length === 3 && vs.every((v) => v !== null) ? r1((vs as number[]).reduce((a, c) => a + c, 0), 2) : null));
  return out;
}

function blockMax(times: number[], s: Series | undefined, start: number, end: number) {
  const out = new Map<number, number>();
  if (!s) return out;
  times.forEach((t, i) => {
    const v = s[i];
    if (t <= start || t > end + BLOCK || v === null || v === undefined) return;
    const b = blockStart(t);
    out.set(b, Math.max(out.get(b) ?? -Infinity, v));
  });
  return out;
}

export function precipBlocks(mm: MultiModel | null, ens: Ensemble | null, w: Weights, start: number, end: number): Block[] {
  const ids = Object.keys(w);
  const det = Object.fromEntries(ids.map((m) => [m, blockSums(mm!.times, mm!.models[m]?.precipitation, start, end)]));
  const cape = Object.fromEntries(ids.map((m) => [m, blockMax(mm!.times, mm!.models[m]?.cape, start, end)]));
  const gust = Object.fromEntries(ids.map((m) => [m, blockMax(mm!.times, mm!.models[m]?.wind_gusts_10m, start, end)]));
  const eb: Record<string, { p: Map<number, number | null>[]; g: Map<number, number>[] }> = {};
  if (ens)
    for (const [id, vs] of Object.entries(ens.ensembles))
      eb[id] = { p: (vs.precipitation ?? []).map((m) => blockSums(ens.times, m, start, end)), g: (vs.wind_gusts_10m ?? []).map((m) => blockMax(ens.times, m, start, end)) };
  const starts = new Set<number>();
  Object.values(det).forEach((d) => d.forEach((_, b) => starts.add(b)));
  Object.values(eb).forEach((e) => e.p.forEach((m) => m.forEach((_, b) => starts.add(b))));
  const med = (pairs: [number, number][]) => weightedMedian(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
  const out: Block[] = [];
  for (const b of [...starts].sort((x, y) => x - y)) {
    if (b + BLOCK <= start || b > end) continue;
    const byModel = Object.fromEntries(ids.map((m) => [m, det[m].get(b) ?? null]));
    const vals = ids.filter((m) => byModel[m] !== null).map((m) => [byModel[m] as number, w[m].weight] as [number, number]);
    const tot = vals.reduce((s, [, x]) => s + x, 0);
    const wet = vals.filter(([v]) => v >= P_ANY).reduce((s, [, x]) => s + x, 0);
    const cv = ids.filter((m) => cape[m].has(b)).map((m) => [cape[m].get(b)!, w[m].weight] as [number, number]);
    const gv = ids.filter((m) => gust[m].has(b)).map((m) => [gust[m].get(b)!, w[m].weight] as [number, number]);
    const probs: Block['ensemble'] = {};
    for (const [id, e] of Object.entries(eb)) {
      const mem = e.p.map((m) => m.get(b)).filter((v): v is number => v !== null && v !== undefined);
      const gm = e.g.map((m) => m.get(b)).filter((v): v is number => v !== undefined);
      if (mem.length < 10) continue;
      const n = mem.length;
      const ones = mem.map(() => 1);
      probs[id] = {
        members: n, pAny: r1(mem.filter((v) => v >= P_ANY).length / n, 2), pModerate: r1(mem.filter((v) => v >= P_MOD).length / n, 2),
        pHeavy: r1(mem.filter((v) => v >= P_HEAVY).length / n, 2), p50: r1(weightedQuantile(mem, ones, 0.5) ?? 0), p90: r1(weightedQuantile(mem, ones, 0.9) ?? 0),
        pGustStrong: gm.length < 10 ? null : r1(gm.filter((v) => v >= GUST_STRONG).length / gm.length, 2),
      };
    }
    const ps = Object.values(probs);
    const avg = (f: (p: (typeof ps)[number]) => number) => (ps.length ? r1(ps.reduce((s, p) => s + f(p), 0) / ps.length, 2) : null);
    const g = ps.map((p) => p.pGustStrong).filter((x): x is number => x !== null);
    out.push({
      start: b, end: b + BLOCK, precipByModel: byModel,
      precipMedian: vals.length ? r1(med(vals)!) : null, precipMax: vals.length ? r1(Math.max(...vals.map((v) => v[0]))) : null,
      modelAgreementWet: tot ? r1(wet / tot, 2) : null, modelsCount: vals.length,
      capeMedian: cv.length ? Math.round(med(cv)!) : null, gustMedian: gv.length ? Math.round(med(gv)!) : null,
      gustMax: gv.length ? Math.round(Math.max(...gv.map((v) => v[0]))) : null, ensemble: probs,
      rainProbability: avg((p) => p.pAny), moderateProbability: avg((p) => p.pModerate), heavyProbability: avg((p) => p.pHeavy),
      gustStrongProbability: g.length ? r1(g.reduce((a, c) => a + c, 0) / g.length, 2) : null,
      probabilitySpread: ps.length ? r1(Math.max(...ps.map((p) => p.pAny)) - Math.min(...ps.map((p) => p.pAny)), 2) : null,
    });
  }
  return out;
}

export function modelAgreement(mm: MultiModel, hours: HourRow[], blocks: Block[], w: Weights): ModelRow[] {
  const idx = new Map(mm.times.map((t, i) => [t, i]));
  const cons = blocks.reduce((s, b) => s + (b.precipMedian ?? 0), 0);
  return Object.entries(w).map(([id, x]) => {
    const info = MODEL_BY_ID[id];
    const temps: number[] = [];
    const diffs: number[] = [];
    const gusts: number[] = [];
    for (const h of hours) {
      const i = idx.get(h.time);
      if (i === undefined) continue;
      const v = mm.models[id]?.temperature_2m?.[i];
      const g = mm.models[id]?.wind_gusts_10m?.[i];
      if (v !== null && v !== undefined) {
        temps.push(v);
        if (h.temperature?.value !== null && h.temperature?.value !== undefined) diffs.push(Math.abs(v - h.temperature.value));
      }
      if (g !== null && g !== undefined) gusts.push(g);
    }
    if (!temps.length) return { model: id, name: info.name, provider: info.provider, available: false, agreement: null };
    const pv = blocks.map((b) => b.precipByModel[id]).filter((v): v is number => v !== null && v !== undefined);
    const total = pv.length ? r1(pv.reduce((a, c) => a + c, 0)) : null;
    const td = diffs.length ? diffs.reduce((a, c) => a + c, 0) / diffs.length : null;
    const pOk = total !== null && ((total < 1 && cons < 1) || Math.abs(total - cons) <= Math.max(5, 0.5 * Math.max(total, cons)));
    const agreement = td !== null && td <= 1 && pOk ? 'concorda' : (td !== null && td <= 2) || pOk ? 'parcial' : 'diverge';
    return {
      model: id, name: info.name, provider: info.provider, resolutionKm: info.resolutionKm, available: true, hoursCovered: temps.length,
      tempMax: r1(Math.max(...temps)), tempMin: r1(Math.min(...temps)), precipTotal: total, gustMax: gusts.length ? Math.round(Math.max(...gusts)) : null,
      meanAbsDiffFromConsensus: td === null ? null : r1(td), agreement, weight: x.normalized, weightReasons: x.reasons,
    } as ModelRow;
  });
}

export function riskWindows(blocks: Block[]) {
  const out: { start: number; end: number; kind: string; reasons: string[] }[] = [];
  for (const b of blocks) {
    const reasons: string[] = [];
    let kind: string | null = null;
    if ((b.heavyProbability ?? 0) >= 0.2) {
      kind = 'chuva forte';
      reasons.push(`${Math.round(b.heavyProbability! * 100)}% dos membros de ensemble com ≥${P_HEAVY} mm/3 h`);
    } else if ((b.moderateProbability ?? 0) >= 0.3) {
      kind = 'chuva moderada';
      reasons.push(`${Math.round(b.moderateProbability! * 100)}% dos membros de ensemble com ≥${P_MOD} mm/3 h`.replace('.', ','));
    }
    if ((b.capeMedian ?? 0) >= CAPE_STORM && (b.modelAgreementWet ?? 0) >= 0.5) {
      kind ??= 'tempestade';
      reasons.push(`CAPE mediano ${b.capeMedian} J/kg com chuva na maioria dos modelos`);
    }
    if ((b.gustStrongProbability ?? 0) >= 0.3) {
      kind ??= 'rajadas';
      reasons.push(`${Math.round(b.gustStrongProbability! * 100)}% dos membros com rajadas ≥${GUST_STRONG} km/h`);
    }
    if (kind) out.push({ start: b.start, end: b.end, kind, reasons });
  }
  return out;
}

export function dailyEnsemble(ens: Ensemble, todayStart: number): Day[] {
  const days: Day[] = [];
  const VARS = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_gusts_10m_max'];
  ens.times.forEach((t, i) => {
    const pooled: Record<string, [number[], number[]]> = {};
    const systems: Day['systems'] = {};
    for (const [id, vs] of Object.entries(ens.ensembles)) {
      const sys: Record<string, number[]> = {};
      for (const v of VARS) {
        const mem = (vs[v] ?? []).map((m) => m[i]).filter((x): x is number => x !== null && x !== undefined);
        if (mem.length < 10) continue;
        sys[v] = mem;
        const p = (pooled[v] ??= [[], []]);
        p[0].push(...mem);
        p[1].push(...mem.map(() => 1 / mem.length)); // peso igual por sistema
      }
      if (Object.keys(sys).length) {
        const pr = sys.precipitation_sum;
        const tx = sys.temperature_2m_max;
        systems[id] = {
          name: ENSEMBLE_NAME[id] ?? id, members: Math.max(...Object.values(sys).map((x) => x.length)),
          tmaxMedian: tx ? r1(weightedMedian(tx, tx.map(() => 1))!) : null, precipMedian: pr ? r1(weightedMedian(pr, pr.map(() => 1))!) : null,
          pRain: pr ? r1(pr.filter((x) => x >= 1).length / pr.length, 2) : null,
        };
      }
    }
    if (!Object.keys(pooled).length) return;
    const q = (v: string, p: number, d = 1) => (pooled[v] ? r1(weightedQuantile(pooled[v][0], pooled[v][1], p)!, d) : null);
    const prob = (v: string, thr: number) => {
      if (!pooled[v]) return null;
      const [vs, ws] = pooled[v];
      return r1(vs.reduce((s, x, k) => s + (x >= thr ? ws[k] : 0), 0) / ws.reduce((a, c) => a + c, 0), 2);
    };
    const pr = Object.values(systems).map((s) => s.pRain).filter((x): x is number => x !== null);
    const tx = Object.values(systems).map((s) => s.tmaxMedian).filter((x): x is number => x !== null);
    const day: Day = {
      date: t, leadDays: Math.round((t - todayStart) / 86400),
      tmax: { p10: q('temperature_2m_max', 0.1), p50: q('temperature_2m_max', 0.5), p90: q('temperature_2m_max', 0.9) },
      tmin: { p10: q('temperature_2m_min', 0.1), p50: q('temperature_2m_min', 0.5), p90: q('temperature_2m_min', 0.9) },
      precip: { p10: q('precipitation_sum', 0.1), p50: q('precipitation_sum', 0.5), p90: q('precipitation_sum', 0.9), pAny: prob('precipitation_sum', 1), p10mm: prob('precipitation_sum', 10), p30mm: prob('precipitation_sum', 30) },
      gust: { p50: q('wind_gusts_10m_max', 0.5, 0), p90: q('wind_gusts_10m_max', 0.9, 0) },
      systems,
      divergence: { rainProbability: pr.length > 1 ? r1(Math.max(...pr) - Math.min(...pr), 2) : null, tmaxMedian: tx.length > 1 ? r1(Math.max(...tx) - Math.min(...tx)) : null },
      confidence: 'low', confidenceReasons: [],
    };
    [day.confidence, day.confidenceReasons] = longRangeConfidence(day);
    days.push(day);
  });
  return days;
}

const LV: Confidence[] = ['low', 'moderate', 'high'];

export function longRangeConfidence(d: Day): [Confidence, string[]] {
  const reasons = [`Prazo de ${d.leadDays} dia(s)`];
  let lv = d.leadDays <= 2 ? 2 : d.leadDays <= 7 ? 1 : 0;
  if (d.tmax.p90 !== null && d.tmax.p10 !== null) {
    const wd = d.tmax.p90 - d.tmax.p10;
    reasons.push(`Faixa P10–P90 da máxima: ${wd.toFixed(1)} °C`);
    if (wd > 5) lv--;
  }
  const dv = d.divergence.rainProbability;
  if (dv !== null) {
    reasons.push(`Divergência entre sistemas na chance de chuva: ${Math.round(dv * 100)} p.p.`);
    if (dv > 0.4) lv--;
  }
  if (Object.keys(d.systems).length < 2) {
    reasons.push('Apenas um sistema de ensemble disponível');
    lv--;
  }
  return [LV[Math.max(0, Math.min(lv, 2))], reasons];
}

export function mediumConfidence(leadH: number, spread: number | null, wet: number | null, pSpread: number | null): [Confidence, string[]] {
  const reasons = [`Prazo de ${Math.round(leadH)} h`];
  let lv = leadH <= 24 ? 2 : 1;
  if (spread !== null) {
    reasons.push(`Dispersão de temperatura entre modelos: ${spread.toFixed(1)} °C`);
    if (spread > 2) lv--;
  }
  if (wet !== null && wet >= 0.3 && wet <= 0.7) {
    reasons.push('Modelos divididos sobre a ocorrência de chuva');
    lv--;
  }
  if (pSpread !== null && pSpread > 0.4) {
    reasons.push('Ensembles discordam sobre a chance de chuva');
    lv--;
  }
  return [LV[Math.max(0, Math.min(lv, 2))], reasons];
}
