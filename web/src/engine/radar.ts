// Radar RainViewer + nowcasting por extrapolação (porta de rainviewer.py e nowcast/radar.py).
// Só quadros PASSADOS; nada de quadros futuros inventados. Passo real de 10 min.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Nowcast, RadarStep } from '../api/types';
import { compass8, lonLatToWorldPx, metersPerPx } from './geo';
import { get, SourceError } from './net';
import { RADAR_COLORS } from './radarColors';

export const ATTRIBUTION = 'Radar: RainViewer.com';
export const NO_DATA = -99;
const ECHO = 20;
const MOTION = 15;
const MIN_ECHO = 0.002;
const MAX_SHIFT = 30;
const LEADS = Array.from({ length: 12 }, (_, i) => (i + 1) * 10);
const ORDER = ['fraca', 'moderada', 'forte', 'muito forte'];

export async function fetchMaps() {
  const r = await get<any>('rainviewer', 'https://api.rainviewer.com/public/weather-maps.json', undefined, { ttl: 120 });
  const d = r.value;
  return {
    host: d.host ?? 'https://tilecache.rainviewer.com',
    generated: d.generated,
    frames: ((d.radar?.past ?? []) as any[]).map((f) => ({ time: f.time, path: f.path })),
    nowcastFrames: (d.radar?.nowcast ?? []).length,
    fetchedAt: r.fetchedAt,
    stale: r.stale,
  };
}

// --- decodificação: RGBA → dBZ pela tabela oficial
const lut = new Map<number, number>();
export function rgbaToDbz(r: number, g: number, b: number, a: number): number {
  if (a === 0) return NO_DATA;
  const k = ((r << 16) | (g << 8) | b) * 256 + a;
  const hit = lut.get(k);
  if (hit !== undefined) return hit;
  let best = NO_DATA;
  let bd = Infinity;
  for (const [dbz, rgb, al] of RADAR_COLORS) {
    const d = (r - (rgb >> 16)) ** 2 + (g - ((rgb >> 8) & 255)) ** 2 + (b - (rgb & 255)) ** 2 + (a - al) ** 2;
    if (d < bd) [bd, best] = [d, dbz];
  }
  lut.set(k, best);
  return best;
}

export function decodeRGBA(px: Uint8ClampedArray, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) out[i] = rgbaToDbz(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]);
  return out;
}

async function decodePng(blob: Blob): Promise<{ dbz: Float32Array; size: number }> {
  const bmp = await createImageBitmap(blob);
  const size = bmp.width;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = (canvas as any).getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  return { dbz: decodeRGBA(ctx.getImageData(0, 0, size, size).data, size), size };
}

export const rainRate = (dbz: number) => Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6); // Marshall–Palmer
export function rainClass(r: number | null): string | null {
  if (r === null || r < 0.5) return null;
  return r < 2.5 ? 'fraca' : r < 10 ? 'moderada' : r < 50 ? 'forte' : 'muito forte';
}

export class RadarImage {
  readonly kmPerPx: number;
  constructor(readonly dbz: Float32Array, readonly size: number, readonly lat: number, readonly lon: number, readonly zoom: number, readonly time: number) {
    this.kmPerPx = metersPerPx(lat, zoom, size) / 1000;
  }
  pixelOf(lat: number, lon: number): [number, number] {
    const [cx, cy] = lonLatToWorldPx(this.lon, this.lat, this.zoom, this.size);
    const [x, y] = lonLatToWorldPx(lon, lat, this.zoom, this.size);
    return [y - cy + this.size / 2, x - cx + this.size / 2];
  }
}

// --- FFT 2D (radix-2) para correlação de fase
function fft1(re: Float64Array, im: Float64Array, inv: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

function fft2(re: Float64Array, im: Float64Array, n: number, inv: boolean) {
  const rr = new Float64Array(n);
  const ri = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    rr.set(re.subarray(y * n, y * n + n));
    ri.set(im.subarray(y * n, y * n + n));
    fft1(rr, ri, inv);
    re.set(rr, y * n);
    im.set(ri, y * n);
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rr[y] = re[y * n + x];
      ri[y] = im[y * n + x];
    }
    fft1(rr, ri, inv);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rr[y];
      im[y * n + x] = ri[y];
    }
  }
}

/** Deslocamento (dy, dx) que leva `a` em `b` e nitidez do pico. */
export function phaseCorrelation(a: Float64Array, b: Float64Array, n: number): [number, number, number] {
  const han = new Float64Array(n).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const ar = new Float64Array(n * n);
  const br = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const w = han[y] * han[x];
    ar[y * n + x] = a[y * n + x] * w;
    br[y * n + x] = b[y * n + x] * w;
  }
  const ai = new Float64Array(n * n);
  const bi = new Float64Array(n * n);
  fft2(ar, ai, n, false);
  fft2(br, bi, n, false);
  for (let i = 0; i < n * n; i++) {
    const r = br[i] * ar[i] + bi[i] * ai[i];
    const im = bi[i] * ar[i] - br[i] * ai[i];
    const m = Math.hypot(r, im) + 1e-9;
    ar[i] = r / m;
    ai[i] = im / m;
  }
  fft2(ar, ai, n, true);
  let best = 0;
  let sumAbs = 0;
  for (let i = 0; i < n * n; i++) {
    sumAbs += Math.abs(ar[i]);
    if (ar[i] > ar[best]) best = i;
  }
  const py = Math.floor(best / n);
  const px = best % n;
  const at = (y: number, x: number) => ar[((y + n) % n) * n + ((x + n) % n)];
  const sub = (m: number, c: number, p: number) => {
    const d = m - 2 * c + p;
    return Math.abs(d) < 1e-12 ? 0 : (0.5 * (m - p)) / d;
  };
  let dy = py + sub(at(py - 1, px), at(py, px), at(py + 1, px));
  let dx = px + sub(at(py, px - 1), at(py, px), at(py, px + 1));
  if (dy > n / 2) dy -= n;
  if (dx > n / 2) dx -= n;
  return [dy, dx, ar[best] / (sumAbs / (n * n) + 1e-9)];
}

/** Campo para movimento reduzido 2× (max-pool) para caber num celular intermediário. */
function motionField(img: Float32Array, size: number, f: number): Float64Array {
  const n = size / f;
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let m = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) m = Math.max(m, img[(y * f + j) * size + x * f + i] - MOTION);
    out[y * n + x] = m;
  }
  return out;
}

const echoFrac = (img: Float32Array, thr: number) => {
  let c = 0;
  for (const v of img) if (v >= thr) c++;
  return c / img.length;
};

export function estimateMotion(frames: Float32Array[], times: number[], size: number) {
  const f = size >= 512 ? 2 : 1;
  const vectors: [number, number][] = [];
  const rejected: string[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    const dt = times[i] - times[i - 1];
    if (dt <= 0) continue;
    if (a.every((v, k) => v === b[k])) {
      rejected.push('quadro repetido');
      continue;
    }
    if (Math.min(echoFrac(a, MOTION), echoFrac(b, MOTION)) < MIN_ECHO) {
      rejected.push('poucos ecos');
      continue;
    }
    const [dy, dx, q] = phaseCorrelation(motionField(a, size, f), motionField(b, size, f), size / f);
    const s = (600 / dt) * f;
    const vy = dy * s;
    const vx = dx * s;
    if (Math.hypot(vy, vx) > MAX_SHIFT || q < 5) {
      rejected.push('correlação fraca');
      continue;
    }
    vectors.push([vy, vx]);
  }
  if (!vectors.length) return { valid: false as const, pairs: 0, rejected };
  const med = (k: 0 | 1) => {
    const s = vectors.map((v) => v[k]).sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const vy = med(0);
  const vx = med(1);
  const spread = vectors.length > 1 ? Math.sqrt(vectors.reduce((acc, [a, b]) => acc + (a - vy) ** 2 + (b - vx) ** 2, 0) / vectors.length) : null;
  return { valid: true as const, vy, vx, pairs: vectors.length, spreadPx: spread, rejected };
}

function diskMax(img: Float32Array, size: number, r0: number, c0: number, rad: number): number {
  let m = NO_DATA;
  for (let y = Math.max(Math.floor(r0 - rad), 0); y <= Math.min(Math.ceil(r0 + rad), size - 1); y++)
    for (let x = Math.max(Math.floor(c0 - rad), 0); x <= Math.min(Math.ceil(c0 + rad), size - 1); x++)
      if ((y - r0) ** 2 + (x - c0) ** 2 <= rad * rad) m = Math.max(m, img[y * size + x]);
  return m;
}

function extrapolate(last: RadarImage, row: number, col: number, vy: number, vx: number, factor: number) {
  return LEADS.map((lead) => {
    const st = (lead / 10) * factor;
    const r = row - vy * st;
    const c = col - vx * st;
    const inside = r >= 0 && c >= 0 && r < last.size && c < last.size;
    const d = inside ? diskMax(last.dbz, last.size, r, c, 2) : NO_DATA;
    return { lead, dbz: d <= NO_DATA ? null : d, inDomain: inside };
  });
}
const firstArrival = (s: { lead: number; dbz: number | null }[]) => s.find((x) => x.dbz !== null && x.dbz >= ECHO)?.lead ?? null;

export function analyze(frames: RadarImage[], lat: number, lon: number, now = Date.now() / 1000): Nowcast {
  const last = frames[frames.length - 1];
  const [row, col] = last.pixelOf(lat, lon);
  const km = last.kmPerPx;
  const age = (now - last.time) / 60;
  const observed: RadarStep[] = frames.map((f) => {
    const [r, c] = f.pixelOf(lat, lon);
    const d = diskMax(f.dbz, f.size, r, c, 2);
    const dbz = d <= NO_DATA ? null : d;
    const rate = dbz !== null && dbz >= ECHO ? rainRate(dbz) : 0;
    return { time: f.time, dbz, rateMmH: Math.round(rate * 10) / 10, class: rainClass(rate) };
  });
  const current = observed[observed.length - 1];
  const ef = echoFrac(last.dbz, ECHO);
  let nearest: Nowcast['nearestEcho'] = null;
  let bd = Infinity;
  for (let i = 0; i < last.dbz.length; i++) {
    if (last.dbz[i] < ECHO) continue;
    const y = Math.floor(i / last.size);
    const x = i % last.size;
    const d2 = (y - row) ** 2 + (x - col) ** 2;
    if (d2 < bd) {
      bd = d2;
      const b = ((Math.atan2(x - col, -(y - row)) * 180) / Math.PI + 360) % 360;
      nearest = { distanceKm: Math.round(Math.sqrt(d2) * km * 10) / 10, direction: compass8(b), bearing: Math.round(b) };
    }
  }
  const recent = frames.slice(-7);
  const motion = estimateMotion(recent.map((f) => f.dbz), recent.map((f) => f.time), last.size);
  const res: Nowcast = {
    available: true,
    method: 'Extrapolação por translação (correlação de fase) sobre mosaico RainViewer',
    resolutionKm: Math.round(km * 100) / 100,
    domainRadiusKm: Math.round((last.size / 2) * km),
    stepMinutes: 10,
    latestFrameTime: last.time,
    dataAgeMinutes: Math.round(age),
    observed,
    current,
    echoFraction: Math.round(ef * 1e4) / 1e4,
    nearestEcho: nearest,
    motion: null,
    forecast: [],
    arrival: null,
    limitations: [
      'Não prevê formação ou dissipação de novas células de chuva.',
      'Assume deslocamento uniforme (translação) em todo o domínio.',
      'O horário dos quadros RainViewer é o de geração do mosaico.',
    ],
  };
  if (motion.valid) {
    const { vy, vx } = motion;
    const toward = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360;
    res.motion = {
      speedKmh: Math.round(Math.hypot(vy, vx) * km * 6), towardDeg: Math.round(toward), toward: compass8(toward), from: compass8(toward + 180),
      pairs: motion.pairs, spreadKmh: motion.spreadPx === null ? null : Math.round(motion.spreadPx * km * 6), rejected: motion.rejected,
    };
    const central = extrapolate(last, row, col, vy, vx, 1);
    res.forecast = central.map((s) => {
      const rate = s.dbz !== null && s.dbz >= ECHO ? rainRate(s.dbz) : 0;
      return { lead: s.lead, time: last.time + s.lead * 60, dbz: s.dbz, rateMmH: Math.round(rate * 10) / 10, class: rainClass(rate), inDomain: s.inDomain };
    });
    let ac = firstArrival(central);
    const af = firstArrival(extrapolate(last, row, col, vy, vx, 1.25));
    const as = firstArrival(extrapolate(last, row, col, vy, vx, 0.75));
    if (ac !== null && current.dbz !== null && current.dbz >= ECHO) ac = null;
    if (ac !== null) {
      let dur = 0;
      for (const s of res.forecast) {
        if (s.lead < ac) continue;
        if (!s.class) break;
        dur += 10;
      }
      const wet = res.forecast.filter((s) => s.lead >= ac! && s.class).map((s) => s.class!);
      const early = Math.min(...[af, ac].filter((x): x is number => x !== null));
      const late = as !== null && as >= ac ? as : null;
      res.arrival = {
        centralMinutes: Math.max(Math.round(ac - age), 0),
        earliestMinutes: Math.max(Math.round(early - age), 0),
        latestMinutes: late === null ? null : Math.max(Math.round(late - age), 0),
        durationMinutes: dur,
        durationTruncated: ac + dur > 120,
        maxClass: wet.length ? wet.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a)) : null,
        from: res.motion.from,
      };
    }
  }
  const reasons: string[] = [];
  let level: 'low' | 'moderate' = 'low';
  if (age > 40) reasons.push(`Último quadro de radar tem ${Math.round(age)} min`);
  else {
    if (current.class) reasons.push('Chuva detectada pelo radar sobre o ponto agora');
    if (ef < MIN_ECHO) {
      reasons.push(`Sem ecos de chuva relevantes num raio de ~${res.domainRadiusKm} km`, 'Radar não antecipa células que ainda vão se formar');
      level = 'moderate';
    } else if (!motion.valid) reasons.push('Não foi possível estimar o deslocamento das células');
    else {
      const sp = res.motion!.spreadKmh;
      if (motion.pairs >= 3 && sp !== null && sp <= Math.max(10, 0.5 * res.motion!.speedKmh)) {
        reasons.push(`Deslocamento consistente em ${motion.pairs} pares de quadros`);
        level = 'moderate';
      } else reasons.push('Deslocamento pouco consistente entre quadros');
      if (res.arrival && res.arrival.centralMinutes > 60) {
        reasons.push('Chegada estimada além de 60 min: incerteza maior');
        level = 'low';
      }
    }
  }
  res.confidence = level;
  res.confidenceReasons = reasons;
  return res;
}

export async function coverageAt(lat: number, lon: number, host: string) {
  const url = `${host}/v2/coverage/0/256/7/${lat.toFixed(4)}/${lon.toFixed(4)}/0/0_0.png`;
  const r = await get<Blob>('rainviewer-coverage', url, undefined, { ttl: 7 * 86400, kind: 'blob' });
  const bmp = await createImageBitmap(r.value);
  const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, 256, 256).data;
  const frac = (r0: number) => {
    let n = 0;
    let c = 0;
    for (let y = 128 - r0; y < 128 + r0; y++) for (let x = 128 - r0; x < 128 + r0; x++) {
      n++;
      if (px[(y * 256 + x) * 4 + 3] < 128) c++;
    }
    return c / n;
  };
  const p = frac(2);
  return { covered: p >= 0.5, pointFraction: p, areaFraction: frac(40) };
}

export async function nowcast(lat: number, lon: number): Promise<Nowcast & { stale?: boolean }> {
  let maps;
  try {
    maps = await fetchMaps();
  } catch (e) {
    return { available: false, reason: `RainViewer indisponível: ${(e as SourceError).message}` };
  }
  if (!maps.frames.length) return { available: false, reason: 'RainViewer não retornou quadros de radar' };
  let cov;
  try {
    cov = await coverageAt(lat, lon, maps.host);
  } catch (e) {
    return { available: false, reason: `Não foi possível verificar a cobertura: ${(e as Error).message}` };
  }
  if (!cov.covered) return { available: false, coverage: cov, reason: 'Sem cobertura de radar no RainViewer para esta localização' };
  const clat = Math.round(lat * 4) / 4;
  const clon = Math.round(lon * 4) / 4;
  const settled = await Promise.allSettled(
    maps.frames.map(async (f) => {
      const url = `${maps.host}${f.path}/512/6/${clat.toFixed(4)}/${clon.toFixed(4)}/2/0_0.png`;
      const r = await get<Blob>('rainviewer-tiles', url, undefined, { ttl: 3 * 3600, kind: 'blob' });
      const { dbz, size } = await decodePng(r.value);
      return new RadarImage(dbz, size, clat, clon, 6, f.time);
    }),
  );
  const frames = settled.filter((s): s is PromiseFulfilledResult<RadarImage> => s.status === 'fulfilled').map((s) => s.value);
  if (frames.length < 2) return { available: false, coverage: cov, reason: 'Quadros de radar insuficientes' };
  const res = analyze(frames, lat, lon);
  res.coverage = cov;
  if (cov.areaFraction < 0.8) {
    res.confidence = 'low';
    res.confidenceReasons!.push('Cobertura de radar parcial no entorno');
  }
  return { ...res, stale: maps.stale };
}
