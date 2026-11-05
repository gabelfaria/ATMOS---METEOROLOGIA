import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import type { Forecast } from '../api/types';
import { RadarStrip } from '../components/charts';
import { MetricDetail, StationDetail, Tap, VerdictDetail } from '../components/details';
import { Scoreboard, VerdictCard } from '../components/Scoreboard';
import { KindBadge, Panel, SourceLine, Stat } from '../components/ui';
import { WeatherIcon } from '../components/WeatherIcon';
import { useApp } from '../lib/appctx';
import { ago, dir8, hm, num, pct, uvLabel } from '../lib/format';
import { brand } from '../theme';

export function NowPage({ data, live }: { data: Forecast; live: boolean; onOpenAlerts?: () => void }) {
  const { go, openSheet } = useApp();
  const tz = data.location.timezone;
  const m = data.current.model;
  const o = data.current.observation;
  const nc = data.shortTerm;
  const officialNow = data.alerts.official.filter((a) => a.inForce);
  const recentRain = nc.available ? (nc.observed ?? []).reduce((mx, s) => Math.max(mx, s.rateMmH ?? 0), 0) : null;
  const nextBlock = data.mediumTerm.blocks.find((b) => b.end > Date.now() / 1000);
  const metric = (key: string, title: string) => () => openSheet(title, <MetricDetail data={data} metric={key} />, brand.yellow);

  const stats: { key: string; title: string; node: React.ReactNode; onClick: () => void }[] = [
    { key: 'temperature', title: 'Temperatura', onClick: metric('temperature', 'Temperatura'),
      node: <Stat label="Temperatura" value={num(o?.temperature ?? m?.temperature, o ? 0 : 1)} unit="°C" hint={o ? `medida em ${o.station}` : 'estimada por modelo'} /> },
    { key: 'apparentTemperature', title: 'Sensação', onClick: metric('apparentTemperature', 'Sensação térmica'),
      node: <Stat label="Sensação" value={num(m?.apparentTemperature, 0)} unit="°C" hint="modelo" /> },
    { key: 'condition', title: 'Condição', onClick: () => go('forecast', { forecastTab: 0 }),
      node: <Stat label="Condição" value={<Box component="span" sx={{ fontSize: 18 }}>{nc.current?.class ? `Chuva ${nc.current.class}` : m?.condition ?? '—'}</Box>} hint={nc.current?.class ? 'radar · toque p/ 2 h' : 'modelo · toque p/ 2 h'} /> },
    { key: 'rain', title: 'Chuva recente', onClick: () => go('map', { mapLayer: 'radar' }),
      node: <Stat label="Chuva recente (2 h)" value={recentRain === null ? '—' : recentRain > 0 ? num(recentRain, 1) : '0'} unit={recentRain ? 'mm/h máx.' : undefined} hint={recentRain === null ? 'sem radar' : 'pico no radar · ver mapa'} /> },
    { key: 'prob', title: 'Chance de chuva', onClick: () => go('forecast', { forecastTab: 1 }),
      node: <Stat label="Chance de chuva" value={pct(nextBlock?.rainProbability)} hint={nextBlock ? `ensemble, ${hm(nextBlock.start, tz)}–${hm(nextBlock.end, tz)}` : '—'} /> },
    { key: 'windSpeed', title: 'Vento', onClick: metric('windSpeed', 'Vento'),
      node: <Stat label="Vento" value={num(o?.windSpeed ?? m?.windSpeed, 0)} unit="km/h" hint={`${dir8(o?.windDirection ?? m?.windDirection)} · rajada ${num(o?.windGust ?? m?.windGust, 0)} km/h`} /> },
    { key: 'humidity', title: 'Umidade', onClick: metric('humidity', 'Umidade'),
      node: <Stat label="Umidade" value={num(o?.humidity ?? m?.humidity, 0)} unit="%" hint={o ? 'calculada do METAR' : 'modelo'} /> },
    { key: 'pressure', title: 'Pressão', onClick: metric('pressure', 'Pressão'),
      node: <Stat label="Pressão" value={num(o?.pressure ?? m?.pressure, 0)} unit="hPa" hint={o ? 'QNH medido' : 'nível do mar, modelo'} /> },
    { key: 'uvIndex', title: 'Índice UV', onClick: metric('uvIndex', 'Índice UV'),
      node: <Stat label="Índice UV" value={num(m?.uvIndex, 0)} hint={`${uvLabel(m?.uvIndex)} · modelo`} /> },
    { key: 'cloudCover', title: 'Nuvens', onClick: metric('cloudCover', 'Nebulosidade'),
      node: <Stat label="Nuvens" value={num(m?.cloudCover, 0)} unit="%" hint="modelo" /> },
  ];

  return (
    <Stack spacing={2}>
      {officialNow.length > 0 && (
        <Alert severity="error" variant="filled" onClick={() => go('alerts')} sx={{ cursor: 'pointer', bgcolor: brand.red, borderRadius: '6px' }}>
          <strong>ALERTA OFICIAL · INMET</strong> — {officialNow[0].event} ({officialNow[0].severity})
          {officialNow.length > 1 ? ` e mais ${officialNow.length - 1}` : ''}. Toque para detalhes.
        </Alert>
      )}

      <Scoreboard
        tiles={data.scoreboard}
        tz={tz}
        live={live}
        onTile={(id) =>
          id === 'now' ? metric('temperature', 'Agora')() : id === 'next1h' ? go('forecast', { forecastTab: 0 }) : go('forecast', { forecastTab: 1 })
        }
      />
      <VerdictCard verdict={data.verdict} tz={tz} onOpen={() => openSheet('Por que este veredito', <VerdictDetail data={data} />, brand.green)} />

      <Panel title="Condições atuais" right={m && <WeatherIcon icon={nc.current?.class ? 'rain' : m.icon} night={m.isDay === 0} size={36} />}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
          {stats.map((s) => (
            <Tap key={s.key} onClick={s.onClick} label={`${s.title}: detalhes`}>
              {s.node}
            </Tap>
          ))}
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          {o && <KindBadge kind="observation" label={`MEDIÇÃO · ${o.station} · ${hm(o.observedAt, tz)}`} />}
          {m && <KindBadge kind="model" label={`MODELO · ${hm(m.time, tz)}`} />}
          {nc.available && <KindBadge kind="radar" label={`RADAR · ${hm(nc.latestFrameTime, tz)}`} />}
        </Stack>
        <SourceLine>Toque em qualquer cartão para ver detalhes, a origem do dado e as próximas 24 h.</SourceLine>
      </Panel>

      <Panel
        title="Radar no seu ponto"
        accent={brand.blue}
        right={
          nc.available && (
            <Button size="small" onClick={() => go('map', { mapLayer: 'radar' })}>
              Ver no mapa ›
            </Button>
          )
        }
      >
        {nc.available ? (
          <>
            <RadarStrip nc={nc} tz={tz} />
            <SourceLine>
              RainViewer · quadro de {hm(nc.latestFrameTime, tz)} ({ago(nc.latestFrameTime)}) · resolução ~{num(nc.resolutionKm, 1)} km · passo {nc.stepMinutes} min · barras
              hachuradas = extrapolação
            </SourceLine>
          </>
        ) : (
          <Typography color="text.secondary">Radar indisponível: {nc.reason}</Typography>
        )}
      </Panel>

      {data.stations.length > 0 && (
        <Panel title="Estações próximas" accent={brand.green} dense>
          {data.stations.slice(0, 5).map((s) => (
            <Tap key={s.station} onClick={() => openSheet(`METAR ${s.station}`, <StationDetail s={s} tz={tz} />, brand.green)} label={`Estação ${s.station}`}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }} noWrap>
                    {s.station} · {s.name.split(',')[0]}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {num(s.distanceKm, 0)} km a {s.bearing} · {hm(s.observedAt, tz)} · {s.weather.description.filter(Boolean).join(', ') || 'sem fenômenos'}
                  </Typography>
                </Box>
                <Typography sx={{ fontWeight: 800, fontSize: '1.2rem', pr: 2 }}>{num(s.temperature)}°</Typography>
              </Box>
            </Tap>
          ))}
        </Panel>
      )}
    </Stack>
  );
}
