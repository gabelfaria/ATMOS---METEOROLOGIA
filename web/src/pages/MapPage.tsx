import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, Select, Slider, Stack, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import maplibregl, { type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAlertsGeo, useGrid, useRadarFrames, useSatellite } from '../api/client';
import type { Forecast, Grid } from '../api/types';
import { ago, hm, num } from '../lib/format';
import { useLocation } from '../lib/location';
import { load, save } from '../lib/storage';
import { brand, condensed } from '../theme';
import { colorExpr, PRIMARY_LAYERS, type LayerDef } from './mapLayers';

const STYLE = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

interface Step {
  t: number;
  kind: 'observed' | 'forecast';
  tile?: string; // template de tile (camadas raster observadas)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** O mapa pode já ter sido destruído quando as limpezas dos efeitos filhos rodam. */
function drop(map: maplibregl.Map | null, live: boolean, layers: string[], sources: string[]) {
  if (!map || !live) return;
  try {
    layers.forEach((l) => map.getLayer(l) && map.removeLayer(l));
    sources.forEach((s) => map.getSource(s) && map.removeSource(s));
  } catch {
    /* estilo em recarga */
  }
}

const isoZ = (t: number) => new Date(t * 1000).toISOString().replace('.000', '');

function gridGeoJSON(grid: Grid, varName: string, idx: number, step: number): GeoJSON.FeatureCollection {
  const half = step / 2;
  const feats: GeoJSON.Feature[] = [];
  for (const p of grid.points) {
    const series = p.values[varName] ?? [];
    let v: number | null;
    if (varName === 'precipitation') {
      // acumulado das 3 h que terminam no passo (o ECMWF 0,25° tem passo de 3 h)
      const w = [series[idx - 2], series[idx - 1], series[idx]];
      v = w.every((x) => x !== null && x !== undefined) ? (w as number[]).reduce((a, b) => a + b, 0) : null;
    } else v = series[idx] ?? null;
    if (v === null) continue;
    const dir = p.values.wind_direction_10m?.[idx] ?? null;
    feats.push({
      type: 'Feature',
      properties: { v, dir: dir === null ? null : (dir + 180) % 360, lat: p.lat, lon: p.lon },
      geometry: {
        type: 'Polygon',
        coordinates: [[[p.lon - half, p.lat - half], [p.lon + half, p.lat - half], [p.lon + half, p.lat + half], [p.lon - half, p.lat + half], [p.lon - half, p.lat - half]]],
      },
    });
  }
  return { type: 'FeatureCollection', features: feats };
}

function arrowImage(): ImageData {
  const s = 32;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(16, 28);
  g.lineTo(16, 8);
  g.stroke();
  g.beginPath();
  g.moveTo(16, 2);
  g.lineTo(9, 12);
  g.lineTo(23, 12);
  g.closePath();
  g.fill();
  return g.getImageData(0, 0, s, s);
}

export function MapPage({ data }: { data: Forecast }) {
  const tz = data.location.timezone;
  const { setPlace } = useLocation();
  const { mode, systemMode } = useColorScheme();
  const resolved = (mode === 'system' ? systemMode : mode) === 'light' ? 'light' : 'dark';
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(0);
  const [primary, setPrimary] = useState<string>(() => load('atmos:mapLayer', 'radar'));
  const [opacity, setOpacity] = useState(0.75);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const def = PRIMARY_LAYERS.find((l) => l.id === primary) ?? PRIMARY_LAYERS[0];

  const radar = useRadarFrames(primary === 'radar');
  const sat = useSatellite(primary, primary.startsWith('satellite_'));
  const grid = useGrid(data.location.lat, data.location.lon, def.kind === 'forecast');
  const alertsGeo = useAlertsGeo(showAlerts);

  // --- Linha do tempo (passado observado | futuro previsto)
  const steps: Step[] = useMemo(() => {
    if (primary === 'radar' && radar.data) {
      return radar.data.frames.map((f) => ({ t: f.time, kind: 'observed', tile: `${radar.data!.host}${f.path}/256/{z}/{x}/{y}/2/1_0.png` }));
    }
    if (primary.startsWith('satellite_') && sat.data) {
      return sat.data.times.map((t) => ({ t, kind: 'observed', tile: sat.data!.tileTemplate.replace('{time}', isoZ(t)) }));
    }
    if (def.kind === 'forecast' && grid.data) {
      const now = Date.now() / 1000;
      return grid.data.times
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => t % 10800 === 0 && t >= now - 1800 && i >= 2)
        .map(({ t }) => ({ t, kind: 'forecast' as const }));
    }
    return [];
  }, [primary, radar.data, sat.data, grid.data, def.kind]);

  useEffect(() => {
    setIdx(def.kind === 'observed' ? Math.max(steps.length - 1, 0) : 0);
    setPlaying(false);
  }, [steps, def.kind]);

  useEffect(() => {
    if (!playing || steps.length < 2) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % steps.length), 800);
    return () => window.clearInterval(id);
  }, [playing, steps.length]);

  // --- Criação do mapa
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: STYLE[resolved],
      center: [data.location.lon, data.location.lat],
      zoom: 7,
      maxZoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('load', () => {
      if (!map.hasImage('arrow')) map.addImage('arrow', arrowImage(), { sdf: false });
      new maplibregl.Marker({ color: brand.green }).setLngLat([data.location.lon, data.location.lat]).addTo(map);
      // atribuição compacta começa recolhida (ícone ⓘ) para não cobrir os controles
      map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      setReady((r) => r + 1);
    });
    return () => {
      mapRef.current = null;
      map.remove();
      setReady(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  useEffect(() => {
    mapRef.current?.easeTo({ center: [data.location.lon, data.location.lat] });
  }, [data.location.lat, data.location.lon]);

  const beforeId = () => {
    const layers = mapRef.current?.getStyle().layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
  };

  // --- Camadas raster observadas: uma camada por quadro, alterna opacidade (animação sem piscar)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const ids: string[] = [];
    if (def.kind === 'observed') {
      const maxzoom = primary === 'radar' ? 7 : (sat.data?.maxZoom ?? 6);
      const attribution = primary === 'radar' ? '<a href="https://www.rainviewer.com/">RainViewer</a>' : 'GOES-19 · NASA GIBS';
      steps.forEach((s, i) => {
        const id = `obs-${primary}-${i}`;
        ids.push(id);
        if (!map.getSource(id)) map.addSource(id, { type: 'raster', tiles: [s.tile!], tileSize: 256, maxzoom, attribution });
        if (!map.getLayer(id)) map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-fade-duration': 0 } }, beforeId());
      });
    }
    return () => drop(map, mapRef.current === map, ids, ids);
  }, [ready, steps, def.kind, primary, sat.data?.maxZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || def.kind !== 'observed') return;
    steps.forEach((_, i) => {
      const id = `obs-${primary}-${i}`;
      if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', i === idx ? opacity : 0);
    });
  }, [idx, opacity, steps, ready, primary, def.kind]);

  // --- Campo de modelo (células reais da grade 0,25°)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const remove = () => drop(map, mapRef.current === map, ['grid-arrows', 'grid-fill'], ['grid']);
    if (def.kind !== 'forecast' || !grid.data || !def.gridVar || !steps[idx]) {
      remove();
      return;
    }
    const gi = grid.data.times.indexOf(steps[idx].t);
    const fc = gridGeoJSON(grid.data, def.gridVar, gi, grid.data.step);
    const src = map.getSource('grid') as GeoJSONSource | undefined;
    if (src) src.setData(fc);
    else {
      map.addSource('grid', { type: 'geojson', data: fc, attribution: 'ECMWF IFS via Open-Meteo' });
      map.addLayer({ id: 'grid-fill', type: 'fill', source: 'grid', paint: { 'fill-color': colorExpr(def.legend!) as never, 'fill-opacity': 0.6 } }, beforeId());
      if (def.id === 'wind' || def.id === 'gust') {
        map.addLayer({
          id: 'grid-arrows',
          type: 'symbol',
          source: 'grid',
          layout: { 'icon-image': 'arrow', 'icon-rotate': ['get', 'dir'], 'icon-size': 0.85, 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map' },
        });
      }
    }
    map.setPaintProperty('grid-fill', 'fill-color', colorExpr(def.legend!) as never);
    map.setPaintProperty(
      'grid-fill',
      'fill-opacity',
      (def.id === 'precip' ? ['case', ['<', ['get', 'v'], 0.5], 0, opacity] : opacity) as never,
    );
  }, [ready, grid.data, def, idx, steps, opacity]);

  useEffect(() => {
    const map = mapRef.current;
    return () => drop(map, mapRef.current === map, ['grid-arrows', 'grid-fill'], ['grid']);
  }, [primary]);

  // --- Alertas oficiais (INMET)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const off = () => drop(map, mapRef.current === map, ['alerts-line', 'alerts-fill'], ['alerts']);
    off();
    if (!showAlerts || !alertsGeo.data) return;
    map.addSource('alerts', { type: 'geojson', data: alertsGeo.data, attribution: 'Avisos: INMET' });
    map.addLayer({ id: 'alerts-fill', type: 'fill', source: 'alerts', paint: { 'fill-color': ['coalesce', ['get', 'color'], brand.red], 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'alerts-line', type: 'line', source: 'alerts', paint: { 'line-color': ['coalesce', ['get', 'color'], brand.red], 'line-width': 2 } });
    return off;
  }, [ready, showAlerts, alertsGeo.data]);

  // --- Estações (METAR)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const off = () => drop(map, mapRef.current === map, ['st-label', 'st-dot'], ['stations']);
    off();
    if (!showStations) return;
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: data.stations.map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id: s.station, t: s.temperature === null ? '' : `${s.station} ${Math.round(s.temperature)}°`, rain: s.weather.precipAtStation ? 1 : 0 },
      })),
    };
    map.addSource('stations', { type: 'geojson', data: fc, attribution: 'METAR: NOAA AWC' });
    map.addLayer({ id: 'st-dot', type: 'circle', source: 'stations', paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'rain'], 1], brand.blue, brand.green], 'circle-stroke-color': '#000', 'circle-stroke-width': 1.5 } });
    map.addLayer({
      id: 'st-label',
      type: 'symbol',
      source: 'stations',
      layout: { 'text-field': ['get', 't'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Noto Sans Bold'] },
      paint: { 'text-color': resolved === 'dark' ? '#fff' : '#17171B', 'text-halo-color': resolved === 'dark' ? '#000' : '#fff', 'text-halo-width': 1.5 },
    });
    return off;
  }, [ready, showStations, data.stations, resolved]);

  // --- Toque no mapa: informação na resolução real do produto
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const onClick = (e: MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const parts: string[] = [`<div style="font:600 12px Inter,sans-serif;color:#17171B;max-width:230px">`];
      parts.push(`<div style="font:800 14px 'Barlow Condensed',sans-serif">${lat.toFixed(3)}, ${lng.toFixed(3)}</div>`);
      const st = map.getLayer('st-dot') ? map.queryRenderedFeatures(e.point, { layers: ['st-dot'] }) : [];
      if (st.length) {
        const s = data.stations.find((x) => x.station === st[0].properties?.id);
        if (s)
          parts.push(
            `<div style="margin-top:4px"><b>MEDIÇÃO · METAR ${esc(s.station)}</b><br>${esc(s.name)}<br>${num(s.temperature)} °C · vento ${num(s.windSpeed)} km/h · ${hm(s.observedAt, tz)} (${ago(s.observedAt)})<br><code style="font-size:10px">${esc(s.raw)}</code></div>`,
          );
      }
      const al = map.getLayer('alerts-fill') ? map.queryRenderedFeatures(e.point, { layers: ['alerts-fill'] }) : [];
      al.slice(0, 2).forEach((f) => parts.push(`<div style="margin-top:4px;color:#b0002a"><b>ALERTA OFICIAL INMET</b><br>${esc(String(f.properties?.event))} — ${esc(String(f.properties?.severity))}</div>`));
      if (def.kind === 'forecast' && grid.data && steps[idx]) {
        const gi = grid.data.times.indexOf(steps[idx].t);
        const h = grid.data.step / 2;
        const p = grid.data.points.find((pt) => Math.abs(pt.lat - lat) <= h && Math.abs(pt.lon - lng) <= h);
        if (p && def.gridVar) {
          const fc = gridGeoJSON({ ...grid.data, points: [p] }, def.gridVar, gi, grid.data.step);
          const v = fc.features[0]?.properties?.v as number | undefined;
          parts.push(
            `<div style="margin-top:4px"><b>PREVISÃO · ${esc(def.name)}</b><br>${v === undefined ? '—' : num(v, def.id === 'precip' ? 1 : 0)} ${esc(def.unit)} às ${hm(steps[idx].t, tz)}<br><span style="font-weight:400">Célula ECMWF 0,25° (~28 km) centrada em ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}</span></div>`,
          );
        } else parts.push(`<div style="margin-top:4px;font-weight:400">Fora da área da grade carregada.</div>`);
      }
      if (def.kind === 'observed') parts.push(`<div style="margin-top:4px;font-weight:400">${esc(def.name)}: valor do pixel não é amostrado no mapa; veja a análise de radar do ponto na aba Previsão.</div>`);
      parts.push(`<button id="atmos-use" style="margin-top:6px;padding:4px 8px;border:0;background:#28003D;color:#fff;font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.08em;cursor:pointer">USAR ESTE PONTO</button></div>`);
      const popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(parts.join('')).addTo(map);
      popup.getElement().querySelector('#atmos-use')?.addEventListener('click', () => {
        setPlace({ lat, lon: lng, label: `${lat.toFixed(3)}, ${lng.toFixed(3)}`, source: 'manual' });
        popup.remove();
      });
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [ready, def, grid.data, steps, idx, data.stations, tz, setPlace]);

  const step = steps[idx];
  const loadingLayer = (primary === 'radar' && radar.isLoading) || (primary.startsWith('satellite_') && sat.isLoading) || (def.kind === 'forecast' && grid.isLoading);
  const layerError =
    (primary === 'radar' && radar.error) || (primary.startsWith('satellite_') && sat.error) || (def.kind === 'forecast' && grid.error)
      ? 'Camada indisponível no momento (fonte fora do ar ou limite de uso atingido).'
      : def.kind === 'unavailable'
        ? def.note
        : !loadingLayer && steps.length === 0 && def.kind !== 'static'
          ? 'Sem quadros disponíveis para esta camada.'
          : null;

  return (
    <Box sx={{ position: 'relative', height: { xs: 'calc(100dvh - 190px)', md: 'calc(100dvh - 140px)' }, minHeight: 420, borderRadius: '6px', overflow: 'hidden', border: 1, borderColor: 'divider' }}>
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <div ref={container} style={{ width: '100%', height: '100%' }} />
      </Box>
      {/* Painel de camadas */}
      <Box sx={{ position: 'absolute', top: 8, left: 8, right: 56, maxWidth: 340, bgcolor: 'background.paper', borderRadius: '6px', p: 1.25, boxShadow: 4, opacity: 0.97 }}>
        <Select
          size="small"
          fullWidth
          value={primary}
          onChange={(e) => {
            setPrimary(e.target.value);
            save('atmos:mapLayer', e.target.value);
          }}
          inputProps={{ 'aria-label': 'Camada' }}
        >
          {PRIMARY_LAYERS.map((l) => (
            <MenuItem key={l.id} value={l.id} disabled={l.kind === 'unavailable'}>
              {l.name}
              {l.kind === 'unavailable' ? ' — indisponível' : l.kind === 'forecast' ? ' · previsão' : ' · observado'}
            </MenuItem>
          ))}
        </Select>
        <LayerInfo def={def} />
        {loadingLayer && <Typography variant="caption">Carregando camada…</Typography>}
        {layerError && (
          <Typography variant="caption" sx={{ color: 'error.main', display: 'block' }}>
            {layerError}
          </Typography>
        )}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
          <Typography variant="caption" sx={{ minWidth: 76 }}>
            Opacidade
          </Typography>
          <Slider size="small" min={0.1} max={1} step={0.05} value={opacity} onChange={(_, v) => setOpacity(v as number)} aria-label="Opacidade" />
        </Stack>
        <Stack direction="row" spacing={1}>
          <FormControlLabel control={<Checkbox size="small" checked={showAlerts} onChange={(e) => setShowAlerts(e.target.checked)} />} label={<Typography variant="caption">Alertas INMET</Typography>} />
          <FormControlLabel control={<Checkbox size="small" checked={showStations} onChange={(e) => setShowStations(e.target.checked)} />} label={<Typography variant="caption">Estações</Typography>} />
        </Stack>
      </Box>

      {/* Linha do tempo */}
      {steps.length > 0 && step && (
        <Box sx={{ position: 'absolute', left: 8, right: 8, bottom: 28, bgcolor: brand.purple, color: '#fff', borderRadius: '6px', px: 1.5, py: 0.75, boxShadow: 4 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <IconButton aria-label={playing ? 'Pausar' : 'Reproduzir'} onClick={() => setPlaying((p) => !p)} sx={{ color: brand.green, width: 36, height: 36, border: `2px solid ${brand.green}`, borderRadius: '4px', fontSize: 16 }}>
              {playing ? '❚❚' : '▶'}
            </IconButton>
            <Box sx={{ minWidth: 94 }}>
              <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 22, lineHeight: 1 }}>{hm(step.t, tz)}</Typography>
              <Typography sx={{ fontFamily: condensed, fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', color: step.kind === 'observed' ? brand.green : brand.yellow }}>
                {step.kind === 'observed' ? `OBSERVADO · ${ago(step.t)}` : 'PREVISÃO'}
              </Typography>
            </Box>
            <Slider
              size="small"
              min={0}
              max={steps.length - 1}
              step={1}
              value={idx}
              onChange={(_, v) => {
                setPlaying(false);
                setIdx(v as number);
              }}
              aria-label="Linha do tempo"
              sx={{ color: step.kind === 'observed' ? brand.green : brand.yellow }}
            />
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function LayerInfo({ def }: { def: LayerDef }) {
  return (
    <Box sx={{ mt: 0.75 }}>
      {def.legend && (
        <Box>
          <Box sx={{ display: 'flex', height: 8, borderRadius: '2px', overflow: 'hidden' }}>
            {def.legend.map((s) => (
              <Box key={s.v} sx={{ flex: 1, bgcolor: s.c, border: s.c.startsWith('rgba') ? '1px solid rgba(128,128,128,.3)' : 0 }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex' }}>
            {def.legend.map((s) => (
              <Typography key={s.v} variant="caption" sx={{ flex: 1, fontSize: '0.62rem' }}>
                {s.v}
              </Typography>
            ))}
          </Box>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
        {def.source} · {def.unit}
        {def.note ? ` · ${def.note}` : ''}
        {def.kind === 'forecast' ? ' · passos de 3 h, células = pontos reais da grade' : ''}
      </Typography>
    </Box>
  );
}
