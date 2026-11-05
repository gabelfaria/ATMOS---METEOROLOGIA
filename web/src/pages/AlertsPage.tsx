import { Alert, Box, Button, Link, Stack, Switch, Typography } from '@mui/material';
import { useState } from 'react';
import { deleteServerData } from '../api/client';
import type { Forecast } from '../api/types';
import { Empty, KindBadge, Panel } from '../components/ui';
import { useLocation } from '../lib/location';
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported } from '../lib/notify';
import { clearAll } from '../lib/storage';
import { dateTime, hm } from '../lib/format';
import { brand } from '../theme';

const SEV_COLOR: Record<string, string> = { info: brand.blue, attention: brand.yellow, high: brand.red };

export function AlertsPage({ data }: { data: Forecast }) {
  const tz = data.location.timezone;
  const { place, forget } = useLocation();
  const [notif, setNotif] = useState(notificationsEnabled());
  const [msg, setMsg] = useState<string | null>(null);
  const { official, estimated } = data.alerts;

  const toggle = async () => {
    if (notif) {
      disableNotifications();
      setNotif(false);
    } else {
      const ok = await enableNotifications();
      setNotif(ok);
      if (!ok) setMsg('Permissão de notificação negada pelo navegador.');
    }
  };

  const wipe = async () => {
    try {
      if (place) {
        const r = await deleteServerData(place.lat, place.lon);
        setMsg(`Dados apagados: ${r.deletedRows} registros no servidor e preferências deste aparelho.`);
      }
    } catch {
      setMsg('Não foi possível apagar no servidor; os dados locais foram apagados.');
    }
    clearAll();
    forget();
  };

  return (
    <Stack spacing={2}>
      <Panel title="Alertas oficiais" accent={brand.red} right={<KindBadge kind="official" />}>
        {official.length === 0 ? (
          <Empty>Nenhum aviso do INMET vigente ou previsto para este ponto.</Empty>
        ) : (
          <Stack spacing={1.5}>
            {official.map((a) => (
              <Box key={a.id} sx={{ display: 'flex', borderRadius: '4px', overflow: 'hidden', border: 1, borderColor: 'divider' }}>
                <Box sx={{ width: 8, bgcolor: a.color || brand.red }} />
                <Box sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    ALERTA OFICIAL · {a.authority} · {a.inForce ? 'EM VIGOR' : 'PREVISTO'}
                  </Typography>
                  <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
                    {a.event} — {a.severity}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    De {dateTime(a.start, tz)} a {dateTime(a.end, tz)}
                  </Typography>
                  {a.risks.map((r) => (
                    <Typography key={r} variant="body2" sx={{ mt: 1 }}>
                      {r}
                    </Typography>
                  ))}
                  {a.instructions.length > 0 && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {a.instructions.join(' ')}
                    </Typography>
                  )}
                  <Link href={a.url} target="_blank" rel="noopener" variant="body2" sx={{ display: 'inline-block', mt: 1 }}>
                    Ver no portal do INMET
                  </Link>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Panel>

      <Panel title="Avisos estimados pelo ATMOS" accent={brand.blue} right={<KindBadge kind="estimated" />}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Calculados automaticamente a partir de radar, observações, modelos e ensembles. Não substituem os alertas da Defesa Civil e do INMET.
        </Typography>
        {estimated.length === 0 ? (
          <Empty>Nenhuma condição relevante identificada nas próximas 48 h.</Empty>
        ) : (
          <Stack spacing={1.5}>
            {estimated.map((a) => (
              <Box key={a.id} sx={{ display: 'flex', borderRadius: '4px', overflow: 'hidden', border: 1, borderColor: 'divider' }}>
                <Box sx={{ width: 8, bgcolor: SEV_COLOR[a.severity] }} />
                <Box sx={{ p: 1.5, flex: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    AVISO ESTIMADO · {a.basis}
                    {a.start ? ` · ${hm(a.start, tz)}` : ''}
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{a.title}</Typography>
                  <Typography variant="body2">{a.detail}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Base: {a.reasons.filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Panel>

      <Panel title="Notificações" accent={brand.green}>
        {notificationsSupported() ? (
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography sx={{ fontWeight: 600 }}>Avisar sobre alertas oficiais e avisos estimados relevantes</Typography>
              <Typography variant="body2" color="text.secondary">
                Cada alerta é notificado uma única vez; avisos apenas informativos não geram notificação. Funciona com o app aberto ou em segundo plano
                recente; notificações com o app fechado exigem Web Push (integração futura).
              </Typography>
            </Box>
            <Switch checked={notif} onChange={toggle} inputProps={{ 'aria-label': 'Ativar notificações' }} />
          </Stack>
        ) : (
          <Empty>Este navegador não suporta notificações.</Empty>
        )}
      </Panel>

      <Panel title="Privacidade" accent="#8A8A99">
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          A localização é usada apenas para consultar a previsão, arredondada a ~100 m. O servidor guarda previsões emitidas por célula de ~11 km (sem
          identificar usuários) para auditoria de precisão. O local escolhido fica salvo só neste aparelho.
        </Typography>
        <Button variant="outlined" color="error" onClick={wipe}>
          Apagar meus dados
        </Button>
        {msg && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            {msg}
          </Alert>
        )}
      </Panel>
    </Stack>
  );
}
