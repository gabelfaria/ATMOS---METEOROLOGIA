/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import ensD from '../../../../backend/tests/fixtures/ens_daily.json';
import ensH from '../../../../backend/tests/fixtures/ensh.json';
import metar from '../../../../backend/tests/fixtures/metar.json';
import multi from '../../../../backend/tests/fixtures/multi.json';
import * as C from '../consensus';
import { normalizeMetar, parseWx } from '../obs';
import { DETERMINISTIC_MODELS, HOURLY_VARS, parseEnsemble, splitByModel, type MultiModel } from '../openmeteo';
import { analyze, estimateMotion, NO_DATA, phaseCorrelation, RadarImage, rainClass, rainRate, rgbaToDbz } from '../radar';
import { buildVerdict } from '../verdict';

// Fixtures gravadas com horários ISO locais → epoch (como pedimos em produção)
function unix(p: any, block: string) {
  const off = p.utc_offset_seconds ?? 0;
  return (p[block].time as string[]).map((s) => Date.parse(s.length === 10 ? s + 'T00:00Z' : s + 'Z') / 1000 - off);
}
function mm(): MultiModel {
  const h: any = { ...(multi as any).hourly };
  for (const k of Object.keys(h)) if (k.endsWith('_ecmwf_ifs025')) h[k.replace('_ecmwf_ifs025', '_ecmwf_ifs')] = h[k];
  return { times: unix(multi, 'hourly'), models: splitByModel(h, HOURLY_VARS, DETERMINISTIC_MODELS.map((m) => m.id)), timezone: 'America/Sao_Paulo', utcOffsetSeconds: -10800, gridLat: null, gridLon: null, elevation: null, fetchedAt: 0, stale: false };
}
const ens = (raw: any, block: string, vars: string[]) => ({ times: unix(raw, block), ensembles: parseEnsemble(raw[block], vars), timezone: raw.timezone, fetchedAt: 0, stale: false });

describe('Open-Meteo', () => {
  it('separa membros por sistema de ensemble', () => {
    const e = parseEnsemble((ensH as any).hourly, ['precipitation', 'wind_gusts_10m']);
    expect(Object.keys(e).sort()).toEqual(['ecmwf_ifs025', 'gfs025', 'icon_seamless']);
    expect(e.ecmwf_ifs025.precipitation.length).toBe(51);
    expect(e.gfs025.precipitation.length).toBe(31);
    expect(e.icon_seamless.precipitation.length).toBe(40);
  });
});

describe('consenso', () => {
  const m = mm();
  const w = C.modelWeights(C.availableModels(m));
  it('pesos normalizados e mediana dentro da faixa', () => {
    expect(Object.values(w).reduce((s, x) => s + x.normalized, 0)).toBeCloseTo(1, 1);
    const h = C.hourlyConsensus(m, w, m.times[0], m.times[24])[5];
    expect(h.temperature!.min).toBeLessThanOrEqual(h.temperature!.value!);
    expect(h.temperature!.value!).toBeLessThanOrEqual(h.temperature!.max);
  });
  it('desempenho local só altera pesos com amostra suficiente', () => {
    const big = C.modelWeights(['ecmwf_ifs', 'gfs_seamless'], { ecmwf_ifs: { temperatureMae: 1, n: 100 }, gfs_seamless: { temperatureMae: 2, n: 100 } });
    const small = C.modelWeights(['ecmwf_ifs', 'gfs_seamless'], { ecmwf_ifs: { temperatureMae: 1, n: 10 }, gfs_seamless: { temperatureMae: 2, n: 10 } });
    expect(big.ecmwf_ifs.normalized).toBeGreaterThan(small.ecmwf_ifs.normalized);
    expect(small.ecmwf_ifs.normalized).toBe(0.5);
  });
  it('blocos de 3 h com probabilidades entre 0 e 1', () => {
    const e = ens(ensH, 'hourly', ['precipitation', 'wind_gusts_10m', 'temperature_2m']);
    const b = C.precipBlocks(m, e, w, m.times[0], m.times[0] + 48 * 3600);
    expect(b.length).toBeGreaterThan(5);
    for (const x of b) {
      expect(x.end - x.start).toBe(10800);
      for (const p of [x.rainProbability, x.heavyProbability]) if (p !== null) expect(p >= 0 && p <= 1).toBe(true);
    }
  });
  it('longo prazo: confiança baixa após 7 dias e quantis ordenados', () => {
    const e = ens(ensD, 'daily', ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_gusts_10m_max']);
    const days = C.dailyEnsemble(e, e.times[0]);
    expect(days.length).toBeGreaterThanOrEqual(10);
    for (const d of days) {
      if (d.leadDays > 7) expect(d.confidence).toBe('low');
      expect(d.tmax.p10!).toBeLessThanOrEqual(d.tmax.p50!);
      expect(d.tmax.p50!).toBeLessThanOrEqual(d.tmax.p90!);
    }
  });
});

describe('METAR', () => {
  it('interpreta tempo presente', () => {
    expect(parseWx('-RA VCTS')).toMatchObject({ precipAtStation: true, intensity: 'fraca', thunderVicinity: true, thunder: false });
    expect(parseWx('TSRA').description).toEqual(['trovoada com chuva moderada']);
    expect(parseWx('VCSH')).toMatchObject({ precipAtStation: false, precipVicinity: true });
  });
  it('converte unidades', () => {
    const o = normalizeMetar((metar as any)[0], -22.9, -43.2);
    expect(o.humidity!).toBeGreaterThan(0);
    expect(o.distanceKm).toBeLessThan(120);
  });
});

describe('radar', () => {
  const S = 128;
  const blob = (cy: number, cx: number) => {
    const a = new Float32Array(S * S).fill(NO_DATA);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = 45 * Math.exp(-((y - cy) ** 2 + (x - cx) ** 2) / 128);
      if (d >= 10) a[y * S + x] = d;
    }
    return a;
  };
  it('decodifica a cor oficial de 20 dBZ e converte em chuva', () => {
    expect(rgbaToDbz(0x00, 0xa3, 0xe0, 255)).toBe(20);
    expect(rgbaToDbz(0, 0, 0, 0)).toBe(NO_DATA);
    expect(rainRate(20)).toBeCloseTo(0.65, 1);
    expect(rainClass(5)).toBe('moderada');
  });
  it('correlação de fase recupera o deslocamento', () => {
    const f = (a: Float32Array) => Float64Array.from(a, (v) => Math.max(v - 15, 0));
    const [dy, dx] = phaseCorrelation(f(blob(50, 50)), f(blob(53, 56)), S);
    expect(Math.abs(dy - 3)).toBeLessThan(0.6);
    expect(Math.abs(dx - 6)).toBeLessThan(0.6);
  });
  it('quadros repetidos são rejeitados', () => {
    const b = blob(64, 30);
    expect(estimateMotion([b, b.slice(), b.slice()], [0, 600, 1200], S)).toMatchObject({ valid: false });
  });
  it('chuva vindo do oeste gera chegada; sem ecos não gera', () => {
    const frames = Array.from({ length: 7 }, (_, i) => new RadarImage(blob(S / 2, 22 + i * 2), S, -22.9, -43.2, 6, 1e6 + i * 600));
    const r = analyze(frames, -22.9, -43.2, frames[6].time);
    expect(r.motion?.from).toBe('oeste');
    expect(r.arrival).not.toBeNull();
    expect(r.arrival!.earliestMinutes).toBeLessThanOrEqual(r.arrival!.centralMinutes);
    const empty = Array.from({ length: 5 }, (_, i) => new RadarImage(new Float32Array(S * S).fill(NO_DATA), S, -22.9, -43.2, 6, 1e6 + i * 600));
    const r2 = analyze(empty, -22.9, -43.2, empty[4].time);
    expect(r2.arrival).toBeNull();
    expect(r2.confidenceReasons!.some((x) => x.includes('não antecipa'))).toBe(true);
  });
});

describe('veredito', () => {
  it('sem radar nunca inventa horário de chegada', () => {
    const v = buildVerdict({ now: 1e9, tz: -10800, nc: { available: false, reason: 'Sem cobertura' }, obs: null, blocks: [], official: [] });
    expect(v.estimatedArrivalMinutes).toBeNull();
    expect(v.text).toContain('indisponível');
    expect(v.confidence).toBe('low');
  });
});
