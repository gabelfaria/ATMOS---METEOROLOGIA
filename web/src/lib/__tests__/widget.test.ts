import { describe, expect, it } from 'vitest';
import type { Forecast } from '../../api/types';
import { widgetSummary, widgetVerdict } from '../widget';

const now = Math.floor(Date.now() / 1000);
function f(over: Partial<Forecast> = {}): Forecast {
  return {
    location: { lat: -22.9, lon: -43.2, timezone: 'America/Sao_Paulo', utcOffsetSeconds: -10800, elevation: 0, gridLat: 0, gridLon: 0 },
    generatedAt: now,
    current: { model: { kind: 'model', source: '', time: now, temperature: 25, apparentTemperature: 27, humidity: 80, precipitation: 0, weatherCode: 2, condition: 'Parcialmente nublado', icon: 'partly_cloudy', cloudCover: 50, pressure: 1010, windSpeed: 10, windDirection: 90, windGust: 20, uvIndex: 3, isDay: 1 }, observation: null, radar: null },
    scoreboard: [{ id: 'next24h', label: '', value: 31, value2: 21, unit: '°C', caption: null, kind: 'consensus', source: null, time: null }],
    verdict: { confidence: 'moderate' } as Forecast['verdict'],
    shortTerm: { available: true, current: { time: now, dbz: null, rateMmH: 0, class: null }, forecast: [], echoFraction: 0, domainRadiusKm: 290 },
    mediumTerm: { hours: [], blocks: [{ start: now - 600, end: now + 9000, rainProbability: 0.6 } as Forecast['mediumTerm']['blocks'][0]], models: [], riskWindows: [], confidence: [], notes: [] },
    longTerm: { days: [], beyond16Days: { available: false, reason: '' }, notes: [] },
    alerts: { official: [], estimated: [] }, stations: [], weights: {}, audit: { available: false }, sources: [], attribution: [],
    ...over,
  } as Forecast;
}

describe('widget', () => {
  it('frase usa o radar quando está chovendo', () => {
    const x = f();
    x.shortTerm.current = { time: now, dbz: 30, rateMmH: 2, class: 'fraca' };
    x.shortTerm.forecast = [{ lead: 10, time: now + 600, dbz: 30, rateMmH: 2, class: 'fraca' }, { lead: 20, time: now + 1200, dbz: null, rateMmH: 0, class: null }];
    expect(widgetVerdict(x)).toMatch(/Chovendo agora \(fraca\). Deve diminuir em ~20 min/);
    expect(widgetSummary(x, { lat: 0, lon: 0, label: 'Jardim Catarina, São Gonçalo, RJ', source: 'gps' }).condition).toBe('Chuva fraca (radar)');
  });
  it('sem chuva no radar, usa a chance do ensemble', () => {
    expect(widgetVerdict(f())).toMatch(/^Sem chuva no radar\. Chance de chuva de 60%/);
  });
  it('resumo traz máx/mín, local curto e alerta em vigor', () => {
    const x = f({ alerts: { official: [{ inForce: true, event: 'Tempestade', severity: 'Perigo Potencial', end: now + 3600 } as never], estimated: [] } });
    const s = widgetSummary(x, { lat: 0, lon: 0, label: 'Jardim Catarina, São Gonçalo, Rio de Janeiro', source: 'gps' });
    expect(s.place).toBe('Jardim Catarina, São Gonçalo');
    expect([s.tmax, s.tmin]).toEqual([31, 21]);
    expect(s.alert?.title).toBe('Tempestade (Perigo Potencial)');
    expect(s.kind).toBe('MODELO');
  });
});
