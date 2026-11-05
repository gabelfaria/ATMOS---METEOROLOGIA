import { Box, Stack, Typography, useTheme } from '@mui/material';
import { useMemo, useState, type PointerEvent } from 'react';
import type { Block, Day, HourRow, Nowcast, RadarStep } from '../api/types';
import { dayMonth, hm, hour, num, pct, weekday } from '../lib/format';
import { brand, condensed, confColor } from '../theme';

const CLASS_COLOR: Record<string, string> = {
  fraca: '#7FB8FF',
  moderada: brand.blue,
  forte: '#1A4FD6',
  'muito forte': '#8A2BE2',
};

function Tooltip({ at, children }: { at: number; children: React.ReactNode }) {
  // `at` = posição horizontal em % da largura do gráfico
  const left = `clamp(0px, calc(${at}% - 80px), calc(100% - 160px))`;
  return (
    <Box
      role="tooltip"
      sx={{
        position: 'absolute',
        top: 0,
        left,
        width: 160,
        p: 1,
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: '4px',
        boxShadow: 3,
        fontSize: '0.78rem',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {children}
    </Box>
  );
}

/** Faixa de radar: passado observado (10 min) | AGORA | extrapolação (10 min). */
export function RadarStrip({ nc, tz }: { nc: Nowcast; tz: string }) {
  const past: RadarStep[] = nc.observed ?? [];
  const fut = nc.forecast ?? [];
  const [hover, setHover] = useState<number | null>(null);
  const all = [...past.map((s) => ({ ...s, f: false })), ...fut.map((s) => ({ ...s, f: true }))];
  if (!all.length) return null;
  const sel = hover !== null ? all[hover] : null;
  return (
    <Box sx={{ position: 'relative', pt: 6 }}>
      {sel && (
        <Tooltip at={((hover! + 0.5) / all.length) * 100}>
          <strong>{hm(sel.time ?? 0, tz)}</strong> · {sel.f ? 'extrapolação' : 'observado'}
          <br />
          {sel.class ? `Chuva ${sel.class} (~${num(sel.rateMmH, 1)} mm/h)` : 'Sem chuva no ponto'}
          {sel.dbz !== null && sel.dbz !== undefined ? ` · ${num(sel.dbz)} dBZ` : ''}
        </Tooltip>
      )}
      <Box sx={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: 56 }} onPointerLeave={() => setHover(null)}>
        {all.map((s, i) => {
          const h = s.class ? Math.min(12 + s.rateMmH * 3, 56) : 4;
          const isNowEdge = i === past.length;
          return (
            <Box
              key={i}
              onPointerEnter={() => setHover(i)}
              onClick={() => setHover(i)}
              sx={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', borderLeft: isNowEdge ? `2px solid ${brand.green}` : 0, pl: isNowEdge ? '2px' : 0, cursor: 'pointer' }}
            >
              <Box
                sx={{
                  width: '100%',
                  height: h,
                  borderRadius: '3px 3px 0 0',
                  bgcolor: s.class ? CLASS_COLOR[s.class] : 'action.disabledBackground',
                  opacity: s.f ? 0.6 : 1,
                  backgroundImage: s.f ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 2px, transparent 2px 6px)' : 'none',
                }}
              />
            </Box>
          );
        })}
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {past[0]?.time ? hm(past[0].time, tz) : ''} · OBSERVADO
        </Typography>
        <Typography variant="caption" sx={{ fontFamily: condensed, fontWeight: 700 }}>
          AGORA
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {fut.length ? `EXTRAPOLADO · ${hm(fut[fut.length - 1].time, tz)}` : 'sem extrapolação'}
        </Typography>
      </Stack>
    </Box>
  );
}

const W = 720;

/** Temperatura consolidada (linha) com faixa entre modelos (mín–máx). */
export function TempChart({ hours, tz, now }: { hours: HourRow[]; tz: string; now: number }) {
  const theme = useTheme();
  const H = 160;
  const pts = hours.filter((h) => h.temperature?.value !== null && h.temperature?.value !== undefined);
  const [hi, setHi] = useState<number | null>(null);
  const geom = useMemo(() => {
    if (pts.length < 2) return null;
    const lo = Math.floor(Math.min(...pts.map((p) => p.temperature!.min)) - 1);
    const hiV = Math.ceil(Math.max(...pts.map((p) => p.temperature!.max)) + 1);
    const t0 = pts[0].time;
    const t1 = pts[pts.length - 1].time;
    const x = (t: number) => 36 + ((t - t0) / (t1 - t0)) * (W - 48);
    const y = (v: number) => 12 + (1 - (v - lo) / (hiV - lo)) * (H - 36);
    return { lo, hiV, t0, t1, x, y };
  }, [pts]);
  if (!geom) return <Typography color="text.secondary">Sem dados de temperatura.</Typography>;
  const { x, y, lo, hiV } = geom;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.temperature!.value!).toFixed(1)}`).join('');
  const band =
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.time).toFixed(1)},${y(p.temperature!.max).toFixed(1)}`).join('') +
    [...pts].reverse().map((p) => `L${x(p.time).toFixed(1)},${y(p.temperature!.min).toFixed(1)}`).join('') +
    'Z';
  const ticks = [lo, Math.round((lo + hiV) / 2), hiV];
  const ink = theme.palette.text.secondary;
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(x(p.time) - px) < Math.abs(x(pts[best].time) - px)) best = i;
    });
    setHi(best);
  };
  const sel = hi !== null ? pts[hi] : null;
  return (
    <Box sx={{ position: 'relative' }}>
      {sel && (
        <Tooltip at={(x(sel.time) / W) * 100}>
          <strong>{hm(sel.time, tz)}</strong>
          <br />
          Consenso: {num(sel.temperature!.value, 1)} °C
          <br />
          Modelos: {num(sel.temperature!.min, 1)}–{num(sel.temperature!.max, 1)} °C ({sel.temperature!.n})
        </Tooltip>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Temperatura consolidada e faixa entre modelos" onPointerMove={onMove} onPointerLeave={() => setHi(null)} style={{ touchAction: 'pan-y' }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={36} x2={W - 12} y1={y(t)} y2={y(t)} stroke={theme.palette.divider} />
            <text x={30} y={y(t) + 4} textAnchor="end" fontSize="11" fill={ink}>{t}°</text>
          </g>
        ))}
        <path d={band} fill={brand.yellow} opacity={0.22} />
        <path d={line} fill="none" stroke={brand.yellow} strokeWidth={2} />
        {now >= geom.t0 && now <= geom.t1 && (
          <line x1={x(now)} x2={x(now)} y1={8} y2={H - 22} stroke={brand.green} strokeWidth={2} />
        )}
        {pts.filter((_, i) => i % 6 === 0).map((p) => (
          <text key={p.time} x={x(p.time)} y={H - 6} textAnchor="middle" fontSize="11" fill={ink}>{hour(p.time, tz)}</text>
        ))}
        {sel && <circle cx={x(sel.time)} cy={y(sel.temperature!.value!)} r={5} fill={brand.yellow} stroke={theme.palette.background.paper} strokeWidth={2} />}
      </svg>
      <Typography variant="caption" color="text.secondary">
        Linha: mediana ponderada · faixa: menor e maior valor entre os modelos · linha verde: agora
      </Typography>
    </Box>
  );
}

/** Chuva em blocos de 3 h: barra = mediana dos modelos (mm); número abaixo = probabilidade do ensemble. */
export function RainBlocks({ blocks, tz, now }: { blocks: Block[]; tz: string; now: number }) {
  const [sel, setSel] = useState<Block | null>(null);
  const data = blocks.filter((b) => b.end > now);
  const maxV = Math.max(5, ...data.map((b) => b.precipMax ?? 0));
  return (
    <Box sx={{ position: 'relative' }}>
      <Box sx={{ display: 'flex', gap: '2px', overflowX: 'auto', pb: 0.5 }} onPointerLeave={() => setSel(null)}>
        {data.map((b) => {
          const v = b.precipMedian ?? 0;
          const h = Math.max((v / maxV) * 72, v > 0 ? 4 : 2);
          const mx = ((b.precipMax ?? 0) / maxV) * 72;
          const active = sel?.start === b.start;
          return (
            <Box
              key={b.start}
              onPointerEnter={() => setSel(b)}
              onClick={() => setSel(b)}
              sx={{ flex: '1 0 34px', textAlign: 'center', cursor: 'pointer', outline: active ? `1px solid ${brand.green}` : 'none', borderRadius: '3px' }}
            >
              <Box sx={{ height: 76, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative' }}>
                <Box sx={{ position: 'absolute', bottom: 0, width: 2, height: mx, bgcolor: 'text.disabled' }} />
                <Box sx={{ width: 16, height: h, bgcolor: v > 0 ? brand.blue : 'action.disabledBackground', borderRadius: '4px 4px 0 0', position: 'relative' }} />
              </Box>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 600 }}>{num(b.precipMedian, b.precipMedian && b.precipMedian < 10 ? 1 : 0)}</Typography>
              <Typography sx={{ fontSize: '0.7rem', fontFamily: condensed, fontWeight: 700 }}>{pct(b.rainProbability)}</Typography>
              <Typography sx={{ fontSize: '0.64rem' }} color="text.secondary">{hour(b.start, tz)}</Typography>
            </Box>
          );
        })}
      </Box>
      {sel && (
        <Box sx={{ mt: 1, p: 1.25, bgcolor: 'action.hover', borderRadius: '4px', fontSize: '0.82rem' }}>
          <strong>
            {hm(sel.start, tz)}–{hm(sel.end, tz)}
          </strong>{' '}
          · mediana {num(sel.precipMedian, 1)} mm (máx. entre modelos {num(sel.precipMax, 1)} mm) · chance (ensemble) {pct(sel.rainProbability)}
          {sel.heavyProbability ? ` · chuva forte ${pct(sel.heavyProbability)}` : ''}
          {sel.modelAgreementWet !== null && ` · ${pct(sel.modelAgreementWet)} do peso dos modelos com chuva`}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Linha 1: chuva (mm/3 h, mediana; traço = maior modelo) · Linha 2: probabilidade bruta do ensemble (≥0,5 mm/3 h) · Linha 3: início do bloco
      </Typography>
    </Box>
  );
}

/** Longo prazo: faixa P10–P90 da mínima à máxima por dia. */
export function DayRows({ days, tz }: { days: Day[]; tz: string }) {
  const lo = Math.min(...days.map((d) => d.tmin.p10 ?? 99));
  const hi = Math.max(...days.map((d) => d.tmax.p90 ?? -99));
  const sx = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <Box>
      {days.map((d) => (
        <Box key={d.date} sx={{ display: 'grid', gridTemplateColumns: '52px 1fr 62px 30px', alignItems: 'center', gap: 1, py: 0.9, borderBottom: 1, borderColor: 'divider' }}>
          <Box>
            <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 16, lineHeight: 1 }}>{weekday(d.date + 43200, tz)}</Typography>
            <Typography variant="caption" color="text.secondary">{dayMonth(d.date + 43200, tz)}</Typography>
          </Box>
          <Box sx={{ position: 'relative', height: 26 }} title={`Mín P10–P90: ${d.tmin.p10}–${d.tmin.p90} °C · Máx P10–P90: ${d.tmax.p10}–${d.tmax.p90} °C`}>
            {d.tmin.p10 !== null && d.tmax.p90 !== null && (
              <Box sx={{ position: 'absolute', top: 11, height: 4, left: sx(d.tmin.p10), right: `calc(100% - ${sx(d.tmax.p90)})`, bgcolor: 'action.disabledBackground', borderRadius: 2 }} />
            )}
            {d.tmin.p50 !== null && d.tmax.p50 !== null && (
              <Box sx={{ position: 'absolute', top: 8, height: 10, left: sx(d.tmin.p50), right: `calc(100% - ${sx(d.tmax.p50)})`, bgcolor: brand.yellow, borderRadius: '4px' }} />
            )}
            <Typography sx={{ position: 'absolute', left: 0, top: -4, fontSize: '0.68rem' }} color="text.secondary">
              {num(d.tmin.p50)}°
            </Typography>
            <Typography sx={{ position: 'absolute', right: 0, top: -4, fontSize: '0.68rem', fontWeight: 700 }}>{num(d.tmax.p50)}°</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontFamily: condensed, fontWeight: 700, fontSize: 15, lineHeight: 1 }}>{pct(d.precip.pAny)}</Typography>
            <Typography variant="caption" color="text.secondary">{num(d.precip.p50, 0)}–{num(d.precip.p90, 0)} mm</Typography>
          </Box>
          <Box title={d.confidenceReasons.join(' · ')} sx={{ width: 10, height: 26, bgcolor: confColor[d.confidence], justifySelf: 'end' }} aria-label={`confiança ${d.confidence}`} />
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Barra amarela: mediana da mínima à máxima · trilho cinza: P10 da mínima a P90 da máxima · % = chance de ≥1 mm no dia · mm = mediana–P90 · faixa à direita: confiança (verde alta, amarelo moderada, vermelho baixa)
      </Typography>
    </Box>
  );
}
