import { Box, Link, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useCatalog } from '../api/client';
import type { Forecast } from '../api/types';
import { Empty, Panel, SourceLine } from '../components/ui';
import { ago, dateTime, num, pct } from '../lib/format';
import { brand, condensed } from '../theme';

const AGREE: Record<string, { label: string; color: string }> = {
  concorda: { label: 'CONCORDA', color: brand.green },
  parcial: { label: 'PARCIAL', color: brand.yellow },
  diverge: { label: 'DIVERGE', color: brand.red },
};

const STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: 'OK', color: brand.green },
  stale: { label: 'CACHE', color: brand.yellow },
  unavailable: { label: 'SEM DADOS', color: '#8A8A99' },
  error: { label: 'FALHA', color: brand.red },
  integrated: { label: 'INTEGRADA', color: brand.green },
  future: { label: 'FUTURA', color: brand.blue },
  blocked: { label: 'BLOQUEADA', color: brand.red },
  optional: { label: 'OPCIONAL', color: brand.yellow },
};

function Tag({ s }: { s: { label: string; color: string } }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ width: 10, height: 10, bgcolor: s.color }} />
      {s.label}
    </Box>
  );
}

export function AnalysisPage({ data }: { data: Forecast }) {
  const tz = data.location.timezone;
  const rows = data.mediumTerm.models;
  const audit = data.audit;
  const catalog = useCatalog();
  return (
    <Stack spacing={2}>
      <Panel title="Consenso de modelos · próximas 48 h" dense>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Modelo</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Previsão</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Concordância</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Peso</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.model}>
                  <TableCell>
                    <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{r.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.provider}
                      {r.resolutionKm ? ` · ~${r.resolutionKm} km` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {r.available ? (
                      <>
                        {num(r.tempMin, 0)}–{num(r.tempMax, 0)} °C
                        <br />
                        <Typography variant="caption" color="text.secondary">
                          chuva {num(r.precipTotal, 1)} mm · rajada {num(r.gustMax, 0)} km/h
                        </Typography>
                      </>
                    ) : (
                      'sem dados'
                    )}
                  </TableCell>
                  <TableCell>
                    {r.agreement ? <Tag s={AGREE[r.agreement]} /> : '—'}
                    {r.meanAbsDiffFromConsensus != null && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Δ temp. média {num(r.meanAbsDiffFromConsensus, 1)} °C
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell title={(r.weightReasons ?? []).join('\n')}>{r.weight !== undefined ? pct(r.weight) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            CONCORDA: temperatura até 1 °C do consenso e chuva total compatível. PARCIAL: só um dos critérios. Peso = resolução × dependência entre
            modelos × desempenho local medido (quando há amostra ≥48 h). Concordância não é probabilidade.
          </Typography>
        </Box>
      </Panel>

      <Panel title="Por que cada peso" accent={brand.yellow}>
        {Object.entries(data.weights).map(([id, w]) => (
          <Box key={id} sx={{ mb: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {rows.find((r) => r.model === id)?.name ?? id} · {pct(w.normalized)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {w.reasons.join(' · ')}
            </Typography>
          </Box>
        ))}
      </Panel>

      <Panel title="Desempenho local verificado" accent={brand.green}>
        {!audit.available ? (
          <Empty>Avaliação indisponível: {audit.reason}</Empty>
        ) : (
          <>
            <Typography sx={{ mb: 1 }}>
              Estação de referência: <strong>{audit.station?.station}</strong> — {audit.station?.name} ({num(audit.station?.distanceKm, 0)} km). Período{' '}
              {dateTime(audit.periodStart, tz)} a {dateTime(audit.periodEnd, tz)}, {audit.observationsUsed} observações.
            </Typography>
            <Box sx={{ p: 1.5, mb: 1.5, borderLeft: `4px solid ${audit.archive?.best.declared ? brand.green : brand.yellow}`, bgcolor: 'action.hover' }}>
              <Typography sx={{ fontWeight: 700 }}>
                {audit.archive?.best.declared ? `Melhor desempenho nesta amostra: ${audit.archive.best.name}` : 'Sem evidência suficiente para apontar o melhor modelo'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {audit.archive?.best.reason}
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Modelo</TableCell>
                    <TableCell>EAM temp. 24–47 h</TableCell>
                    <TableCell>Viés</TableCell>
                    <TableCell>EAM 48–71 h</TableCell>
                    <TableCell>Chuva (acertos / falsos alarmes / não previstos)</TableCell>
                    <TableCell>n</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {audit.archive?.models.map((m) => {
                    const d1 = m.leads.day1;
                    const d2 = m.leads.day2;
                    return (
                      <TableRow key={m.model}>
                        <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                        <TableCell>{num(d1.temperature.mae, 1)} °C</TableCell>
                        <TableCell>{d1.temperature.bias !== null ? `${d1.temperature.bias > 0 ? '+' : ''}${num(d1.temperature.bias, 1)}` : '—'}</TableCell>
                        <TableCell>{num(d2.temperature.mae, 1)} °C</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {d1.precipitation.hits} / {d1.precipitation.falseAlarms} / {d1.precipitation.misses}
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            CSI {num(d1.precipitation.csi, 2)} · {d1.precipitation.n} blocos
                          </Typography>
                        </TableCell>
                        <TableCell>{d1.temperature.n} h</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography sx={{ mt: 2, fontWeight: 700 }}>Previsões do próprio ATMOS</Typography>
            {audit.own && (Object.keys(audit.own.temperature).length || audit.own.rainProbability.n) ? (
              <Typography variant="body2">
                {Object.entries(audit.own.temperature)
                  .map(([k, v]) => `EAM ${k}: ${num(v.mae, 1)} °C (n=${v.n})`)
                  .join(' · ')}
                {audit.own.rainProbability.n > 0 &&
                  ` · Brier (chuva 3 h): ${num(audit.own.rainProbability.brier, 3)} (n=${audit.own.rainProbability.n})`}
              </Typography>
            ) : (
              <Empty>Ainda sem amostra: o ATMOS grava cada emissão (por célula de ~11 km) e compara com as observações quando elas chegam.</Empty>
            )}
            {(audit.notes ?? []).map((n) => (
              <SourceLine key={n}>{n}</SourceLine>
            ))}
          </>
        )}
      </Panel>

      <Panel title="Fontes desta previsão" dense>
        <Table size="small">
          <TableBody>
            {data.sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 600 }}>{s.name}</Typography>
                  {s.message && (
                    <Typography variant="caption" color="text.secondary">
                      {s.message}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{STATUS[s.status] && <Tag s={STATUS[s.status]} />}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                  {s.dataTime ? `dado ${ago(s.dataTime)}` : s.fetchedAt ? `obtido ${ago(s.fetchedAt)}` : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      <Panel title="Catálogo de integrações" dense>
        <Table size="small">
          <TableBody>
            {(catalog.data?.sources ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Typography sx={{ fontSize: '0.88rem', fontWeight: 600 }}>
                    {s.url ? (
                      <Link href={s.url} target="_blank" rel="noopener" color="inherit">
                        {s.name}
                      </Link>
                    ) : (
                      s.name
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {s.access} · {s.license}
                  </Typography>
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{STATUS[s.status] && <Tag s={STATUS[s.status]} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <Typography variant="caption" color="text.secondary">
        {data.attribution.join(' · ')}
      </Typography>
    </Stack>
  );
}
