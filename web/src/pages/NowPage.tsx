import { Alert, Box, Stack, Typography } from '@mui/material';
import type { Forecast } from '../api/types';
import { RadarStrip } from '../components/charts';
import { Scoreboard, VerdictCard } from '../components/Scoreboard';
import { KindBadge, Panel, SourceLine, Stat } from '../components/ui';
import { WeatherIcon } from '../components/WeatherIcon';
import { ago, dir8, hm, num, pct, uvLabel } from '../lib/format';
import { brand } from '../theme';

export function NowPage({ data, live, onOpenAlerts }: { data: Forecast; live: boolean; onOpenAlerts: () => void }) {
  const tz = data.location.timezone;
  const m = data.current.model;
  const o = data.current.observation;
  const nc = data.shortTerm;
  const officialNow = data.alerts.official.filter((a) => a.inForce);
  const recentRain = nc.available
    ? (nc.observed ?? []).reduce((mx, s) => Math.max(mx, s.rateMmH ?? 0), 0)
    : null;
  const nextBlock = data.mediumTerm.blocks.find((b) => b.end > Date.now() / 1000);

  return (
    <Stack spacing={2}>
      {officialNow.length > 0 && (
        <Alert
          severity="error"
          variant="filled"
          onClick={onOpenAlerts}
          sx={{ cursor: 'pointer', bgcolor: brand.red, borderRadius: '6px' }}
        >
          <strong>ALERTA OFICIAL · INMET</strong> — {officialNow[0].event} ({officialNow[0].severity})
          {officialNow.length > 1 ? ` e mais ${officialNow.length - 1}` : ''}. Toque para detalhes.
        </Alert>
      )}

      <Scoreboard tiles={data.scoreboard} tz={tz} live={live} />
      <VerdictCard verdict={data.verdict} tz={tz} />

      <Panel
        title="Condições atuais"
        right={m && <WeatherIcon icon={nc.current?.class ? 'rain' : m.icon} night={m.isDay === 0} size={36} />}
      >
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
          <Stat
            label="Temperatura"
            value={num(o?.temperature ?? m?.temperature, o ? 0 : 1)}
            unit="°C"
            hint={o ? `medida em ${o.station}` : 'estimada por modelo'}
          />
          <Stat label="Sensação" value={num(m?.apparentTemperature, 0)} unit="°C" hint="modelo" />
          <Stat
            label="Condição"
            value={<Box component="span" sx={{ fontSize: 18 }}>{nc.current?.class ? `Chuva ${nc.current.class}` : m?.condition ?? '—'}</Box>}
            hint={nc.current?.class ? 'radar' : 'modelo'}
          />
          <Stat
            label="Chuva recente (2 h)"
            value={recentRain === null ? '—' : recentRain > 0 ? num(recentRain, 1) : '0'}
            unit={recentRain ? 'mm/h máx.' : undefined}
            hint={recentRain === null ? 'sem radar' : 'pico estimado pelo radar'}
          />
          <Stat
            label="Chance de chuva"
            value={pct(nextBlock?.rainProbability)}
            hint={nextBlock ? `ensemble, ${hm(nextBlock.start, tz)}–${hm(nextBlock.end, tz)}` : '—'}
          />
          <Stat
            label="Vento"
            value={num(o?.windSpeed ?? m?.windSpeed, 0)}
            unit="km/h"
            hint={`${dir8(o?.windDirection ?? m?.windDirection)} · rajada ${num(o?.windGust ?? m?.windGust, 0)} km/h ${o?.windGust ? '(medida)' : '(modelo)'}`}
          />
          <Stat label="Umidade" value={num(o?.humidity ?? m?.humidity, 0)} unit="%" hint={o ? 'calculada do METAR' : 'modelo'} />
          <Stat label="Pressão" value={num(o?.pressure ?? m?.pressure, 0)} unit="hPa" hint={o ? 'QNH medido' : 'nível do mar, modelo'} />
          <Stat label="Índice UV" value={num(m?.uvIndex, 0)} hint={`${uvLabel(m?.uvIndex)} · modelo`} />
          {o?.visibilityKm !== null && o?.visibilityKm !== undefined && (
            <Stat label="Visibilidade" value={num(o.visibilityKm, 0)} unit="km" hint="medida" />
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          {o && <KindBadge kind="observation" label={`MEDIÇÃO · ${o.station} · ${hm(o.observedAt, tz)}`} />}
          {m && <KindBadge kind="model" label={`MODELO · ${hm(m.time, tz)}`} />}
          {nc.available && <KindBadge kind="radar" label={`RADAR · ${hm(nc.latestFrameTime, tz)}`} />}
        </Stack>
        {o && (
          <SourceLine>
            Estação {o.name} a {num(o.distanceKm, 0)} km ({o.bearing}). METAR: <code>{o.raw}</code>
          </SourceLine>
        )}
      </Panel>

      <Panel title="Radar no seu ponto" accent={brand.blue}>
        {nc.available ? (
          <>
            <RadarStrip nc={nc} tz={tz} />
            <SourceLine>
              RainViewer · quadro de {hm(nc.latestFrameTime, tz)} ({ago(nc.latestFrameTime)}) · resolução ~{num(nc.resolutionKm, 1)} km · passo{' '}
              {nc.stepMinutes} min · barras hachuradas = extrapolação
            </SourceLine>
          </>
        ) : (
          <Typography color="text.secondary">Radar indisponível: {nc.reason}</Typography>
        )}
      </Panel>
    </Stack>
  );
}
