// Resumo enviado ao widget nativo da tela inicial (Android).
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Forecast, Place } from '../api/types';

const Plugin = registerPlugin<{ update(o: { data: string }): Promise<void> }>('AtmosWidget');

const ICON: Record<string, [string, string]> = {
  clear: ['clear', 'night'], mostly_clear: ['clear', 'night'], partly_cloudy: ['partly', 'partly_night'], cloudy: ['cloudy', 'cloudy'],
  fog: ['fog', 'fog'], drizzle: ['rain', 'rain'], rain_light: ['rain', 'rain'], rain: ['rain', 'rain'], rain_heavy: ['rain_heavy', 'rain_heavy'], storm: ['storm', 'storm'],
};

function localHour(ts: number, tz: string) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(ts * 1000));
}
const hhmm = (ts: number, tz: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(ts * 1000);

/** Frase curta (cabe em 2 linhas do widget), sempre derivada dos dados calculados. */
export function widgetVerdict(f: Forecast): string {
  const nc = f.shortTerm;
  const tz = f.location.timezone;
  const now = Date.now() / 1000;
  if (nc.available && nc.current?.class) {
    const dry = (nc.forecast ?? []).find((s) => !s.class);
    if (dry) return `Chovendo agora (${nc.current.class}). Deve diminuir em ~${dry.lead} min, pelo radar.`;
    if (nc.forecast?.length) return `Chovendo agora (${nc.current.class}). Deve continuar nas próximas 2 h.`;
    return `Chovendo agora (${nc.current.class}), segundo o radar.`;
  }
  if (nc.available && nc.arrival) {
    const a = nc.arrival;
    const win = a.latestMinutes && a.latestMinutes > a.earliestMinutes ? `${a.earliestMinutes}–${a.latestMinutes}` : `~${a.centralMinutes}`;
    return `Chuva ${a.maxClass ?? 'fraca'} chegando pelo ${a.from} em ${win} min.`;
  }
  const b = f.mediumTerm.blocks.find((x) => x.end > now);
  const radar = nc.available ? 'Sem chuva no radar. ' : '';
  if (!b || b.rainProbability === null) return radar || 'Abra o app para ver a previsão.';
  const p = Math.round(b.rainProbability * 100);
  const span = `${hhmm(b.start, tz)}–${hhmm(b.end, tz)}`;
  if (p >= 50) return `${radar}Chance de chuva de ${p}% entre ${span}.`;
  if (p >= 20) return `${radar}Pequena chance de chuva (${p}%) até ${hhmm(b.end, tz)}.`;
  // procura a próxima janela chuvosa em 24 h
  const next = f.mediumTerm.blocks.find((x) => x.start > now && (x.rainProbability ?? 0) >= 0.5 && x.start < now + 86400);
  return next ? `${radar}Tempo firme agora; chuva provável a partir das ${hhmm(next.start, tz)} (${Math.round(next.rainProbability! * 100)}%).` : `${radar}Tempo firme nas próximas horas.`;
}

export function widgetSummary(f: Forecast, place: Place) {
  const tz = f.location.timezone;
  const now = Date.now() / 1000;
  const o = f.current.observation;
  const m = f.current.model;
  const nc = f.shortTerm;
  const day = m ? m.isDay !== 0 : localHour(now, tz) >= 6 && localHour(now, tz) < 18;
  let icon = (ICON[m?.icon ?? 'cloudy'] ?? ICON.cloudy)[day ? 0 : 1];
  let condition = m?.condition ?? '';
  if (nc.available && nc.current?.class) {
    icon = nc.current.class === 'forte' || nc.current.class === 'muito forte' ? 'rain_heavy' : 'rain';
    condition = `Chuva ${nc.current.class} (radar)`;
  }
  if (o?.weather.thunder) {
    icon = 'storm';
    condition = 'Trovoada (estação)';
  }
  const hours = f.mediumTerm.hours
    .filter((h) => h.time > now && localHour(h.time, tz) % 2 === 0)
    .slice(0, 4)
    .map((h) => {
      const b = f.mediumTerm.blocks.find((x) => x.start < h.time && h.time <= x.end);
      const hd = localHour(h.time, tz) >= 6 && localHour(h.time, tz) < 18;
      const p = b?.rainProbability ?? null;
      const rate = (b?.precipMedian ?? 0) / 3;
      const cloud = h.cloudCover?.value ?? 50;
      const ic = p !== null && p >= 0.5 && rate > 0 ? (rate >= 2.5 ? 'rain_heavy' : 'rain') : cloud >= 85 ? 'cloudy' : cloud >= 25 ? (hd ? 'partly' : 'partly_night') : hd ? 'clear' : 'night';
      return { label: `${String(localHour(h.time, tz)).padStart(2, '0')}h`, temp: h.temperature?.value ?? null, p: p === null ? null : Math.round(p * 100), icon: ic };
    });
  const t24 = f.scoreboard.find((t) => t.id === 'next24h');
  const alert = f.alerts.official.find((a) => a.inForce);
  const label = place.label.split(',').slice(0, 2).join(',').trim();
  return {
    v: 1, place: label, lat: f.location.lat, lon: f.location.lon, tz,
    updatedAt: f.generatedAt, appUpdatedAt: f.generatedAt,
    temp: o?.temperature ?? m?.temperature ?? null, feels: m?.apparentTemperature ?? null,
    kind: o ? `MEDIDO · ${o.station} ${hhmm(o.observedAt, tz)}` : 'MODELO',
    icon, condition, verdict: widgetVerdict(f), confidence: f.verdict.confidence,
    tmax: t24?.value ?? null, tmin: t24?.value2 ?? null,
    hours,
    alert: alert ? { title: `${alert.event} (${alert.severity})`, end: alert.end } : null,
  };
}

export async function pushWidget(f: Forecast, place: Place) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Plugin.update({ data: JSON.stringify(widgetSummary(f, place)) });
  } catch {
    /* widget opcional */
  }
}
