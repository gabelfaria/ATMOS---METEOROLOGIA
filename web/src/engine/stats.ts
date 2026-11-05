export function weightedQuantile(values: number[], weights: number[], q: number): number | null {
  const pairs = values.map((v, i) => [v, weights[i]] as [number, number]).filter(([v, w]) => v !== null && v !== undefined && w > 0);
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let cum = 0;
  const centers = pairs.map(([v, w]) => {
    const c: [number, number] = [(cum + w / 2) / total, v];
    cum += w;
    return c;
  });
  if (q <= centers[0][0]) return centers[0][1];
  if (q >= centers[centers.length - 1][0]) return centers[centers.length - 1][1];
  for (let i = 0; i < centers.length - 1; i++) {
    const [p0, v0] = centers[i];
    const [p1, v1] = centers[i + 1];
    if (p0 <= q && q <= p1) return v0 + (p1 === p0 ? 0 : (q - p0) / (p1 - p0)) * (v1 - v0);
  }
  return centers[centers.length - 1][1];
}

export const weightedMedian = (v: number[], w: number[]) => weightedQuantile(v, w, 0.5);

export function weightedStd(values: number[], weights: number[]): number | null {
  if (values.length < 2) return null;
  const tot = weights.reduce((a, b) => a + b, 0);
  const mean = values.reduce((s, v, i) => s + v * weights[i], 0) / tot;
  return Math.sqrt(values.reduce((s, v, i) => s + weights[i] * (v - mean) ** 2, 0) / tot);
}

export function circularMeanDeg(values: number[], weights: number[]): number | null {
  if (!values.length) return null;
  let s = 0;
  let c = 0;
  values.forEach((v, i) => {
    s += weights[i] * Math.sin((v * Math.PI) / 180);
    c += weights[i] * Math.cos((v * Math.PI) / 180);
  });
  if (Math.abs(s) < 1e-9 && Math.abs(c) < 1e-9) return null;
  return ((Math.atan2(s, c) * 180) / Math.PI + 360) % 360;
}

export const mae = (e: number[]) => (e.length ? e.reduce((s, x) => s + Math.abs(x), 0) / e.length : null);
export const brier = (p: [number, number][]) => (p.length ? p.reduce((s, [f, o]) => s + (f - o) ** 2, 0) / p.length : null);
export const r1 = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
