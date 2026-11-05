import { Box, Chip, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useState } from 'react';
import { BlockDetail, HourDetail, Tap } from '../components/details';
import { useApp } from '../lib/appctx';
import type { Forecast } from '../api/types';
import { DayRows, RadarStrip, RainBlocks, TempChart } from '../components/charts';
import { ConfidenceMeter, Empty, KindBadge, Panel, SourceLine, Stat } from '../components/ui';
import { ago, dir8, hm, hour, num, pct } from '../lib/format';
import { load, save } from '../lib/storage';
import { brand, confColor } from '../theme';

export function ForecastPage({ data }: { data: Forecast }) {
  const [tab, setTab] = useState<number>(() => load('atmos:fcTab', 0));
  const change = (_: unknown, v: number) => {
    setTab(v);
    save('atmos:fcTab', v);
  };
  return (
    <Stack spacing={2}>
      <Tabs value={tab} onChange={change} variant="fullWidth" sx={{ bgcolor: 'background.paper', borderRadius: '6px', border: 1, borderColor: 'divider' }}>
        {[['CURTO', '0–2 h'], ['MÉDIO', '2–48 h'], ['LONGO', '3–16 dias']].map(([a, b]) => (
          <Tab
            key={a}
            label={
              <Box sx={{ lineHeight: 1.1 }}>
                {a}
                <Box component="span" sx={{ display: 'block', fontSize: '0.7rem', fontFamily: 'Inter, sans-serif', fontWeight: 600, letterSpacing: 0, textTransform: 'none', opacity: 0.8 }}>
                  {b}
                </Box>
              </Box>
            }
          />
        ))}
      </Tabs>
      {tab === 0 && <Short data={data} />}
      {tab === 1 && <Medium data={data} />}
      {tab === 2 && <Long data={data} />}
    </Stack>
  );
}

function Short({ data }: { data: Forecast }) {
  const tz = data.location.timezone;
  const nc = data.shortTerm;
  const now = Date.now() / 1000;
  if (!nc.available) {
    const next = data.mediumTerm.blocks.filter((b) => b.end > now).slice(0, 1);
    return (
      <Panel title="Nowcasting por radar" accent={brand.red}>
        <Typography sx={{ mb: 1 }}>
          <strong>Previsão imediata indisponível.</strong> {nc.reason}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Sem radar adequado, o ATMOS não calcula horário de chegada de chuva. Os modelos numéricos não têm resolução para isso;
          abaixo, apenas a probabilidade do ensemble para o próximo bloco de 3 h.
        </Typography>
        {next.map((b) => (
          <Stat key={b.start} label={`Chance de chuva ${hm(b.start, tz)}–${hm(b.end, tz)}`} value={pct(b.rainProbability)} hint="ensemble · baixa confiança para horário exato" />
        ))}
      </Panel>
    );
  }
  const a = nc.arrival;
  // Chovendo agora: quanto tempo a extrapolação mantém chuva sobre o ponto
  const fcs = nc.forecast ?? [];
  const firstDry = fcs.find((s) => !s.class);
  const remaining = !nc.current?.class
    ? { value: '—', hint: 'sem chuva prevista no ponto' }
    : !fcs.length
      ? { value: '—', hint: 'movimento não estimado' }
      : firstDry
        ? { value: `~${firstDry.lead}`, hint: 'até a extrapolação ficar seca' }
        : { value: '≥120', hint: 'chuva em toda a extrapolação' };
  return (
    <Stack spacing={2}>
      <Panel title="Chuva nas próximas 2 horas" accent={brand.blue} right={<ConfidenceMeter level={nc.confidence} />}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1, mb: 2 }}>
          <Stat label="Agora no ponto" value={nc.current?.class ? `Chuva ${nc.current.class}` : 'Sem chuva'} hint={nc.current?.dbz != null ? `${num(nc.current.dbz)} dBZ · ~${num(nc.current.rateMmH, 1)} mm/h` : 'radar'} />
          <Stat
            label="Chegada estimada"
            value={a ? (a.latestMinutes && a.latestMinutes > a.earliestMinutes ? `${a.earliestMinutes}–${a.latestMinutes}` : `~${a.centralMinutes}`) : '—'}
            unit={a ? 'min' : undefined}
            hint={a ? `pelo ${a.from} · central ${a.centralMinutes} min` : nc.current?.class ? 'já chovendo' : 'nenhuma chuva em rota'}
          />
          <Stat
            label={nc.current?.class ? 'Deve continuar' : 'Duração'}
            value={a ? `${a.durationTruncated ? '≥' : ''}${a.durationMinutes}` : remaining.value}
            unit={a || remaining.value !== '—' ? 'min' : undefined}
            hint={a ? `intensidade máx.: ${a.maxClass ?? '—'}` : remaining.hint}
          />
          <Stat
            label="Deslocamento"
            value={nc.motion ? num(nc.motion.speedKmh) : '—'}
            unit={nc.motion ? 'km/h' : undefined}
            hint={nc.motion ? `para ${nc.motion.toward}${nc.motion.spreadKmh !== null ? ` · ±${nc.motion.spreadKmh} km/h` : ''}` : 'não estimado'}
          />
        </Box>
        <RadarStrip nc={nc} tz={tz} />
        {nc.nearestEcho && (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            Eco de chuva mais próximo: {num(nc.nearestEcho.distanceKm, 0)} km a {nc.nearestEcho.direction}.
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          <strong>Confiança:</strong> {(nc.confidenceReasons ?? []).join('; ')}.
        </Typography>
        <SourceLine>
          {nc.method}. Quadro de {hm(nc.latestFrameTime, tz)} ({ago(nc.latestFrameTime)}), domínio de ~{nc.domainRadiusKm} km de raio, {nc.motion?.pairs ?? 0} pares de quadros válidos.
        </SourceLine>
      </Panel>
      <Panel title="Limitações do nowcasting" accent={brand.yellow}>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {(nc.limitations ?? []).map((l) => (
            <li key={l}>
              <Typography variant="body2">{l}</Typography>
            </li>
          ))}
          <li>
            <Typography variant="body2">Descargas elétricas: sem fonte licenciada integrada.</Typography>
          </li>
        </Box>
      </Panel>
    </Stack>
  );
}

function Medium({ data }: { data: Forecast }) {
  const { openSheet } = useApp();
  const [confSel, setConfSel] = useState<number | null>(null);
  const tz = data.location.timezone;
  const now = Date.now() / 1000;
  const mt = data.mediumTerm;
  const hours = mt.hours.filter((h) => h.time >= now - 1800);
  const blockOf = (t: number) => mt.blocks.find((b) => b.start < t && t <= b.end);
  const modelErr = data.sources.find((s) => s.id === 'models' && s.status === 'error');
  const nc = data.shortTerm;
  const radarWet = nc.available && (!!nc.current?.class || (nc.forecast ?? []).some((s) => s.lead <= 120 && s.class));
  const first = mt.blocks.find((b) => b.end > now);
  const conflict = radarWet && first && first.rainProbability !== null && first.rainProbability < 0.25;
  return (
    <Stack spacing={2}>
      {conflict && (
        <Panel title="Radar e modelos discordam agora" accent={brand.yellow}>
          <Typography>
            O radar {nc.current?.class ? `mostra chuva ${nc.current.class} no seu local agora` : 'mostra chuva chegando nas próximas 2 h'}, mas os modelos davam só{' '}
            {pct(first!.rainProbability)} de chance para {hm(first!.start, tz)}–{hm(first!.end, tz)}. Para as próximas 2 horas, vale o radar (aba Curto):
            ele mede a chuva real, enquanto os modelos, com grade de 10–25 km, muitas vezes erram pancadas localizadas. Daqui para frente, use os modelos
            como tendência.
          </Typography>
        </Panel>
      )}
      {modelErr && (
        <Panel title="Modelos determinísticos indisponíveis" accent={brand.red}>
          <Typography>
            A fonte dos modelos (Open-Meteo) não respondeu: {modelErr.message}. Temperatura, vento e consenso entre modelos ficam indisponíveis até ela
            voltar; as chances de chuva abaixo vêm dos ensembles, quando disponíveis. Puxe a tela para baixo para tentar de novo em alguns minutos.
          </Typography>
        </Panel>
      )}
      {mt.riskWindows.length > 0 && (
        <Panel title="Horários de maior risco" accent={brand.red}>
          <Stack spacing={1}>
            {mt.riskWindows.slice(0, 6).map((r) => (
              <Tap
                key={r.start}
                label="Detalhes do período"
                onClick={() => {
                  const b = mt.blocks.find((x) => x.start === r.start);
                  if (b) openSheet(`${hm(b.start, tz)}–${hm(b.end, tz)} · ${r.kind}`, <BlockDetail data={data} b={b} />, brand.red);
                }}
              >
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline', py: 0.5, pr: 3 }}>
                <Typography sx={{ fontWeight: 700, minWidth: 96 }}>
                  {hm(r.start, tz)}–{hm(r.end, tz)}
                </Typography>
                <Box>
                  <Typography sx={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.kind}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {r.reasons.join('; ')}
                  </Typography>
                </Box>
              </Box>
              </Tap>
            ))}
          </Stack>
        </Panel>
      )}
      <Panel title="Temperatura · 48 h" accent={brand.yellow} right={<KindBadge kind="consensus" />}>
        <TempChart hours={mt.hours} tz={tz} now={now} />
      </Panel>
      <Panel title="Chuva · blocos de 3 h" accent={brand.blue} right={<KindBadge kind="ensemble" />}>
        <RainBlocks blocks={mt.blocks} tz={tz} now={now} nowcast={data.shortTerm} forecast={data} />
      </Panel>
      <Panel title="Confiança por período" accent={brand.green}>
        <Box sx={{ display: 'flex', gap: '2px' }}>
          {mt.confidence.slice(0, 16).map((c, i) => (
            <Box key={c.start} component="button" onClick={() => setConfSel(i)} aria-label={`Confiança ${hm(c.start, tz)}`} sx={{ all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center' }}>
              <Box sx={{ height: confSel === i ? 16 : 10, bgcolor: confColor[c.confidence], borderRadius: '2px', transition: 'height .15s' }} />
              <Typography sx={{ fontSize: '0.62rem' }} color="text.secondary">
                {hour(c.start, tz)}
              </Typography>
            </Box>
          ))}
        </Box>
        {confSel !== null && mt.confidence[confSel] && (
          <Box sx={{ mt: 1, p: 1.25, bgcolor: 'action.hover', borderRadius: '4px' }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {hm(mt.confidence[confSel].start, tz)}–{hm(mt.confidence[confSel].end, tz)} · confiança{' '}
              {{ high: 'alta', moderate: 'moderada', low: 'baixa' }[mt.confidence[confSel].confidence]}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {mt.confidence[confSel].reasons.join(' · ')}
            </Typography>
          </Box>
        )}
        <SourceLine>Toque num período para ver o motivo. Verde alta · amarelo moderada · vermelho baixa.</SourceLine>
      </Panel>
      {hours.length > 0 && <Panel title="Previsão horária" dense>
        <TableContainer sx={{ maxHeight: 460 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Hora', 'Temp.', 'Faixa', 'Chuva*', 'Vento', 'Rajada', 'Nuvens', 'Visib.', 'Pressão'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {hours.map((h) => {
                const b = blockOf(h.time);
                return (
                  <TableRow key={h.time} hover onClick={() => openSheet(`Previsão para ${hm(h.time, tz)}`, <HourDetail data={data} h={h} />, brand.yellow)} sx={{ cursor: 'pointer' }}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{hm(h.time, tz)}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{num(h.temperature?.value, 0)}°</TableCell>
                    <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {num(h.temperature?.min, 0)}–{num(h.temperature?.max, 0)}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{pct(b?.rainProbability)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {num(h.windSpeed?.value, 0)} {dir8(h.windDirection)}
                    </TableCell>
                    <TableCell>{num(h.windGust?.value, 0)}</TableCell>
                    <TableCell>{num(h.cloudCover?.value, 0)}%</TableCell>
                    <TableCell>{h.visibility?.value != null ? `${num(h.visibility.value, 0)} km` : '—'}</TableCell>
                    <TableCell>{num(h.pressure?.value, 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            Temperatura, vento (km/h), nuvens, visibilidade e pressão (hPa): mediana ponderada entre modelos. *Chance de chuva do bloco de 3 h do ensemble.
            Visibilidade só existe em parte dos modelos.
          </Typography>
        </Box>
      </Panel>}
      <Box>
        {mt.notes.map((n) => (
          <Chip key={n} label={n} size="small" variant="outlined" sx={{ mr: 1, mb: 1, height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }} />
        ))}
      </Box>
    </Stack>
  );
}

function Long({ data }: { data: Forecast }) {
  const tz = data.location.timezone;
  const days = data.longTerm.days.filter((d) => d.leadDays >= 2);
  return (
    <Stack spacing={2}>
      <Panel title="Tendência · até 16 dias" accent={brand.yellow} right={<KindBadge kind="ensemble" />}>
        {days.length ? <DayRows days={days} tz={tz} /> : <Empty>Ensembles de longo prazo indisponíveis no momento.</Empty>}
      </Panel>
      {days.length > 0 && (
        <Panel title="Divergência entre sistemas de ensemble" dense>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Dia</TableCell>
                  {Object.values(days[0].systems).map((s) => (
                    <TableCell key={s.name} sx={{ whiteSpace: 'nowrap' }}>
                      {s.name}
                    </TableCell>
                  ))}
                  <TableCell>Δ chance</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {days.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>+{d.leadDays} d</TableCell>
                    {Object.keys(days[0].systems).map((k) => {
                      const s = d.systems[k];
                      return (
                        <TableCell key={k} sx={{ whiteSpace: 'nowrap' }}>
                          {s ? `${num(s.tmaxMedian, 0)}° · ${pct(s.pRain)}` : '—'}
                        </TableCell>
                      );
                    })}
                    <TableCell>{d.divergence.rainProbability !== null ? `${Math.round(d.divergence.rainProbability * 100)} p.p.` : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Máxima mediana e chance de ≥1 mm em cada sistema. "—" = sistema sem dados nesse prazo (ICON-EPS vai até ~7 dias).
            </Typography>
          </Box>
        </Panel>
      )}
      <Panel title="Além de 16 dias" accent="#8A8A99">
        <Typography color="text.secondary">{data.longTerm.beyond16Days.reason}</Typography>
      </Panel>
      <Box>
        {data.longTerm.notes.map((n) => (
          <Typography key={n} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {n}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
}
