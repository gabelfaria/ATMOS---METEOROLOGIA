// Notificações locais com deduplicação. Funcionam enquanto o app (ou a aba) está aberto;
// notificações em segundo plano exigem Web Push com servidor (integração futura).

import type { EstimatedAlert, OfficialAlert } from '../api/types';
import { load, save } from './storage';

const SEEN = 'atmos:notified';
const PREF = 'atmos:notify';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const notificationsEnabled = () =>
  notificationsSupported() && Notification.permission === 'granted' && load<boolean>(PREF, false);

export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  const perm = await Notification.requestPermission();
  save(PREF, perm === 'granted');
  return perm === 'granted';
}

export function disableNotifications() {
  save(PREF, false);
}

export function keyOf(a: OfficialAlert | EstimatedAlert) {
  return a.kind === 'official' ? `off:${a.id}` : `est:${a.dedupeKey}`;
}

/** Retorna os alertas que ainda não foram notificados e marca-os como vistos. */
export function selectNew(alerts: (OfficialAlert | EstimatedAlert)[], now = Date.now()): (OfficialAlert | EstimatedAlert)[] {
  const seen = load<Record<string, number>>(SEEN, {});
  // limpa registros com mais de 2 dias
  for (const [k, t] of Object.entries(seen)) if (now - t > 2 * 86400_000) delete seen[k];
  const fresh = alerts.filter((a) => !seen[keyOf(a)]);
  // Avisos estimados "informativos" não geram notificação (evita alarmismo)
  const notify = fresh.filter((a) => a.kind === 'official' || a.severity !== 'info');
  fresh.forEach((a) => (seen[keyOf(a)] = now));
  save(SEEN, seen);
  return notify;
}

export async function notifyAlerts(alerts: (OfficialAlert | EstimatedAlert)[]) {
  if (!notificationsEnabled()) return;
  const items = selectNew(alerts).slice(0, 2);
  const reg = await navigator.serviceWorker?.getRegistration?.();
  for (const a of items) {
    const title = a.kind === 'official' ? `ALERTA OFICIAL · ${a.authority}` : 'AVISO ESTIMADO · ATMOS';
    const body = a.kind === 'official' ? `${a.event} — ${a.severity}` : `${a.title}: ${a.detail}`;
    const opts: NotificationOptions = { body, tag: keyOf(a), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
    if (reg) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  }
}
