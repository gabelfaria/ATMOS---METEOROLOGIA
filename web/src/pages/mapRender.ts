// Renderização de campos para o mapa (imagens para fontes `image` do MapLibre).
import type { Grid } from '../api/types';
import { RADAR_COLORS } from '../engine/radarColors';
import type { LegendStop } from './mapLayers';

type Corners = [[number, number], [number, number], [number, number], [number, number]];

const radarLut = new Map<number, [number, number, number, number]>();
RADAR_COLORS.forEach(([dbz, rgb, a]) => radarLut.set(dbz, [rgb >> 16, (rgb >> 8) & 255, rgb & 255, a]));

/** Último quadro de radar (dBZ) → PNG com as mesmas cores do RainViewer. */
export function radarImageURL(dbz: Float32Array, size: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const col = radarLut.get(Math.round(dbz[i]));
    if (!col || dbz[i] < 10) continue;
    img.data.set(col, i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

function parseColor(c: string): [number, number, number, number] {
  if (c.startsWith('#')) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
  const m = /rgba?\(([^)]+)\)/.exec(c);
  const p = m ? m[1].split(',').map(Number) : [0, 0, 0, 1];
  return [p[0], p[1], p[2], Math.round((p[3] ?? 1) * 255)];
}

function colorAt(legend: LegendStop[], v: number): [number, number, number, number] {
  const stops = legend.map((s) => ({ v: s.v, c: parseColor(s.c) }));
  if (v <= stops[0].v) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i].v) {
      const t = (v - stops[i - 1].v) / (stops[i].v - stops[i - 1].v);
      return stops[i].c.map((x, k) => Math.round(stops[i - 1].c[k] + t * (x - stops[i - 1].c[k]))) as [number, number, number, number];
    }
  }
  return stops[stops.length - 1].c;
}

/** Valor do ponto de grade no passo `idx` (chuva = acumulado das 3 h que terminam no passo). */
export function gridValue(values: Record<string, (number | null)[]>, v: string, idx: number): number | null {
  const s = values[v] ?? [];
  if (v === 'precipitation') {
    const w = [s[idx - 2], s[idx - 1], s[idx]];
    return w.every((x) => x !== null && x !== undefined) ? (w as number[]).reduce((a, b) => a + b, 0) : null;
  }
  return s[idx] ?? null;
}

/**
 * Campo de modelo como imagem suave: interpolação bilinear ENTRE pontos reais da grade 0,25°
 * (nada é extrapolado além dos pontos das bordas). Retorna a URL e os cantos da imagem.
 */
export function gridImage(grid: Grid, v: string, idx: number, legend: LegendStop[], hideBelow?: number): { url: string; coords: Corners } | null {
  const lats = [...new Set(grid.points.map((p) => p.lat))].sort((a, b) => b - a); // norte → sul
  const lons = [...new Set(grid.points.map((p) => p.lon))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2) return null;
  const val = new Map(grid.points.map((p) => [`${p.lat},${p.lon}`, gridValue(p.values, v, idx)]));
  const at = (i: number, j: number) => val.get(`${lats[i]},${lons[j]}`) ?? null;
  const W = 160;
  const H = 160;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const fi = (y / (H - 1)) * (lats.length - 1);
    const i0 = Math.min(Math.floor(fi), lats.length - 2);
    const ty = fi - i0;
    for (let x = 0; x < W; x++) {
      const fj = (x / (W - 1)) * (lons.length - 1);
      const j0 = Math.min(Math.floor(fj), lons.length - 2);
      const tx = fj - j0;
      const q = [at(i0, j0), at(i0, j0 + 1), at(i0 + 1, j0), at(i0 + 1, j0 + 1)];
      if (q.some((z) => z === null)) continue;
      const [a, b, cc, d] = q as number[];
      const value = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty;
      if (hideBelow !== undefined && value < hideBelow) continue;
      img.data.set(colorAt(legend, value), (y * W + x) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  const n = lats[0];
  const s = lats[lats.length - 1];
  const w = lons[0];
  const e = lons[lons.length - 1];
  return { url: c.toDataURL('image/png'), coords: [[w, n], [e, n], [e, s], [w, s]] };
}
