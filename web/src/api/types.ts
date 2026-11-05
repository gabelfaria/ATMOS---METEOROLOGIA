// Tipos espelhando as respostas do backend (atmos/engine/service.py).

export type Confidence = 'high' | 'moderate' | 'low';
export type DataKind =
  | 'observation'
  | 'model'
  | 'nowcast'
  | 'ensemble'
  | 'consensus'
  | 'unavailable'
  | 'official'
  | 'estimated'
  | 'radar'
  | 'archive';

export interface Place {
  lat: number;
  lon: number;
  label: string;
  source: 'gps' | 'manual';
  accuracy?: number;
}

export interface GeoResult {
  name: string;
  label: string;
  lat: number;
  lon: number;
  timezone?: string | null;
  source: string;
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: string;
  status: 'ok' | 'stale' | 'unavailable' | 'error';
  message?: string | null;
  fetchedAt?: number;
  dataTime?: number;
  resolutionKm?: number;
  attribution?: string;
}

export interface Range {
  value: number | null;
  min: number;
  max: number;
  spread: number | null;
  n: number;
}

export interface HourRow {
  time: number;
  temperature: Range | null;
  apparentTemperature: Range | null;
  humidity: Range | null;
  cloudCover: Range | null;
  visibility: Range | null;
  pressure: Range | null;
  windSpeed: Range | null;
  windGust: Range | null;
  cape: Range | null;
  windDirection: number | null;
}

export interface EnsembleProb {
  members: number;
  pAny: number;
  pModerate: number;
  pHeavy: number;
  p50: number;
  p90: number;
  pGustStrong: number | null;
}

export interface Block {
  start: number;
  end: number;
  precipByModel: Record<string, number | null>;
  precipMedian: number | null;
  precipMax: number | null;
  modelAgreementWet: number | null;
  modelsCount: number;
  capeMedian: number | null;
  gustMedian: number | null;
  gustMax: number | null;
  ensemble: Record<string, EnsembleProb>;
  rainProbability: number | null;
  moderateProbability: number | null;
  heavyProbability: number | null;
  gustStrongProbability: number | null;
  probabilitySpread: number | null;
}

export interface ModelRow {
  model: string;
  name: string;
  provider: string;
  resolutionKm?: number;
  available: boolean;
  hoursCovered?: number;
  tempMax?: number;
  tempMin?: number;
  precipTotal?: number | null;
  gustMax?: number | null;
  meanAbsDiffFromConsensus?: number | null;
  agreement: 'concorda' | 'parcial' | 'diverge' | null;
  weight?: number;
  weightReasons?: string[];
}

export interface Quantiles {
  p10: number | null;
  p50: number | null;
  p90: number | null;
}

export interface Day {
  date: number;
  leadDays: number;
  tmax: Quantiles;
  tmin: Quantiles;
  precip: Quantiles & { pAny: number | null; p10mm: number | null; p30mm: number | null };
  gust: { p50: number | null; p90: number | null };
  systems: Record<string, { name: string; members: number; tmaxMedian: number | null; precipMedian: number | null; pRain: number | null }>;
  divergence: { rainProbability: number | null; tmaxMedian: number | null };
  confidence: Confidence;
  confidenceReasons: string[];
}

export interface RadarStep {
  time?: number;
  lead?: number;
  dbz: number | null;
  rateMmH: number;
  class: string | null;
  inDomain?: boolean;
}

export interface Nowcast {
  available: boolean;
  reason?: string;
  method?: string;
  resolutionKm?: number;
  domainRadiusKm?: number;
  stepMinutes?: number;
  latestFrameTime?: number;
  dataAgeMinutes?: number;
  observed?: RadarStep[];
  current?: RadarStep;
  echoFraction?: number;
  nearestEcho?: { distanceKm: number; direction: string; bearing: number } | null;
  motion?: {
    speedKmh: number;
    towardDeg: number;
    toward: string;
    from: string;
    pairs: number;
    spreadKmh: number | null;
    rejected: string[];
  } | null;
  forecast?: (RadarStep & { lead: number; time: number })[];
  arrival?: {
    centralMinutes: number;
    earliestMinutes: number;
    latestMinutes: number | null;
    durationMinutes: number;
    durationTruncated: boolean;
    maxClass: string | null;
    from: string;
  } | null;
  limitations?: string[];
  confidence?: Confidence;
  confidenceReasons?: string[];
  coverage?: { covered: boolean; pointFraction: number; areaFraction: number };
}

export interface Observation {
  station: string;
  name: string;
  lat: number;
  lon: number;
  observedAt: number;
  temperature: number | null;
  dewpoint: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  windDirection: number | null;
  pressure: number | null;
  visibilityKm: number | null;
  weather: {
    raw: string;
    precipAtStation: boolean;
    precipVicinity: boolean;
    thunder: boolean;
    thunderVicinity: boolean;
    intensity: string | null;
    description: string[];
  };
  raw: string;
  distanceKm: number;
  bearing: string;
  recentPrecip?: boolean;
}

export interface ModelNow {
  kind: 'model';
  source: string;
  time: number;
  temperature: number | null;
  apparentTemperature: number | null;
  humidity: number | null;
  precipitation: number | null;
  weatherCode: number | null;
  condition: string | null;
  icon: string;
  cloudCover: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  windGust: number | null;
  uvIndex: number | null;
  isDay: number | null;
}

export interface Tile {
  id: 'now' | 'next1h' | 'next24h';
  label: string;
  value: number | null;
  value2?: number;
  unit: string | null;
  text?: string;
  caption: string | null;
  kind: DataKind;
  source: string | null;
  time: number | null;
  confidence?: Confidence;
}

export interface Verdict {
  horizon: string;
  summary: string;
  text: string;
  rainProbability: number | null;
  rainProbabilityKind: string | null;
  estimatedArrivalMinutes: number | null;
  arrivalWindowMinutes: [number, number | null] | null;
  confidence: Confidence;
  confidenceLabel: string;
  confidenceReason: string | null;
  mainSource: string | null;
  sources: string[];
  dataTime: number | null;
  lastUpdated: number;
}

export interface OfficialAlert {
  id: string;
  kind: 'official';
  authority: string;
  event: string;
  severity: string;
  level: number;
  color: string;
  start: number | null;
  end: number | null;
  risks: string[];
  instructions: string[];
  states: string;
  period: string;
  inForce: boolean;
  url: string;
  source: string;
}

export interface EstimatedAlert {
  id: string;
  dedupeKey: string;
  kind: 'estimated';
  type: string;
  title: string;
  detail: string;
  severity: 'info' | 'attention' | 'high';
  reasons: string[];
  start: number | null;
  end: number | null;
  basis: string;
  issuedAt: number;
}

export interface AuditLead {
  temperature: { mae: number | null; bias: number | null; n: number };
  precipitation: {
    hits: number;
    misses: number;
    falseAlarms: number;
    correctNegatives: number;
    n: number;
    pod: number | null;
    far: number | null;
    csi: number | null;
  };
}

export interface Audit {
  available: boolean;
  reason?: string;
  station?: { station: string; name: string; lat: number; lon: number; distanceKm: number };
  observationsUsed?: number;
  periodStart?: number;
  periodEnd?: number;
  archive?: {
    models: { model: string; name: string; leads: Record<'day1' | 'day2', AuditLead> }[];
    best: { declared: boolean; reason: string; model?: string; name?: string; leader?: string };
  };
  own?: {
    temperature: Record<string, { mae: number; n: number }>;
    rainProbability: { brier: number | null; brierSkillVsSampleClimatology: number | null; n: number };
  };
  notes?: string[];
}

export interface Forecast {
  location: {
    lat: number;
    lon: number;
    timezone: string;
    utcOffsetSeconds: number;
    elevation: number | null;
    gridLat: number | null;
    gridLon: number | null;
  };
  generatedAt: number;
  current: { model: ModelNow | null; observation: Observation | null; radar: RadarStep | null };
  scoreboard: Tile[];
  verdict: Verdict;
  shortTerm: Nowcast;
  mediumTerm: {
    hours: HourRow[];
    blocks: Block[];
    models: ModelRow[];
    riskWindows: { start: number; end: number; kind: string; reasons: string[] }[];
    confidence: { start: number; end: number; confidence: Confidence; reasons: string[] }[];
    notes: string[];
  };
  longTerm: { days: Day[]; beyond16Days: { available: boolean; reason: string }; notes: string[] };
  alerts: { official: OfficialAlert[]; estimated: EstimatedAlert[] };
  stations: Observation[];
  weights: Record<string, { weight: number; normalized: number; reasons: string[] }>;
  audit: Audit;
  sources: SourceStatus[];
  attribution: string[];
}

export interface RadarFrames {
  host: string;
  generated: number;
  frames: { time: number; path: string }[];
  nowcastFrames: number;
}

export interface SatelliteLayer {
  id: string;
  layer: string;
  matrix: string;
  maxZoom: number;
  name: string;
  unit: string;
  resolution: string;
  note: string;
  times: number[];
  tileTemplate: string;
  attribution: string;
}

export interface Grid {
  model: string;
  step: number;
  times: number[];
  points: { lat: number; lon: number; values: Record<string, (number | null)[]> }[];
  fetchedAt: number;
  stale: boolean;
}

export interface CatalogSource {
  id: string;
  name: string;
  kind: string;
  status: 'integrated' | 'future' | 'blocked' | 'optional' | 'unavailable';
  access: string;
  license: string;
  url: string | null;
}
