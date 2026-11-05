// Veredito determinístico e avisos estimados (porta de verdict.py e alerts.py).
import type { Block, EstimatedAlert, Nowcast, Observation, OfficialAlert, Verdict } from '../api/types';
import { CAPE_STORM, GUST_STRONG, P_HEAVY } from './consensus';

export const CONF_PT = { high: 'alta', moderate: 'moderada', low: 'baixa' } as const;
const ORDER = ['fraca', 'moderada', 'forte', 'muito forte'];

export function hhmm(ts: number, off: number) {
  const d = new Date((ts + off) * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
const pct = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`);

export function buildVerdict(a: { now: number; tz: number; nc: Nowcast; obs: Observation | null; blocks: Block[]; official: OfficialAlert[] }): Verdict {
  const { now, tz, nc, obs, blocks, official } = a;
  const parts: string[] = [];
  const reasons: string[] = [];
  const sources: string[] = [];
  let confidence: Verdict['confidence'] = 'low';
  let mainSource: string | null = null;
  let dataTime: number | null = null;
  let arrival: Nowcast['arrival'] = null;
  const inForce = official.filter((x) => x.inForce);
  if (inForce.length) {
    parts.push(`Aviso oficial do INMET em vigor: ${inForce[0].event} (${inForce[0].severity}).`);
    sources.push('INMET');
  }
  const nb = blocks.filter((b) => b.end > now).slice(0, 2);
  const rainProb = nb[0]?.rainProbability ?? null;
  const ok = nc.available;
  if (ok) {
    const cur = nc.current!;
    dataTime = nc.latestFrameTime ?? null;
    mainSource = 'Radar (RainViewer)';
    sources.push('RainViewer');
    confidence = nc.confidence ?? 'low';
    reasons.push(...(nc.confidenceReasons ?? []));
    if (cur.class) {
      parts.push(`Chuva ${cur.class} sobre o local agora, segundo o radar.`);
      if (nc.motion) parts.push(`As células se deslocam para ${nc.motion.toward} a cerca de ${nc.motion.speedKmh} km/h.`);
      const fc = nc.forecast ?? [];
      const nh = fc.filter((s) => s.lead <= 60 && s.class).map((s) => s.class!);
      const worst = nh.length ? nh.reduce((x, y) => (ORDER.indexOf(y) > ORDER.indexOf(x) ? y : x)) : null;
      if (worst && ORDER.indexOf(worst) > ORDER.indexOf(cur.class)) parts.push(`A extrapolação do radar indica possível intensificação para chuva ${worst} na próxima hora.`);
      if (fc.length && fc[0].class && fc.filter((s) => !s.class && s.inDomain).length >= 2) {
        const fd = fc.find((s) => !s.class);
        if (fd) parts.push(`A extrapolação indica possível diminuição em cerca de ${fd.lead} min.`);
      }
    } else if (nc.arrival) {
      arrival = nc.arrival;
      const { earliestMinutes: e, latestMinutes: l } = arrival;
      const win = l !== null && l > e ? `${e}–${l} minutos` : `cerca de ${arrival.centralMinutes} minutos`;
      parts.push(`Chuva ${arrival.maxClass ?? 'fraca'} se aproxima pelo ${arrival.from}. Há possibilidade de atingir sua região nos próximos ${win}.`);
    } else if (nc.nearestEcho && nc.nearestEcho.distanceKm <= 60) {
      parts.push(`Há chuva a ${Math.round(nc.nearestEcho.distanceKm)} km, a ${nc.nearestEcho.direction}, sem trajetória estimada em direção ao seu local nas próximas 2 h.`);
    } else if ((nc.echoFraction ?? 0) < 0.002) parts.push(`Sem chuva no radar num raio de ~${nc.domainRadiusKm} km.`);
    else parts.push('Sem chuva no radar nas proximidades imediatas.');
  } else {
    parts.push(`Previsão imediata por radar indisponível (${nc.reason ?? 'radar indisponível'}).`);
    reasons.push(nc.reason ?? 'radar indisponível');
  }
  if (obs) {
    const wx = obs.weather;
    const when = hhmm(obs.observedAt, tz);
    if (wx.precipAtStation || wx.thunder) {
      parts.push(`A estação ${obs.station} (${Math.round(obs.distanceKm)} km) registrou ${wx.description.filter(Boolean).join(', ')} às ${when}.`);
      sources.push(`METAR ${obs.station}`);
      if (ok && !nc.current?.class && obs.distanceKm <= 15) {
        reasons.push('Estação próxima reporta chuva não vista pelo radar no ponto');
        confidence = 'low';
      }
    } else if (wx.thunderVicinity) {
      parts.push(`A estação ${obs.station} registrou trovoada nas proximidades às ${when}.`);
      sources.push(`METAR ${obs.station}`);
    }
  }
  if (nb.length) {
    const b = nb[0];
    const span = `entre ${hhmm(b.start, tz)} e ${hhmm(b.end, tz)}`;
    if (b.rainProbability !== null) {
      if (!ok || (!nc.current?.class && !nc.arrival)) {
        const rp = b.rainProbability;
        parts.push(rp >= 0.5 ? `Os ensembles indicam ${pct(rp)} de chance de chuva ${span}.` : rp >= 0.2 ? `Chance de chuva de ${pct(rp)} ${span}, segundo os ensembles.` : `Ensembles indicam baixa chance de chuva (${pct(rp)}) ${span}.`);
      }
      sources.push('Ensembles Open-Meteo');
      mainSource ??= 'Ensembles (ECMWF/GEFS/ICON via Open-Meteo)';
    } else if (b.modelAgreementWet !== null && !ok) {
      parts.push(`${Math.round(b.modelAgreementWet * 100)}% do peso dos modelos prevê chuva ${span} (concordância, não probabilidade).`);
      mainSource ??= 'Modelos determinísticos (Open-Meteo)';
    }
  }
  if (!ok) {
    confidence = rainProb === null || (rainProb > 0.25 && rainProb < 0.75) ? 'low' : 'moderate';
    reasons.push('Sem radar: veredito baseado em modelos numéricos');
  }
  return {
    horizon: '0-2h', summary: parts[0] ?? 'Dados insuficientes para um veredito.', text: parts.join(' '),
    rainProbability: rainProb, rainProbabilityKind: rainProb !== null ? 'ensemble_member_fraction_uncalibrated' : null,
    estimatedArrivalMinutes: arrival?.centralMinutes ?? null, arrivalWindowMinutes: arrival ? [arrival.earliestMinutes, arrival.latestMinutes] : null,
    confidence, confidenceLabel: CONF_PT[confidence], confidenceReason: [...new Set(reasons)].join('; ') || null,
    mainSource, sources: [...new Set(sources)], dataTime, lastUpdated: Math.floor(now),
  };
}

export function estimatedAlerts(a: {
  now: number; tz: number; nc: Nowcast; obs: Observation | null; blocks: Block[];
  previous: { issuedAt: number; rain24h: number | null; maxProb24h: number | null } | null;
  summary: { rain24h: number | null; maxProb24h: number | null };
}): EstimatedAlert[] {
  const { now, tz, nc, obs, blocks, previous, summary } = a;
  const out: EstimatedAlert[] = [];
  const add = (type: string, title: string, detail: string, severity: EstimatedAlert['severity'], reasons: string[], start: number | null = null, end: number | null = null, basis = '') => {
    const bucket = Math.floor((start ?? now) / 3600);
    out.push({ id: `est-${type}-${bucket}`, dedupeKey: `${type}:${bucket}`, kind: 'estimated', type, title, detail, severity, reasons, start, end, basis, issuedAt: Math.floor(now) });
  };
  if (nc.available && nc.arrival && nc.arrival.centralMinutes <= 60) {
    const ar = nc.arrival;
    add('rain_imminent', 'Possível chuva iminente', `Chuva ${ar.maxClass ?? 'fraca'} se aproximando pelo ${ar.from}; chegada estimada em ~${ar.centralMinutes} min.`,
      ar.maxClass === 'forte' || ar.maxClass === 'muito forte' ? 'attention' : 'info', [...(nc.confidenceReasons ?? []), `Confiança: ${nc.confidence}`], now + ar.earliestMinutes * 60, null, 'Extrapolação de radar (RainViewer)');
  }
  if (nc.available && (nc.current?.class === 'forte' || nc.current?.class === 'muito forte'))
    add('heavy_rain_now', 'Chuva forte detectada', `Radar indica chuva ${nc.current.class} sobre o local (~${nc.current.rateMmH} mm/h estimados).`, 'attention', ['Refletividade convertida por Marshall–Palmer (estimativa, não pluviômetro)'], nc.current.time ?? null, null, 'Radar (RainViewer)');
  if (obs && (obs.weather.thunder || obs.weather.thunderVicinity))
    add('thunder_observed', 'Trovoada observada', `A estação ${obs.station} (${Math.round(obs.distanceKm)} km) reportou trovoada às ${hhmm(obs.observedAt, tz)}.`, 'attention', [obs.raw ?? ''], obs.observedAt, null, 'METAR');
  const fut = blocks.filter((b) => b.end > now && b.start < now + 48 * 3600);
  const heavyByModels = (b: Block) => {
    const v = Object.values(b.precipByModel).filter((x): x is number => x !== null);
    return v.length >= 2 && v.filter((x) => x >= P_HEAVY).length / v.length >= 0.4;
  };
  const h = fut.find((b) => (b.heavyProbability ?? 0) >= 0.2 || heavyByModels(b));
  if (h) {
    const rs: string[] = [];
    if (h.heavyProbability !== null) rs.push(`${pct(h.heavyProbability)} dos membros de ensemble com ≥${P_HEAVY} mm em 3 h`);
    if (heavyByModels(h)) rs.push('Ao menos 40% dos modelos determinísticos preveem ≥30 mm em 3 h');
    add('heavy_rain_forecast', 'Previsão de chuva forte', `Possibilidade de chuva forte entre ${hhmm(h.start, tz)} e ${hhmm(h.end, tz)}.`, 'attention', rs, h.start, h.end, 'Ensembles e modelos (Open-Meteo)');
  }
  const g = fut.find((b) => (b.gustStrongProbability ?? 0) >= 0.3 || (b.gustMedian ?? 0) >= GUST_STRONG);
  if (g) {
    const rs: string[] = [];
    if (g.gustStrongProbability !== null) rs.push(`${pct(g.gustStrongProbability)} dos membros com rajadas ≥${GUST_STRONG} km/h`);
    if (g.gustMedian !== null) rs.push(`Rajada mediana entre modelos: ${g.gustMedian} km/h`);
    add('strong_gusts', 'Rajadas intensas possíveis', `Rajadas de ${GUST_STRONG} km/h ou mais possíveis entre ${hhmm(g.start, tz)} e ${hhmm(g.end, tz)}.`, 'attention', rs, g.start, g.end, 'Ensembles e modelos (Open-Meteo)');
  }
  const s = fut.find((b) => (b.capeMedian ?? 0) >= CAPE_STORM && (b.modelAgreementWet ?? 0) >= 0.5);
  if (s)
    add('storm_potential', 'Potencial para tempestades', `Instabilidade elevada com chuva prevista entre ${hhmm(s.start, tz)} e ${hhmm(s.end, tz)}.`, 'info',
      [`CAPE mediano de ${s.capeMedian} J/kg (≥${CAPE_STORM})`, `${Math.round(s.modelAgreementWet! * 100)}% do peso dos modelos com chuva`, 'Potencial não significa ocorrência: tempestades são localizadas'], s.start, s.end, 'Modelos (Open-Meteo)');
  if (previous && now - previous.issuedAt <= 12 * 3600) {
    const ch: string[] = [];
    if (previous.rain24h !== null && summary.rain24h !== null && Math.abs(summary.rain24h - previous.rain24h) >= 10) ch.push(`chuva em 24 h: ${Math.round(previous.rain24h)} → ${Math.round(summary.rain24h)} mm`);
    if (previous.maxProb24h !== null && summary.maxProb24h !== null && Math.abs(summary.maxProb24h - previous.maxProb24h) >= 0.3) ch.push(`chance máxima de chuva: ${pct(previous.maxProb24h)} → ${pct(summary.maxProb24h)}`);
    if (ch.length) add('forecast_change', 'Mudança importante na previsão', `Comparado à emissão de ${hhmm(previous.issuedAt, tz)}: ${ch.join('; ')}.`, 'info', ['Comparação com a previsão consolidada anterior armazenada neste aparelho'], null, null, 'Histórico ATMOS');
  }
  return out;
}
