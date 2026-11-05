// Conteúdo das folhas de detalhes (abertas ao tocar em cartões, linhas e blocos).
import { Box, Button, ButtonBase, Stack, Table, TableBody, TableCell, TableRow, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import type { Block, Day, Forecast, HourRow, ModelRow, Observation } from '../api/types';
import { useApp } from '../lib/appctx';
import { ago, dateTime, dayMonth, dir8, hm, hour, num, pct, weekday } from '../lib/format';
import { brand, condensed, confColor } from '../theme';
import { ConfidenceMeter, KindBadge } from './ui';

/** Área tocável com retorno visual (ripple) e indicador "›". */
export function Tap({ onClick, children, sx, label }: { onClick: () => void; children: ReactNode; sx?: SxProps<Theme>; label?: string }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={label}
      sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: '4px', position: 'relative', '&:hover .tap-chev': { opacity: 1 }, ...sx }}
    >
      {children}
      <Box className="tap-chev" component="span" aria-hidden sx={{ position: 'absolute', right: 8, top: 8, opacity: 0.55, fontSize: 14, fontWeight: 700 }}>
        ›
      </Box>
    </ButtonBase>
  );
}

function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <TableRow>
      <TableCell sx={{ color: 'text.secondary', pl: 0, width: '45%' }}>{k}</TableCell>
      <TableCell sx={{ fontWeight: 600, pr: 0 }}>{v}</TableCell>
    </TableRow>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <Table size="small">
      <TableBody>
        {rows.map(([k, v], i) => (
          <Row key={i} k={k} v={v} />
        ))}
      </TableBody>
    </Table>
  );
}

/** Lista horária com barra proporcional (legível no celular, sem tooltip). */
function HourBars({ items, unit, digits = 0, color = brand.yellow }: { items: { label: string; v: number | null; lo?: number; hi?: number }[]; unit: string; digits?: number; color?: string }) {
  const vals = items.flatMap((i) => [i.v, i.lo, i.hi]).filter((x): x is number => x !== null && x !== undefined);
  if (!vals.length) return <Typography color="text.secondary">Sem dados para as próximas horas.</Typography>;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const sx = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  return (
    <Box>
      {items.map((i) => (
        <Box key={i.label} sx={{ display: 'grid', gridTemplateColumns: '44px 1fr 74px', alignItems: 'center', gap: 1, py: 0.45 }}>
          <Typography variant="caption" color="text.secondary">
            {i.label}
          </Typography>
          <Box sx={{ position: 'relative', height: 10 }}>
            {i.lo !== undefined && i.hi !== undefined && (
              <Box sx={{ position: 'absolute', top: 3, height: 4, left: sx(i.lo), right: `calc(100% - ${sx(i.hi)})`, bgcolor: 'action.disabledBackground', borderRadius: 2 }} />
            )}
            {i.v !== null && <Box sx={{ position: 'absolute', top: 0, width: 10, height: 10, left: `calc(${sx(i.v)} - 5px)`, bgcolor: color, borderRadius: '2px' }} />}
          </Box>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, textAlign: 'right' }}>
            {num(i.v, digits)} {unit}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const METRICS: Record<string, { name: string; unit: string; field?: keyof HourRow; digits?: number; about: string }> = {
  temperature: { name: 'Temperatura', unit: '°C', field: 'temperature', about: 'Medida pela estação mais próxima quando há METAR recente a até 25 km; senão, estimada por modelo. A previsão é a mediana ponderada de 6 modelos; a faixa cinza vai do modelo mais frio ao mais quente.' },
  apparentTemperature: { name: 'Sensação térmica', unit: '°C', field: 'apparentTemperature', about: 'Combina temperatura, umidade e vento. Calculada pelos modelos.' },
  humidity: { name: 'Umidade relativa', unit: '%', field: 'humidity', about: 'Quando há estação próxima, é calculada da temperatura e do ponto de orvalho medidos (fórmula de Magnus).' },
  windSpeed: { name: 'Vento', unit: 'km/h', field: 'windSpeed', about: 'Vento médio a 10 m de altura. A direção indica de onde o vento sopra.' },
  windGust: { name: 'Rajadas', unit: 'km/h', field: 'windGust', about: 'Rajada máxima esperada na hora. Acima de 60 km/h já pode derrubar galhos.' },
  pressure: { name: 'Pressão', unit: 'hPa', field: 'pressure', about: 'Pressão ao nível do mar. Queda rápida costuma anteceder mudança de tempo (frente fria, instabilidade).' },
  cloudCover: { name: 'Nebulosidade', unit: '%', field: 'cloudCover', about: 'Fração do céu coberta por nuvens, segundo os modelos.' },
  visibility: { name: 'Visibilidade', unit: 'km', field: 'visibility', about: 'Medida no aeroporto mais próximo (METAR) ou estimada pelos modelos.' },
  uvIndex: { name: 'Índice UV', unit: '', about: 'Intensidade da radiação ultravioleta (modelo). 0–2 baixo, 3–5 moderado, 6–7 alto, 8–10 muito alto, 11+ extremo.' },
};

export function MetricDetail({ data, metric }: { data: Forecast; metric: string }) {
  const tz = data.location.timezone;
  const meta = METRICS[metric];
  const o = data.current.observation as unknown as Record<string, number | null> | null;
  const m = data.current.model as unknown as Record<string, number | null> | null;
  const now = Date.now() / 1000;
  const obsKey = metric === 'visibility' ? 'visibilityKm' : metric;
  const items = meta.field
    ? data.mediumTerm.hours
        .filter((h) => h.time >= now - 1800)
        .slice(0, 24)
        .map((h) => {
          const r = h[meta.field!] as { value: number | null; min: number; max: number } | null;
          return { label: hour(h.time, tz), v: r?.value ?? null, lo: r?.min, hi: r?.max };
        })
    : [];
  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: '4px' }}>
          <KindBadge kind="observation" />
          <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 30 }}>
            {o && o[obsKey] !== null && o[obsKey] !== undefined ? `${num(o[obsKey] as number, 0)} ${meta.unit}` : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {data.current.observation ? `${data.current.observation.station} · ${hm(data.current.observation.observedAt, tz)}` : 'sem estação próxima'}
          </Typography>
        </Box>
        <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: '4px' }}>
          <KindBadge kind="model" />
          <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 30 }}>
            {m && m[metric] !== null && m[metric] !== undefined ? `${num(m[metric] as number, metric === 'temperature' ? 1 : 0)} ${meta.unit}` : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Open-Meteo · {hm(data.current.model?.time, tz)}
          </Typography>
        </Box>
      </Box>
      {metric === 'windSpeed' && (
        <Typography variant="body2">
          Direção: <strong>{dir8(data.current.observation?.windDirection ?? data.current.model?.windDirection)}</strong> (de onde sopra)
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {meta.about}
      </Typography>
      {items.length > 0 && (
        <Box>
          <Typography variant="overline">Próximas 24 h · consenso</Typography>
          <HourBars items={items} unit={meta.unit} />
        </Box>
      )}
    </Stack>
  );
}

export function VerdictDetail({ data }: { data: Forecast }) {
  const { go } = useApp();
  const v = data.verdict;
  const tz = data.location.timezone;
  return (
    <Stack spacing={2}>
      <Typography>{v.text}</Typography>
      <Stack direction="row" spacing={2} alignItems="center">
        <ConfidenceMeter level={v.confidence} />
        <Typography variant="body2" color="text.secondary">
          {v.confidenceReason}
        </Typography>
      </Stack>
      <KV
        rows={[
          ['Fonte principal', v.mainSource ?? '—'],
          ['Horário do dado', v.dataTime ? `${hm(v.dataTime, tz)} (${ago(v.dataTime)})` : 'modelo/ensemble'],
          ['Chance de chuva (próximo bloco)', v.rainProbability === null ? '—' : `${pct(v.rainProbability)} · ensemble, não calibrada`],
          ['Chegada estimada', v.arrivalWindowMinutes ? `${v.arrivalWindowMinutes[0]}–${v.arrivalWindowMinutes[1] ?? '?'} min` : '—'],
          ['Fontes usadas', v.sources.join(', ') || '—'],
        ]}
      />
      <Typography variant="body2" color="text.secondary">
        O veredito é montado por regras fixas a partir dos dados acima; nenhum número é escrito sem uma fonte que o sustente.
      </Typography>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={() => go('map', { mapLayer: 'radar' })}>
          Ver radar no mapa
        </Button>
        <Button variant="outlined" onClick={() => go('forecast', { forecastTab: 0 })}>
          Próximas 2 h
        </Button>
      </Stack>
    </Stack>
  );
}

export function StationDetail({ s, tz }: { s: Observation; tz: string }) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {s.name} · {num(s.distanceKm, 0)} km a {s.bearing} · observado às {hm(s.observedAt, tz)} ({ago(s.observedAt)})
      </Typography>
      <KV
        rows={[
          ['Temperatura', `${num(s.temperature)} °C`],
          ['Ponto de orvalho', `${num(s.dewpoint)} °C`],
          ['Umidade (calculada)', `${num(s.humidity)} %`],
          ['Vento', `${num(s.windSpeed)} km/h de ${dir8(s.windDirection)}`],
          ['Rajada', s.windGust ? `${s.windGust} km/h` : 'não reportada'],
          ['Pressão (QNH)', `${num(s.pressure)} hPa`],
          ['Visibilidade', s.visibilityKm !== null ? `${num(s.visibilityKm)} km` : '—'],
          ['Tempo presente', s.weather.description.filter(Boolean).join(', ') || 'nada significativo'],
          ['Chuva nas últimas 3 h', s.recentPrecip ? 'sim' : 'não reportada'],
        ]}
      />
      <Box component="code" sx={{ fontSize: '0.75rem', p: 1, bgcolor: 'action.hover', borderRadius: '4px', wordBreak: 'break-all' }}>
        {s.raw}
      </Box>
      <Typography variant="caption" color="text.secondary">
        METAR: boletim oficial de aeroporto (DECEA), via NOAA Aviation Weather Center. É medição, não previsão.
      </Typography>
    </Stack>
  );
}

export function HourDetail({ data, h }: { data: Forecast; h: HourRow }) {
  const tz = data.location.timezone;
  const b = data.mediumTerm.blocks.find((x) => x.start < h.time && h.time <= x.end);
  const r = (x: { value: number | null; min: number; max: number } | null, u: string, d = 0) =>
    x ? `${num(x.value, d)} ${u} (modelos ${num(x.min, d)}–${num(x.max, d)})` : '—';
  return (
    <Stack spacing={1.5}>
      <KV
        rows={[
          ['Temperatura', r(h.temperature, '°C', 1)],
          ['Sensação', r(h.apparentTemperature, '°C')],
          ['Umidade', r(h.humidity, '%')],
          ['Vento', `${r(h.windSpeed, 'km/h')} de ${dir8(h.windDirection)}`],
          ['Rajada', r(h.windGust, 'km/h')],
          ['Nuvens', r(h.cloudCover, '%')],
          ['Visibilidade', r(h.visibility, 'km')],
          ['Pressão', r(h.pressure, 'hPa')],
          ['Instabilidade (CAPE)', r(h.cape, 'J/kg')],
          ['Chance de chuva no bloco', b ? `${pct(b.rainProbability)} (${hm(b.start, tz)}–${hm(b.end, tz)})` : '—'],
        ]}
      />
      {b && <BlockSystems b={b} />}
      <Typography variant="caption" color="text.secondary">
        Valores = mediana ponderada entre {h.temperature?.n ?? '?'} modelos. CAPE acima de 1000 J/kg indica atmosfera favorável a tempestades.
      </Typography>
    </Stack>
  );
}

function BlockSystems({ b }: { b: Block }) {
  const sys = Object.entries(b.ensemble);
  if (!sys.length) return null;
  const NAMES: Record<string, string> = { ecmwf_ifs025: 'ECMWF ENS', gfs025: 'NCEP GEFS', icon_seamless: 'ICON-EPS' };
  return (
    <Box>
      <Typography variant="overline">Chance de chuva em cada ensemble</Typography>
      {sys.map(([id, p]) => (
        <Box key={id} sx={{ display: 'grid', gridTemplateColumns: '96px 1fr 44px', gap: 1, alignItems: 'center', py: 0.4 }}>
          <Typography variant="caption">
            {NAMES[id] ?? id} ({p.members})
          </Typography>
          <Box sx={{ height: 8, bgcolor: 'action.disabledBackground', borderRadius: 1, overflow: 'hidden' }}>
            <Box sx={{ width: `${p.pAny * 100}%`, height: '100%', bgcolor: brand.blue }} />
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>
            {pct(p.pAny)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function BlockDetail({ data, b }: { data: Forecast; b: Block }) {
  const tz = data.location.timezone;
  const models = data.mediumTerm.models.filter((m) => m.available);
  return (
    <Stack spacing={1.5}>
      <KV
        rows={[
          ['Chance de chuva (≥0,5 mm)', pct(b.rainProbability)],
          ['Chance de chuva moderada (≥7,5 mm)', pct(b.moderateProbability)],
          ['Chance de chuva forte (≥30 mm)', pct(b.heavyProbability)],
          ['Quantidade mais provável', `${num(b.precipMedian, 1)} mm`],
          ['Rajada mediana', b.gustMedian !== null ? `${b.gustMedian} km/h` : '—'],
          ['Instabilidade (CAPE)', b.capeMedian !== null ? `${b.capeMedian} J/kg` : '—'],
        ]}
      />
      <BlockSystems b={b} />
      <Box>
        <Typography variant="overline">Chuva prevista por modelo ({hm(b.start, tz)}–{hm(b.end, tz)})</Typography>
        {models.map((m) => (
          <Box key={m.model} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3 }}>
            <Typography variant="body2">{m.name}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {b.precipByModel[m.model] === null || b.precipByModel[m.model] === undefined ? '—' : `${num(b.precipByModel[m.model], 1)} mm`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

export function DayDetail({ d, tz }: { d: Day; tz: string }) {
  return (
    <Stack spacing={1.5}>
      <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 22 }}>
        {weekday(d.date + 43200, tz)} {dayMonth(d.date + 43200, tz)} · daqui a {d.leadDays} dia(s)
      </Typography>
      <KV
        rows={[
          ['Máxima', `${num(d.tmax.p50)} °C (entre ${num(d.tmax.p10)} e ${num(d.tmax.p90)})`],
          ['Mínima', `${num(d.tmin.p50)} °C (entre ${num(d.tmin.p10)} e ${num(d.tmin.p90)})`],
          ['Chance de chuva (≥1 mm)', pct(d.precip.pAny)],
          ['Chance de ≥10 mm', pct(d.precip.p10mm)],
          ['Chuva provável', `${num(d.precip.p50, 0)} mm (até ${num(d.precip.p90, 0)} mm)`],
          ['Rajadas', `${num(d.gust.p50)} km/h (até ${num(d.gust.p90)})`],
        ]}
      />
      <Box>
        <Typography variant="overline">Cada sistema de ensemble</Typography>
        {Object.values(d.systems).map((s) => (
          <Box key={s.name} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3 }}>
            <Typography variant="body2">
              {s.name} ({s.members} membros)
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              máx {num(s.tmaxMedian, 0)}° · chuva {pct(s.pRain)}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1.5, borderLeft: `4px solid ${confColor[d.confidence]}`, bgcolor: 'action.hover' }}>
        <ConfidenceMeter level={d.confidence} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {d.confidenceReasons.join(' · ')}
        </Typography>
      </Box>
      <Typography variant="caption" color="text.secondary">
        "Entre X e Y" = 80% dos cenários dos ensembles (P10–P90). Quanto mais longe o dia, mais larga a faixa.
      </Typography>
    </Stack>
  );
}

export function ModelDetail({ data, r }: { data: Forecast; r: ModelRow }) {
  const tz = data.location.timezone;
  const auditId = r.model === 'ecmwf_ifs' ? 'ecmwf_ifs025' : r.model;
  const a = data.audit.archive?.models.find((m) => m.model === auditId);
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {r.provider}
        {r.resolutionKm ? ` · grade de ~${r.resolutionKm} km` : ''}
      </Typography>
      <KV
        rows={[
          ['Próximas 48 h', r.available ? `${num(r.tempMin, 0)}–${num(r.tempMax, 0)} °C · chuva ${num(r.precipTotal, 1)} mm · rajada ${num(r.gustMax, 0)} km/h` : 'sem dados'],
          ['Concordância', r.agreement ?? '—'],
          ['Diferença média do consenso', r.meanAbsDiffFromConsensus !== null && r.meanAbsDiffFromConsensus !== undefined ? `${num(r.meanAbsDiffFromConsensus, 1)} °C` : '—'],
          ['Peso no consenso', r.weight !== undefined ? pct(r.weight) : '—'],
        ]}
      />
      <Box>
        <Typography variant="overline">Como o peso foi calculado</Typography>
        {(r.weightReasons ?? []).map((x) => (
          <Typography key={x} variant="body2">
            • {x}
          </Typography>
        ))}
      </Box>
      {a && (
        <Box>
          <Typography variant="overline">Desempenho medido em {data.audit.station?.station}</Typography>
          <KV
            rows={[
              ['Erro médio de temperatura (24–47 h)', `${num(a.leads.day1.temperature.mae, 1)} °C (n=${a.leads.day1.temperature.n})`],
              ['Viés (24–47 h)', a.leads.day1.temperature.bias !== null ? `${a.leads.day1.temperature.bias > 0 ? '+' : ''}${num(a.leads.day1.temperature.bias, 1)} °C` : '—'],
              ['Erro médio (48–71 h)', `${num(a.leads.day2.temperature.mae, 1)} °C`],
              ['Chuva: acertos / falsos alarmes / não previstos', `${a.leads.day1.precipitation.hits} / ${a.leads.day1.precipitation.falseAlarms} / ${a.leads.day1.precipitation.misses}`],
            ]}
          />
          <Typography variant="caption" color="text.secondary">
            Período {dateTime(data.audit.periodStart, tz)} a {dateTime(data.audit.periodEnd, tz)}.
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
