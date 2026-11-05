import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import type { Tile, Verdict } from '../api/types';
import { ago, hm, KIND_LABEL } from '../lib/format';
import { brand, condensed, confColor, kindColor } from '../theme';
import { ConfidenceMeter } from './ui';

/** Placar AGORA | PRÓXIMA HORA | PRÓXIMAS 24H. */
export function Scoreboard({ tiles, tz, live, onTile }: { tiles: Tile[]; tz: string; live: boolean; onTile?: (id: Tile['id']) => void }) {
  return (
    <Box
      sx={{
        bgcolor: brand.purple,
        color: brand.white,
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(40,0,61,0.35)',
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 0.6, bgcolor: brand.purpleMid }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: live ? brand.green : brand.yellow,
            mr: 1,
            animation: live ? 'atmosPulse 2s ease-in-out infinite' : 'none',
            '@keyframes atmosPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
          }}
        />
        <Typography sx={{ fontFamily: condensed, fontWeight: 700, letterSpacing: '0.14em', fontSize: '0.75rem' }}>
          {live ? 'AO VIVO' : 'DADOS EM CACHE'}
        </Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(tiles.length, 1)}, 1fr)` }}>
        {tiles.map((t, i) => (
          <ScoreTile key={t.id} tile={t} tz={tz} first={i === 0} onClick={onTile ? () => onTile(t.id) : undefined} />
        ))}
      </Box>
    </Box>
  );
}

function ScoreTile({ tile, tz, first, onClick }: { tile: Tile; tz: string; first: boolean; onClick?: () => void }) {
  const accent = kindColor[tile.kind] ?? brand.green;
  const big =
    tile.value === null || tile.value === undefined ? (
      <Box component="span" sx={{ fontFamily: condensed, fontWeight: 800, fontSize: { xs: 22, sm: 30 }, lineHeight: 1.05 }}>
        {tile.text ?? '—'}
      </Box>
    ) : (
      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        <Box component="span" sx={{ fontFamily: condensed, fontWeight: 800, fontSize: { xs: 46, sm: 64 }, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
          {Math.round(tile.value)}
          {tile.value2 !== undefined && (
            <Box component="span" sx={{ opacity: 0.6, fontSize: '0.6em' }}>
              /{Math.round(tile.value2)}
            </Box>
          )}
        </Box>
        <Box component="span" sx={{ fontFamily: condensed, fontWeight: 700, fontSize: { xs: 15, sm: 20 }, ml: 0.3, mt: 0.3 }}>
          {tile.unit}
        </Box>
      </Box>
    );
  return (
    <ButtonBase
      onClick={onClick}
      disabled={!onClick}
      aria-label={`${tile.label}: ver detalhes`}
      sx={{ display: 'block', textAlign: 'left', color: 'inherit', position: 'relative', px: { xs: 1.25, sm: 2 }, pt: 0, pb: 1.5, minWidth: 0, borderLeft: first ? 0 : '2px solid rgba(255,255,255,0.12)', '&:active': { bgcolor: 'rgba(255,255,255,0.06)' } }}
    >
      <Box sx={{ height: 4, bgcolor: accent, mx: { xs: -1.25, sm: -2 }, mb: 1 }} />
      <Typography sx={{ fontFamily: condensed, fontWeight: 800, letterSpacing: '0.12em', fontSize: { xs: '0.72rem', sm: '0.85rem' }, opacity: 0.9 }}>
        {tile.label}
      </Typography>
      <Box sx={{ minHeight: { xs: 52, sm: 66 }, display: 'flex', alignItems: 'center' }}>{big}</Box>
      <Typography sx={{ fontSize: { xs: '0.72rem', sm: '0.82rem' }, lineHeight: 1.25, minHeight: '2.5em', opacity: 0.92 }}>
        {tile.caption ?? ' '}
      </Typography>
      <Typography sx={{ mt: 0.5, fontFamily: condensed, fontWeight: 700, fontSize: '0.66rem', letterSpacing: '0.1em', color: accent }}>
        {KIND_LABEL[tile.kind] ?? tile.kind}
      </Typography>
      <Typography sx={{ fontSize: '0.66rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tile.source ?? ''}
        {tile.time ? ` · ${hm(tile.time, tz)}` : ''}
      </Typography>
      {onClick && (
        <Box component="span" aria-hidden sx={{ position: 'absolute', right: 8, top: 10, fontSize: 14, opacity: 0.6 }}>
          ›
        </Box>
      )}
    </ButtonBase>
  );
}

export function VerdictCard({ verdict, tz, onOpen }: { verdict: Verdict; tz: string; onOpen?: () => void }) {
  return (
    <ButtonBase onClick={onOpen} disabled={!onOpen} aria-label="Por que este veredito" sx={{ display: 'block', width: '100%', textAlign: 'left', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: '6px', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex' }}>
        <Box sx={{ width: 6, bgcolor: confColor[verdict.confidence] }} />
        <Box sx={{ p: 2, flex: 1, minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">
            Veredito · 0–2 h
          </Typography>
          <Typography sx={{ fontFamily: condensed, fontWeight: 700, fontSize: { xs: 24, sm: 28 }, lineHeight: 1.15, mb: 1 }}>
            {verdict.summary}
          </Typography>
          {verdict.text !== verdict.summary && (
            <Typography sx={{ mb: 1.5 }}>{verdict.text.replace(verdict.summary, '').trim()}</Typography>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5, mt: 1 }}>
            <Meta label="Confiança">
              <ConfidenceMeter level={verdict.confidence} />
            </Meta>
            <Meta label="Fonte principal">{verdict.mainSource ?? '—'}</Meta>
            <Meta label="Horário do dado">
              {verdict.dataTime ? `${hm(verdict.dataTime, tz)} (${ago(verdict.dataTime)})` : 'modelo/ensemble'}
            </Meta>
            <Meta label="Atualizado">{hm(verdict.lastUpdated, tz)}</Meta>
          </Box>
          {verdict.confidenceReason && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              <strong>Motivo:</strong> {verdict.confidenceReason}.
            </Typography>
          )}
          {onOpen && (
            <Typography sx={{ mt: 1, fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.8rem', color: 'primary.main' }}>
              TOQUE PARA VER AS FONTES E O RADAR ›
            </Typography>
          )}
        </Box>
      </Box>
    </ButtonBase>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>
        {label}
      </Typography>
      <Box sx={{ fontSize: '0.9rem', fontWeight: 600 }}>{children}</Box>
    </Box>
  );
}
