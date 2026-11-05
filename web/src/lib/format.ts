// Formatação pt-BR sempre no fuso horário DA LOCALIZAÇÃO consultada (não do aparelho).

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...opts });
    } catch {
      f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...opts });
    }
    cache.set(key, f);
  }
  return f;
}

export const hm = (ts: number | null | undefined, tz: string) =>
  ts ? fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(ts * 1000) : '—';

export const hour = (ts: number, tz: string) => fmt(tz, { hour: '2-digit' }).format(ts * 1000) + 'h';

export const weekday = (ts: number, tz: string) =>
  fmt(tz, { weekday: 'short' }).format(ts * 1000).replace('.', '').toUpperCase();

export const dayMonth = (ts: number, tz: string) => fmt(tz, { day: '2-digit', month: '2-digit' }).format(ts * 1000);

export const dateTime = (ts: number | null | undefined, tz: string) =>
  ts ? fmt(tz, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts * 1000) : '—';

export function ago(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return '—';
  const m = Math.round((now - ts) / 60);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  return `há ${Math.floor(h / 24)} d`;
}

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v)
    ? '—'
    : v.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`);

const DIRS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
export const dir8 = (deg: number | null | undefined) =>
  deg === null || deg === undefined ? '—' : DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export const CONF_LABEL: Record<string, string> = { high: 'ALTA', moderate: 'MODERADA', low: 'BAIXA' };

export const KIND_LABEL: Record<string, string> = {
  observation: 'MEDIÇÃO',
  model: 'MODELO',
  nowcast: 'ESTIMATIVA · RADAR',
  ensemble: 'ENSEMBLE',
  consensus: 'CONSENSO',
  unavailable: 'INDISPONÍVEL',
  official: 'ALERTA OFICIAL',
  estimated: 'AVISO ESTIMADO',
  radar: 'RADAR',
};

export function uvLabel(uv: number | null | undefined) {
  if (uv === null || uv === undefined) return '—';
  if (uv < 3) return 'baixo';
  if (uv < 6) return 'moderado';
  if (uv < 8) return 'alto';
  if (uv < 11) return 'muito alto';
  return 'extremo';
}
