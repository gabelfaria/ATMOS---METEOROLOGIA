// Weather Intelligence Engine rodando no aparelho (porta de engine/service.py) + roteador "/api/*" local.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Audit, Block, CatalogSource, Forecast, HourRow, ModelNow, Nowcast, Observation, SourceStatus, Tile } from '../api/types';
import { auditForPoint, deleteLocal, previousSummary, recordIssue, skillForWeights } from './audit';
import * as C from './consensus';
import { SourceError } from './net';
import * as O from './obs';
import * as OM from './openmeteo';
import * as R from './radar';
import { buildVerdict, estimatedAlerts } from './verdict';

const WMO: Record<number, [string, string]> = {
  0: ['Céu limpo', 'clear'], 1: ['Predomínio de sol', 'mostly_clear'], 2: ['Parcialmente nublado', 'partly_cloudy'], 3: ['Nublado', 'cloudy'],
  45: ['Nevoeiro', 'fog'], 48: ['Nevoeiro', 'fog'], 51: ['Garoa fraca', 'drizzle'], 53: ['Garoa', 'drizzle'], 55: ['Garoa forte', 'drizzle'],
  61: ['Chuva fraca', 'rain_light'], 63: ['Chuva moderada', 'rain'], 65: ['Chuva forte', 'rain_heavy'], 80: ['Pancadas fracas', 'rain_light'],
  81: ['Pancadas de chuva', 'rain'], 82: ['Pancadas fortes', 'rain_heavy'], 95: ['Trovoada', 'storm'], 96: ['Trovoada com granizo', 'storm'], 99: ['Trovoada com granizo forte', 'storm'],
};

const settle = async <T,>(p: Promise<T>): Promise<T | SourceError> => {
  try {
    return await p;
  } catch (e) {
    return e instanceof SourceError ? e : new SourceError('interno', String((e as Error)?.message ?? e));
  }
};
const isErr = (x: unknown): x is SourceError => x instanceof SourceError;
const src = (id: string, name: string, kind: string, status: SourceStatus['status'], message?: string | null, extra: Partial<SourceStatus> = {}): SourceStatus => ({ id, name, kind, status, message: message ?? null, ...extra });

export async function forecast(lat: number, lon: number): Promise<Forecast> {
  const [mm, cur, ensH, ensD, nc0, met, inm, aud] = await Promise.all([
    settle(OM.fetchMultimodel(lat, lon)), settle(OM.fetchCurrent(lat, lon)), settle(OM.fetchEnsembleHourly(lat, lon)), settle(OM.fetchEnsembleDaily(lat, lon)),
    settle(R.nowcast(lat, lon)), settle(O.fetchNearbyMetar(lat, lon)), settle(O.fetchInmet()), settle(auditForPoint(lat, lon)),
  ]);
  const now = Date.now() / 1000;
  const sources: SourceStatus[] = [];
  const tzSrc = !isErr(cur) ? cur : !isErr(mm) ? mm : null;
  const tz = tzSrc?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const off = tzSrc?.utcOffsetSeconds ?? -new Date().getTimezoneOffset() * 60;
  const audit: Audit = isErr(aud) ? { available: false, reason: aud.message } : aud;

  let weights: C.Weights = {};
  let hours: HourRow[] = [];
  let blocks: Block[] = [];
  let agreement: Forecast['mediumTerm']['models'] = [];
  const eh = isErr(ensH) ? null : ensH;
  if (!isErr(mm)) {
    const avail = C.availableModels(mm);
    weights = C.modelWeights(avail, skillForWeights(audit));
    for (const m of OM.DETERMINISTIC_MODELS) {
      const st = avail.includes(m.id) ? (mm.stale ? 'stale' : 'ok') : 'unavailable';
      sources.push(src(`model:${m.id}`, m.name, 'model', st, st === 'unavailable' ? 'Sem dados para este ponto/horizonte' : null, { fetchedAt: mm.fetchedAt, resolutionKm: m.resolutionKm }));
    }
    hours = C.hourlyConsensus(mm, weights, now - 3600, now + 48 * 3600);
    blocks = C.precipBlocks(mm, eh, weights, now - 3 * 3600, now + 48 * 3600);
    agreement = C.modelAgreement(mm, hours.filter((h) => h.time >= now), blocks, weights);
  } else {
    sources.push(src('models', 'Modelos numéricos (Open-Meteo)', 'model', 'error', mm.message));
    if (eh) blocks = C.precipBlocks({ times: [], models: {} } as any, eh, {}, now - 3 * 3600, now + 48 * 3600);
  }
  sources.push(eh ? src('ensemble:hourly', 'Ensembles 0–72 h (ECMWF ENS, NCEP GEFS, DWD ICON-EPS)', 'ensemble', eh.stale ? 'stale' : 'ok', null, { fetchedAt: eh.fetchedAt }) : src('ensemble:hourly', 'Ensembles 0–72 h', 'ensemble', 'error', (ensH as SourceError).message));

  let obs: Observation | null = null;
  let stations: Observation[] = [];
  if (!isErr(met)) {
    stations = met.stations;
    const s = stations.find((x) => x.distanceKm <= 25);
    if (s && now - s.observedAt <= 90 * 60) {
      obs = s;
      sources.push(src('obs:metar', `METAR ${s.station} (${Math.round(s.distanceKm)} km)`, 'observation', 'ok', null, { dataTime: s.observedAt }));
    } else if (s) sources.push(src('obs:metar', `METAR ${s.station}`, 'observation', 'stale', `Última observação há ${Math.round((now - s.observedAt) / 60)} min`, { dataTime: s.observedAt }));
    else sources.push(src('obs:metar', 'Estações METAR', 'observation', 'unavailable', 'Nenhuma estação a até 25 km'));
  } else sources.push(src('obs:metar', 'Estações METAR', 'observation', 'error', met.message));

  const nc: Nowcast = isErr(nc0) ? { available: false, reason: nc0.message } : nc0;
  sources.push(nc.available ? src('radar:rainviewer', 'Radar RainViewer', 'radar', (nc as any).stale ? 'stale' : 'ok', null, { dataTime: nc.latestFrameTime }) : src('radar:rainviewer', 'Radar RainViewer', 'radar', isErr(nc0) ? 'error' : 'unavailable', nc.reason));

  const official = isErr(inm) ? [] : O.alertsForPoint(inm.alerts, lat, lon, now);
  sources.push(isErr(inm) ? src('alerts:inmet', 'Avisos INMET', 'official', 'error', inm.message) : src('alerts:inmet', 'Avisos INMET', 'official', inm.stale ? 'stale' : 'ok', null, { fetchedAt: inm.fetchedAt }));
  sources.push(isErr(ensD) ? src('ensemble:daily', 'Ensembles 16 dias', 'ensemble', 'error', ensD.message) : src('ensemble:daily', 'Ensembles 16 dias', 'ensemble', ensD.stale ? 'stale' : 'ok', null, { fetchedAt: ensD.fetchedAt }));

  let modelNow: ModelNow | null = null;
  if (!isErr(cur)) {
    const c = cur.current;
    const w = WMO[c.weather_code] ?? [c.weather_code === undefined ? null : `Código ${c.weather_code}`, 'unknown'];
    modelNow = {
      kind: 'model', source: 'Open-Meteo (melhor modelo disponível)', time: c.time, temperature: c.temperature_2m ?? null, apparentTemperature: c.apparent_temperature ?? null,
      humidity: c.relative_humidity_2m ?? null, precipitation: c.precipitation ?? null, weatherCode: c.weather_code ?? null, condition: w[0] as string | null, icon: w[1],
      cloudCover: c.cloud_cover ?? null, pressure: c.pressure_msl ?? null, windSpeed: c.wind_speed_10m ?? null, windDirection: c.wind_direction_10m ?? null,
      windGust: c.wind_gusts_10m ?? null, uvIndex: c.uv_index ?? null, isDay: c.is_day ?? null,
    };
    sources.push(src('model:current', 'Condição atual (modelo)', 'model', cur.stale ? 'stale' : 'ok', null, { dataTime: c.time }));
  }

  const verdict = buildVerdict({ now, tz: off, nc, obs, blocks, official });
  const n24 = hours.filter((h) => h.time >= now && h.time <= now + 86400);
  const b24 = blocks.filter((b) => b.end > now && b.start < now + 86400);
  const temps = n24.map((h) => h.temperature?.value).filter((v): v is number => v !== null && v !== undefined);
  const rain = b24.map((b) => b.precipMedian).filter((v): v is number => v !== null);
  const probs = b24.map((b) => b.rainProbability).filter((v): v is number => v !== null);
  const gusts = n24.map((h) => h.windGust?.value).filter((v): v is number => v !== null && v !== undefined);
  const s24 = {
    tmax: temps.length ? Math.max(...temps) : null, tmin: temps.length ? Math.min(...temps) : null,
    rain24h: rain.length ? Math.round(rain.reduce((a, c) => a + c, 0) * 10) / 10 : null,
    maxProb24h: probs.length ? Math.max(...probs) : null, maxGust24h: gusts.length ? Math.max(...gusts) : null,
  };
  const estimated = estimatedAlerts({ now, tz: off, nc, obs, blocks, previous: previousSummary(lat, lon, now - 1800), summary: s24 });

  const mediumConf = blocks.filter((b) => b.end > now).map((b) => {
    const sp = hours.filter((h) => b.start < h.time && h.time <= b.end).map((h) => h.temperature?.spread).filter((v): v is number => v !== null && v !== undefined);
    const [confidence, reasons] = C.mediumConfidence((b.start - now) / 3600 + 1.5, sp.length ? Math.max(...sp) : null, b.modelAgreementWet, b.probabilitySpread);
    return { start: b.start, end: b.end, confidence, reasons };
  });
  // Radar vê chuva que os modelos não previam → a confiança do bloco atual não pode ser alta
  const radarWet = nc.available && (!!nc.current?.class || (nc.forecast ?? []).some((x) => x.class));
  const cur0 = mediumConf[0] && blocks.find((b) => b.start === mediumConf[0].start);
  if (radarWet && cur0 && cur0.rainProbability !== null && cur0.rainProbability < 0.25) {
    mediumConf[0].confidence = 'low';
    mediumConf[0].reasons.push('Radar observa chuva que os modelos não previam neste período');
  }
  const days = !isErr(ensD) && ensD.times.length ? C.dailyEnsemble(ensD, ensD.times[0]) : [];

  if (hours.length) {
    recordIssue(lat, lon, {
      issuedAt: Math.floor(now),
      temps: hours.filter((h) => h.time > now && h.temperature?.value != null).map((h) => [h.time, Math.round((h.time - now) / 3600), h.temperature!.value!] as [number, number, number]).filter(([, l]) => l >= 1 && l <= 48),
      probs: blocks.filter((b) => b.start >= now && b.rainProbability !== null).map((b) => [b.start, b.rainProbability!] as [number, number]),
      rain24h: s24.rain24h, maxProb24h: s24.maxProb24h, maxGust24h: s24.maxGust24h,
    });
  }

  return {
    location: { lat, lon, timezone: tz, utcOffsetSeconds: off, elevation: isErr(mm) ? null : mm.elevation, gridLat: isErr(mm) ? null : mm.gridLat, gridLon: isErr(mm) ? null : mm.gridLon },
    generatedAt: Math.floor(now),
    current: { model: modelNow, observation: obs, radar: nc.available ? nc.current ?? null : null },
    scoreboard: scoreboard(now, modelNow, obs, nc, blocks, s24),
    verdict,
    shortTerm: nc,
    mediumTerm: {
      hours, blocks, models: agreement, riskWindows: C.riskWindows(blocks), confidence: mediumConf,
      notes: [
        'Valores consolidados = mediana ponderada entre modelos (não média simples).',
        'Precipitação em blocos de 3 h (passo real dos ensembles ECMWF/GEFS).',
        'Probabilidade = fração de membros dos ensembles (bruta, não calibrada), média entre sistemas.',
        'Concordância entre modelos não é probabilidade.',
      ],
    },
    longTerm: {
      days: days.filter((d) => d.leadDays >= 0),
      beyond16Days: { available: false, reason: 'Tendências além de 16 dias exigem previsão sazonal/subsazonal; integração futura.' },
      notes: ['Faixas P10–P90 combinam ECMWF ENS, NCEP GEFS e ICON-EPS com peso igual por sistema.', 'A confiança é limitada pelo prazo: alta só até 2 dias, baixa após 7 dias.'],
    },
    alerts: { official, estimated },
    stations: stations.slice(0, 8),
    weights,
    audit,
    sources,
    attribution: [OM.ATTRIBUTION, R.ATTRIBUTION, O.METAR_ATTR, O.INMET_ATTR],
  };
}

function scoreboard(now: number, m: ModelNow | null, o: Observation | null, nc: Nowcast, blocks: Block[], s24: { tmax: number | null; tmin: number | null; rain24h: number | null; maxProb24h: number | null }): Tile[] {
  const t: Tile[] = [];
  if (o && typeof o.temperature === 'number')
    t.push({ id: 'now', label: 'AGORA', value: o.temperature, unit: '°C', caption: o.weather.description.filter(Boolean).join(', ') || m?.condition || null, kind: 'observation', source: `METAR ${o.station}`, time: o.observedAt });
  else if (m) t.push({ id: 'now', label: 'AGORA', value: m.temperature, unit: '°C', caption: m.condition, kind: 'model', source: m.source, time: m.time });
  if (nc.available && nc.current?.class && t.length) t[0].caption = `Chuva ${nc.current.class} (radar)`;
  const order = ['fraca', 'moderada', 'forte', 'muito forte'];
  if (nc.available && nc.forecast?.length) {
    const cl = nc.forecast.filter((s) => s.lead <= 60 && s.class).map((s) => s.class!);
    const worst = cl.length ? cl.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : null;
    if (nc.arrival)
      t.push({ id: 'next1h', label: 'PRÓXIMA HORA', value: nc.arrival.centralMinutes, unit: 'min', caption: `Chuva ${nc.arrival.maxClass ?? 'fraca'} chegando`, kind: 'nowcast', source: 'Radar RainViewer (extrapolação)', time: nc.latestFrameTime ?? null, confidence: nc.confidence });
    else
      t.push({ id: 'next1h', label: 'PRÓXIMA HORA', value: null, unit: null, text: worst ? `CHUVA ${worst.toUpperCase()}` : 'SEM CHUVA', caption: 'Extrapolação do radar', kind: 'nowcast', source: 'Radar RainViewer (extrapolação)', time: nc.latestFrameTime ?? null, confidence: nc.confidence });
  } else {
    const b = blocks.find((x) => x.end > now + 1800);
    if (b?.rainProbability !== null && b?.rainProbability !== undefined)
      t.push({ id: 'next1h', label: 'PRÓXIMA HORA', value: Math.round(b.rainProbability * 100), unit: '%', caption: 'Chance de chuva (ensemble, bloco 3 h)', kind: 'ensemble', source: 'Ensembles Open-Meteo', time: b.start });
    else t.push({ id: 'next1h', label: 'PRÓXIMA HORA', value: null, unit: null, text: 'INDISPONÍVEL', caption: 'Sem radar nem ensemble', kind: 'unavailable', source: null, time: null });
  }
  if (s24.tmax !== null && s24.tmin !== null) {
    const cap = [s24.rain24h !== null ? `Chuva ${Math.round(s24.rain24h)} mm` : null, s24.maxProb24h !== null ? `chance máx. ${Math.round(s24.maxProb24h * 100)}%` : null].filter(Boolean).join(' · ');
    t.push({ id: 'next24h', label: 'PRÓXIMAS 24H', value: Math.round(s24.tmax), value2: Math.round(s24.tmin), unit: '°C', caption: cap || null, kind: 'consensus', source: 'Consenso de modelos + ensembles', time: null });
  }
  return t;
}

const CATALOG: CatalogSource[] = [
  { id: 'open-meteo', name: 'Open-Meteo (ECMWF IFS, GFS, ICON, UKMO, ARPEGE, GEM)', kind: 'model', status: 'integrated', access: 'API pública gratuita (uso não comercial), sem chave', license: 'CC BY 4.0', url: 'https://open-meteo.com/en/docs' },
  { id: 'open-meteo-ensemble', name: 'Open-Meteo Ensemble (ECMWF ENS, NCEP GEFS, ICON-EPS)', kind: 'ensemble', status: 'integrated', access: 'API pública', license: 'CC BY 4.0', url: 'https://open-meteo.com/en/docs/ensemble-api' },
  { id: 'rainviewer', name: 'RainViewer — radar (passado, 10 min)', kind: 'radar', status: 'integrated', access: 'API pública; sem quadros futuros', license: 'Atribuição a RainViewer', url: 'https://www.rainviewer.com/api/weather-maps-api.html' },
  { id: 'metar', name: 'METAR — NOAA Aviation Weather Center', kind: 'observation', status: 'integrated', access: 'API pública', license: 'Domínio público; dados DECEA', url: 'https://aviationweather.gov/data/api/' },
  { id: 'inmet-avisos', name: 'INMET — avisos oficiais', kind: 'official', status: 'integrated', access: 'JSON público do portal de avisos', license: 'Citar INMET', url: 'https://avisos.inmet.gov.br/' },
  { id: 'gibs-goes19', name: 'GOES-19 via NASA GIBS', kind: 'satellite', status: 'integrated', access: 'WMTS público', license: 'Citar NASA GIBS', url: 'https://nasa-gibs.github.io/gibs-api-docs/' },
  { id: 'inpe-cptec-goes', name: 'INPE/CPTEC — GOES-19 (DSAT)', kind: 'satellite', status: 'future', access: 'Sem serviço de tiles documentado', license: 'Verificar termos do INPE', url: 'https://data.inpe.br/dados/goes/' },
  { id: 'inea', name: 'INEA-RJ — radares e pluviômetros', kind: 'observation', status: 'blocked', access: 'Sem API documentada; exige autorização', license: '—', url: 'https://alertadecheias.inea.rj.gov.br/' },
  { id: 'cemaden', name: 'Cemaden — pluviômetros', kind: 'observation', status: 'blocked', access: 'Exige cadastro/token; sem scraping', license: '—', url: 'https://mapainterativo.cemaden.gov.br/' },
  { id: 'maptiler-weather', name: 'MapTiler Weather', kind: 'model', status: 'optional', access: 'Requer chave/plano pago', license: 'Comercial', url: 'https://www.maptiler.com/weather/' },
  { id: 'lightning', name: 'Descargas elétricas', kind: 'observation', status: 'unavailable', access: 'Sem fonte licenciada gratuita', license: '—', url: null },
];

const COORD = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/;

/** Implementa localmente os mesmos endpoints do backend. */
export async function localApi(path: string, p: Record<string, string>): Promise<unknown> {
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  const wrap = async <T,>(f: () => Promise<T>) => {
    try {
      return await f();
    } catch (e) {
      throw new Error(e instanceof SourceError ? `${e.source}: ${e.message}` : String(e));
    }
  };
  if (path === '/api/forecast') return forecast(lat, lon);
  if (path === '/api/radar/frames') return wrap(R.fetchMaps);
  if (path.startsWith('/api/satellite/')) return wrap(() => O.satelliteTimes(path.split('/').pop()!));
  if (path === '/api/grid') return wrap(() => OM.fetchGrid(lat, lon));
  if (path === '/api/alerts/geojson') return wrap(async () => O.alertsGeoJSON((await O.fetchInmet()).alerts));
  if (path === '/api/audit') return auditForPoint(lat, lon);
  if (path === '/api/sources') return { sources: CATALOG };
  if (path === '/api/reverse') {
    try {
      return await O.nominatimReverse(lat, lon);
    } catch {
      return { label: null };
    }
  }
  if (path === '/api/privacy') return { deletedRows: deleteLocal(lat, lon) };
  if (path === '/api/geocode') {
    const q = p.q ?? '';
    const m = COORD.exec(q);
    if (m) {
      const a = Number(m[1].replace(',', '.'));
      const b = Number(m[2].replace(',', '.'));
      if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { results: [{ name: 'Coordenadas', label: `${a.toFixed(4)}, ${b.toFixed(4)}`, lat: a, lon: b, source: 'entrada manual' }] };
    }
    const errors: string[] = [];
    let results: any[] = [];
    try {
      results = await OM.geocode(q);
    } catch (e) {
      errors.push((e as Error).message);
    }
    if (/\d|,/.test(q) || !results.length) {
      try {
        results = [...(await O.nominatimSearch(q)), ...results];
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { results: results.slice(0, 10), errors };
  }
  throw new Error(`Rota desconhecida: ${path}`);
}
