import { beforeEach, describe, expect, it } from 'vitest';
import { ago, dir8, hm, num, pct } from '../format';
import { selectNew } from '../notify';
import type { EstimatedAlert, OfficialAlert } from '../../api/types';

describe('format', () => {
  it('formata horário no fuso da localização, não do aparelho', () => {
    const t = Date.UTC(2026, 10, 5, 15, 0) / 1000;
    expect(hm(t, 'America/Sao_Paulo')).toBe('12:00');
    expect(hm(t, 'UTC')).toBe('15:00');
  });
  it('números e porcentagens pt-BR', () => {
    expect(num(1008.4)).toBe('1.008');
    expect(num(2.55, 1)).toMatch(/^2,[56]$/);
    expect(num(null)).toBe('—');
    expect(pct(0.42)).toBe('42%');
    expect(pct(null)).toBe('—');
  });
  it('direções e tempo relativo', () => {
    expect(dir8(225)).toBe('SO');
    expect(dir8(0)).toBe('N');
    expect(ago(1000, 1000 + 300)).toBe('há 5 min');
  });
});

describe('notificações', () => {
  beforeEach(() => localStorage.clear());
  const est = (key: string, severity: EstimatedAlert['severity']): EstimatedAlert => ({
    id: key, dedupeKey: key, kind: 'estimated', type: 't', title: 'x', detail: 'y', severity, reasons: [], start: null, end: null, basis: '', issuedAt: 0,
  });
  it('não repete e não notifica avisos apenas informativos', () => {
    const off = { id: 'inmet-1', kind: 'official', severity: 'Perigo' } as OfficialAlert;
    const first = selectNew([off, est('a', 'attention'), est('b', 'info')]);
    expect(first.map((a) => a.id)).toEqual(['inmet-1', 'a']);
    expect(selectNew([off, est('a', 'attention')])).toEqual([]);
  });
});
