// Navegação entre telas + folha de detalhes (bottom sheet) compartilhada por todo o app.
import { Box, IconButton, SwipeableDrawer, Typography } from '@mui/material';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { brand, condensed } from '../theme';
import { save } from './storage';

export type TabId = 'now' | 'forecast' | 'map' | 'analysis' | 'alerts';

interface Ctx {
  go: (tab: TabId, opts?: { forecastTab?: number; mapLayer?: string }) => void;
  openSheet: (title: ReactNode, content: ReactNode, accent?: string) => void;
  closeSheet: () => void;
}

const C = createContext<Ctx | null>(null);

export function AppProvider({ setTab, children }: { setTab: (t: TabId) => void; children: ReactNode }) {
  const [sheet, setSheet] = useState<{ title: ReactNode; content: ReactNode; accent: string } | null>(null);
  const go = useCallback<Ctx['go']>(
    (tab, opts) => {
      if (opts?.forecastTab !== undefined) save('atmos:fcTab', opts.forecastTab);
      if (opts?.mapLayer) save('atmos:mapLayer', opts.mapLayer);
      setSheet(null);
      setTab(tab);
      save('atmos:tab', tab);
      window.scrollTo({ top: 0 });
    },
    [setTab],
  );
  const value = useMemo<Ctx>(
    () => ({ go, openSheet: (title, content, accent = brand.green) => setSheet({ title, content, accent }), closeSheet: () => setSheet(null) }),
    [go],
  );
  return (
    <C.Provider value={value}>
      {children}
      <SwipeableDrawer
        anchor="bottom"
        open={!!sheet}
        onOpen={() => undefined}
        onClose={() => setSheet(null)}
        disableSwipeToOpen
        PaperProps={{ sx: { borderRadius: '12px 12px 0 0', maxHeight: '88dvh', bgcolor: 'background.paper', pb: 'env(safe-area-inset-bottom)' } }}
      >
        {sheet && (
          <Box sx={{ maxWidth: 720, width: '100%', mx: 'auto' }}>
            <Box sx={{ width: 40, height: 4, bgcolor: 'text.disabled', borderRadius: 2, mx: 'auto', mt: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ width: 4, height: 22, bgcolor: sheet.accent, mr: 1.25 }} />
              <Typography sx={{ fontFamily: condensed, fontWeight: 800, letterSpacing: '0.06em', fontSize: '1.1rem', flex: 1 }}>{sheet.title}</Typography>
              <IconButton aria-label="Fechar" onClick={() => setSheet(null)}>
                ✕
              </IconButton>
            </Box>
            <Box sx={{ p: 2, overflowY: 'auto' }}>{sheet.content}</Box>
          </Box>
        )}
      </SwipeableDrawer>
    </C.Provider>
  );
}

export function useApp() {
  const c = useContext(C);
  if (!c) throw new Error('AppProvider ausente');
  return c;
}
