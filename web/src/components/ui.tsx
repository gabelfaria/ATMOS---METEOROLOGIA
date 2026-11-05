import { Box, Button, CircularProgress, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';
import { brand, condensed, confColor, kindColor } from '../theme';
import { CONF_LABEL, KIND_LABEL } from '../lib/format';

/** Painel modular com faixa de título — linguagem de placar. */
export function Panel({
  title,
  accent = brand.green,
  right,
  children,
  sx,
  dense,
}: {
  title?: ReactNode;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
  dense?: boolean;
}) {
  return (
    <Box
      component="section"
      sx={{
        bgcolor: 'background.paper',
        borderRadius: '6px',
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        ...sx,
      }}
    >
      {title && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', position: 'relative' }}
        >
          <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: accent }} />
          <Typography variant="overline" component="h2" sx={{ fontSize: '0.85rem' }}>
            {title}
          </Typography>
          {right}
        </Stack>
      )}
      <Box sx={{ p: dense ? 0 : 2 }}>{children}</Box>
    </Box>
  );
}

export function KindBadge({ kind, label }: { kind: string; label?: string }) {
  const c = kindColor[kind] ?? '#8A8A99';
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.1,
        border: `1px solid ${c}`,
        color: 'text.primary',
        borderRadius: '3px',
        fontFamily: condensed,
        fontWeight: 700,
        fontSize: '0.68rem',
        letterSpacing: '0.1em',
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, bgcolor: c }} />
      {label ?? KIND_LABEL[kind] ?? kind.toUpperCase()}
    </Box>
  );
}

/** Medidor de confiança em 3 segmentos (sem falsa precisão numérica). */
export function ConfidenceMeter({ level, compact }: { level?: string | null; compact?: boolean }) {
  const n = level === 'high' ? 3 : level === 'moderate' ? 2 : level === 'low' ? 1 : 0;
  const c = level ? confColor[level] : '#666';
  return (
    <Stack direction="row" alignItems="center" spacing={1} aria-label={`Confiança ${level ? CONF_LABEL[level] : 'indisponível'}`}>
      <Stack direction="row" spacing={0.4}>
        {[1, 2, 3].map((i) => (
          <Box
            key={i}
            sx={{ width: compact ? 10 : 16, height: compact ? 6 : 8, bgcolor: i <= n ? c : 'action.disabledBackground', transform: 'skewX(-20deg)' }}
          />
        ))}
      </Stack>
      {!compact && (
        <Typography sx={{ fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.85rem' }}>
          {level ? CONF_LABEL[level] : '—'}
        </Typography>
      )}
    </Stack>
  );
}

export function Loading({ label = 'Carregando dados meteorológicos…' }: { label?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ py: 8 }} role="status">
      <CircularProgress color="primary" />
      <Typography color="text.secondary">{label}</Typography>
    </Stack>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Panel title="Falha ao carregar" accent={brand.red}>
      <Typography sx={{ mb: onRetry ? 2 : 0 }}>{message}</Typography>
      {onRetry && (
        <Button variant="outlined" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </Panel>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Typography color="text.secondary" sx={{ py: 1.5 }}>
      {children}
    </Typography>
  );
}

/** Número grande de placar. */
export function BigNumber({ value, unit, size = 64 }: { value: ReactNode; unit?: string | null; size?: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', lineHeight: 0.9 }}>
      <Box component="span" sx={{ fontFamily: condensed, fontWeight: 800, fontSize: size, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Box>
      {unit && (
        <Box component="span" sx={{ fontFamily: condensed, fontWeight: 700, fontSize: size * 0.32, ml: 0.3, mt: 0.4, opacity: 0.85 }}>
          {unit}
        </Box>
      )}
    </Box>
  );
}

export function Stat({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string; hint?: ReactNode }) {
  return (
    <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: '4px', minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
        <Typography component="span" sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 28, lineHeight: 1.1 }}>
          {value}
        </Typography>
        {unit && (
          <Typography component="span" sx={{ fontFamily: condensed, fontWeight: 700, fontSize: 14 }} color="text.secondary">
            {unit}
          </Typography>
        )}
      </Box>
      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function SourceLine({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
      {children}
    </Typography>
  );
}
