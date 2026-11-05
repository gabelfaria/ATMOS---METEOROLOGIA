import { Box, Stack, Typography, useTheme } from '@mui/material';
import { useMemo, useState, type PointerEvent } from 'react';
import type { Block, Day, HourRow, Nowcast, RadarStep } from '../api/types';
import { useApp } from '../lib/appctx';
import { dayMonth, hm, hour, num, pct, weekday } from '../lib/format';
import { BlockDetail, DayDetail } from './details';
import type { Forecast } from '../api/types';
import { brand, condensed, confColor } from '../theme';

const CLASS_COLOR: Record<string, string> = {
  fraca: '#7FB8FF',
  moderada: brand.blue,
  forte: '#1A4FD6',
  'muito forte': '#8A2BE2',
};

/** Leitura fixa ACIMA do gráfico: ao tocar, o valor aparece fora da área coberta pelo dedo. */
function Readout({ children }: { children?: React.ReactNode }) {
  return (
    <Box
      aria-live="polite"
      sx={{ minHeight: 44, mb: 1, px: 1.25, py: 0.75, bgcolor: 'action.hover', borderRadius: '4px', fontSize: '0.8rem', lineHeight: 1.35, color: children ? 'text.primary' : 'text.secondary' }}
    >
      {children ?? 'Toque ou arraste no gráfico para ver os valores.'}
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
    <Box sx={{ position: 'relative' }}>
      <Readout>
        {sel && (
          <>
            <strong>{hm(sel.time ?? 0, tz)}</strong> · {sel.f ? 'extrapolação' : 'observado'}
            <br />
            {sel.class ? `Chuva ${sel.class} (~${num(sel.rateMmH, 1)} mm/h)` : 'Sem chuva no ponto'}
            {sel.dbz !== null && sel.dbz !== undefined ? ` · ${num(sel.dbz)} dBZ` : ''}
          </>
        )}
      </Readout>
      <Box sx={{ display: 'flex', gap: '2px', alignItems: 'flex-end', height: 56, touchAction: 'pan-y' }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(all.length - 1, Math.floor(((e.clientX - r.left) / r.width) * all.length))));
        }}>
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
const DIVERGE = 4;

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
  // trechos em que a diferença entre o modelo mais quente e o mais frio passa de DIVERGE °C
  const divergent: [number, number][] = [];
  pts.forEach((p) => {
    if (p.temperature!.max - p.temperature!.min <= DIVERGE) return;
    const last = divergent[divergent.length - 1];
    if (last && p.time - last[1] <= 3600) last[1] = p.time;
    else divergent.push([p.time, p.time]);
  });
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
      <Readout>
        {sel && (
          <>
            <strong>{hm(sel.time, tz)}</strong> · consenso <strong>{num(sel.temperature!.value, 1)} °C</strong>
            <br />
            Entre os {sel.temperature!.n} modelos: {num(sel.temperature!.min, 1)} a {num(sel.temperature!.max, 1)} °C
            {sel.temperature!.max - sel.temperature!.min > DIVERGE ? ' — modelos divergem neste horário' : ''}
          </>
        )}
      </Readout>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Temperatura consolidada e faixa entre modelos" onPointerMove={onMove} onPointerDown={onMove} style={{ touchAction: 'pan-y' }}>
        {divergent.map(([a, b]) => (
          <g key={a}>
            <rect x={x(a)} y={8} width={Math.max(x(b) - x(a), 2)} height={H - 30} fill={theme.palette.text.primary} opacity={0.06} />
            <text x={(x(a) + x(b)) / 2} y={20} textAnchor="middle" fontSize="10" fill={ink}>modelos divergem</text>
          </g>
        ))}
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
        Linha: mediana ponderada · faixa: menor e maior valor entre os modelos · linha verde: agora · área sombreada: modelos discordam em mais de {DIVERGE} °C (ex.: horário de chegada de uma frente)
      </Typography>
    </Box>
  );
}

/** Chuva em blocos de 3 h: barra = mediana dos modelos (mm); número abaixo = probabilidade do ensemble. */
export function RainBlocks({ blocks, tz, now, nowcast, forecast }: { blocks: Block[]; tz: string; now: number; nowcast?: Nowcast; forecast?: Forecast }) {
  const { openSheet } = useApp();
  const data = blocks.filter((b) => b.end > now);
  const [sel, setSel] = useState<Block | null>(data[0] ?? null);
  // O que o radar mostra (observado agora + extrapolação até 2 h) dentro de cada bloco
  const radarIn = (b: Block): string | null => {
    if (!nowcast?.available) return null;
    const steps = [nowcast.current, ...(nowcast.forecast ?? [])].filter((x): x is RadarStep => !!x && !!x.time);
    const inside = steps.filter((x) => x.time! >= b.start && x.time! < b.end);
    if (!inside.length) return null;
    const order = ['fraca', 'moderada', 'forte', 'muito forte'];
    const cls = inside.map((x) => x.class).filter((c): c is string => !!c);
    return cls.length ? cls.reduce((x, y) => (order.indexOf(y) > order.indexOf(x) ? y : x)) : 'seco';
  };
  return (
    <Box sx={{ position: 'relative' }}>
      <Readout>
        {sel && (
          <>
            <strong>
              {hm(sel.start, tz)}–{hm(sel.end, tz)}
            </strong>{' '}
            · chance de chuva <strong>{pct(sel.rainProbability)}</strong> (ensemble) · quantidade mais provável {num(sel.precipMedian, 1)} mm
            {sel.precipMax ? ` (até ${num(sel.precipMax, 1)} mm no modelo mais chuvoso)` : ''}
            {sel.heavyProbability ? ` · chuva forte ${pct(sel.heavyProbability)}` : ''}
            {radarIn(sel) && radarIn(sel) !== 'seco' ? ` · RADAR: chuva ${radarIn(sel)}` : ''}
            {forecast && (
              <Box
                component="button"
                onClick={() => openSheet(`Chuva ${hm(sel.start, tz)}–${hm(sel.end, tz)}`, <BlockDetail data={forecast} b={sel} />, brand.blue)}
                sx={{ all: 'unset', cursor: 'pointer', display: 'block', mt: 0.5, color: 'primary.main', fontWeight: 700, fontSize: '0.78rem' }}
              >
                Ver cada modelo e ensemble ›
              </Box>
            )}
          </>
        )}
      </Readout>
      <Box sx={{ display: 'flex', gap: '2px', overflowX: 'auto', pb: 0.5 }}>
        {data.map((b) => {
          const p = b.rainProbability ?? 0;
          const h = Math.max(p * 72, 2);
          const active = sel?.start === b.start;
          const rd = radarIn(b);
          return (
            <Box
              key={b.start}
              onClick={() => setSel(b)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setSel(b)}
              sx={{ flex: '1 0 38px', textAlign: 'center', cursor: 'pointer', outline: active ? `1px solid ${brand.green}` : 'none', borderRadius: '3px', py: 0.25 }}
            >
              <Typography sx={{ fontSize: '0.74rem', fontFamily: condensed, fontWeight: 800 }}>{pct(b.rainProbability)}</Typography>
              <Box sx={{ height: 74, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <Box sx={{ width: 18, height: h, bgcolor: p > 0 ? brand.blue : 'action.disabledBackground', opacity: 0.35 + 0.65 * p, borderRadius: '4px 4px 0 0' }} />
              </Box>
              <Typography sx={{ fontSize: '0.68rem' }}>{b.precipMedian ? `${num(b.precipMedian, b.precipMedian < 10 ? 1 : 0)} mm` : '—'}</Typography>
              <Typography sx={{ fontSize: '0.64rem' }} color="text.secondary">{hour(b.start, tz)}</Typography>
              <Box sx={{ height: 14, mt: 0.25 }}>
                {rd && rd !== 'seco' && (
                  <Box sx={{ mx: 'auto', width: 'fit-content', px: 0.5, fontSize: '0.56rem', fontFamily: condensed, fontWeight: 700, letterSpacing: '0.06em', border: `1px solid ${brand.green}`, borderRadius: '2px' }}>RADAR</Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Barra e % = chance de chover (≥0,5 mm em 3 h, ensembles). Abaixo: quantidade mais provável e início do bloco. "RADAR" = o radar mostra chuva nesse período.
      </Typography>
    </Box>
  );
}

/** Longo prazo: faixa P10–P90 da mínima à máxima por dia. */
export function DayRows({ days, tz }: { days: Day[]; tz: string }) {
  const { openSheet } = useApp();
  const lo = Math.min(...days.map((d) => d.tmin.p10 ?? 99));
  const hi = Math.max(...days.map((d) => d.tmax.p90 ?? -99));
  const sx = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;
  return (
    <Box>
      {days.map((d) => (
        <Box
          key={d.date}
          role="button"
          tabIndex={0}
          onClick={() => openSheet('Previsão do dia', <DayDetail d={d} tz={tz} />, confColor[d.confidence])}
          sx={{ display: 'grid', gridTemplateColumns: '52px 1fr 62px 30px', alignItems: 'center', gap: 1, py: 0.9, borderBottom: 1, borderColor: 'divider', cursor: 'pointer', '&:active': { bgcolor: 'action.hover' } }}
        >
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
        Toque num dia para ver os detalhes de cada ensemble. Barra amarela: mediana da mínima à máxima · trilho cinza: P10 da mínima a P90 da máxima · % = chance de ≥1 mm no dia · mm = mediana–P90 · faixa à direita: confiança (verde alta, amarelo moderada, vermelho baixa)
      </Typography>
    </Box>
  );
}
