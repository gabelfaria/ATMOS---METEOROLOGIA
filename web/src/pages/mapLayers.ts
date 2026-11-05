// Catálogo de camadas do mapa: fonte, unidade, legenda e natureza (observado × previsto).

export type LayerKind = 'observed' | 'forecast' | 'static' | 'unavailable';

export interface LegendStop {
  v: number;
  c: string;
}

export interface LayerDef {
  id: string;
  name: string;
  kind: LayerKind;
  source: string;
  unit: string;
  gridVar?: string; // variável da grade ECMWF
  legend?: LegendStop[];
  note?: string;
}

export const RADAR_LEGEND: LegendStop[] = [
  // Cores oficiais do esquema Universal Blue (RainViewer) por dBZ
  { v: 10, c: '#cec087' },
  { v: 20, c: '#00a3e0' },
  { v: 30, c: '#005588' },
  { v: 40, c: '#ffaa00' },
  { v: 50, c: '#c10000' },
  { v: 60, c: '#ff77ff' },
];

export const PRIMARY_LAYERS: LayerDef[] = [
  { id: 'radar', name: 'Radar · chuva observada', kind: 'observed', source: 'RainViewer', unit: 'dBZ', legend: RADAR_LEGEND, note: 'Mosaico dos últimos ~120 min, passo de 10 min. Áreas sem radar ficam vazias.' },
  { id: 'satellite_visible', name: 'Satélite visível', kind: 'observed', source: 'GOES-19 via NASA GIBS', unit: 'refletância', note: 'Banda 2 (0,64 µm), 1 km. Escuro à noite.' },
  { id: 'satellite_infrared', name: 'Satélite infravermelho', kind: 'observed', source: 'GOES-19 via NASA GIBS', unit: 'temperatura de brilho', note: 'Banda 13 (10,3 µm), 2 km. Tons claros = topos frios/altos.' },
  { id: 'satellite_geocolor', name: 'Nuvens · GeoColor', kind: 'observed', source: 'GOES-19 via NASA GIBS', unit: 'composição', note: 'Cor verdadeira de dia, infravermelho à noite.' },
  {
    id: 'clouds', name: 'Cobertura de nuvens prevista', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: '%', gridVar: 'cloud_cover',
    legend: [{ v: 0, c: 'rgba(200,200,210,0)' }, { v: 50, c: 'rgba(200,200,210,0.55)' }, { v: 100, c: 'rgba(240,240,250,0.9)' }],
  },
  {
    id: 'precip', name: 'Precipitação prevista', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: 'mm/3 h', gridVar: 'precipitation',
    legend: [{ v: 0.5, c: '#9ed8ff' }, { v: 2, c: '#3488ff' }, { v: 5, c: '#1a4fd6' }, { v: 10, c: '#7b2be2' }, { v: 20, c: '#d61f9e' }, { v: 40, c: '#ff3b5c' }],
  },
  {
    id: 'wind', name: 'Vento (velocidade e direção)', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: 'km/h', gridVar: 'wind_speed_10m',
    legend: [{ v: 0, c: '#1b2b4a' }, { v: 15, c: '#2f6db5' }, { v: 30, c: '#2fb59a' }, { v: 45, c: '#e8d23a' }, { v: 60, c: '#f08a24' }, { v: 80, c: '#d61f45' }],
  },
  {
    id: 'gust', name: 'Rajadas de vento', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: 'km/h', gridVar: 'wind_gusts_10m',
    legend: [{ v: 0, c: '#1b2b4a' }, { v: 20, c: '#2f6db5' }, { v: 40, c: '#2fb59a' }, { v: 60, c: '#e8d23a' }, { v: 80, c: '#f08a24' }, { v: 100, c: '#d61f45' }],
  },
  {
    id: 'temp', name: 'Temperatura', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: '°C', gridVar: 'temperature_2m',
    legend: [{ v: 5, c: '#3b4cc0' }, { v: 15, c: '#7aa6f7' }, { v: 22, c: '#f2f0e6' }, { v: 28, c: '#f6a35c' }, { v: 34, c: '#d8452d' }, { v: 40, c: '#8b0a26' }],
  },
  {
    id: 'pressure', name: 'Pressão ao nível do mar', kind: 'forecast', source: 'ECMWF IFS 0,25° (Open-Meteo)', unit: 'hPa', gridVar: 'pressure_msl',
    legend: [{ v: 995, c: '#5b2a86' }, { v: 1005, c: '#3488ff' }, { v: 1013, c: '#f2f0e6' }, { v: 1020, c: '#f6a35c' }, { v: 1030, c: '#b8322a' }],
  },
  { id: 'lightning', name: 'Descargas elétricas', kind: 'unavailable', source: '—', unit: '—', note: 'Sem fonte licenciada integrada.' },
];

export function colorExpr(legend: LegendStop[]): unknown[] {
  const e: unknown[] = ['interpolate', ['linear'], ['get', 'v']];
  legend.forEach((s) => e.push(s.v, s.c));
  return e;
}
