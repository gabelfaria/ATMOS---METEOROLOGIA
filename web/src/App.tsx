import { AppBar, BottomNavigation, BottomNavigationAction, Box, Button, Container, IconButton, Stack, Toolbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { STANDALONE, useForecast } from './api/client';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { LocationSearch } from './components/LocationSearch';
import { ErrorState, Loading } from './components/ui';
import { ago } from './lib/format';
import { useLocation } from './lib/location';
import { notifyAlerts } from './lib/notify';
import { AppProvider } from './lib/appctx';
import { pushWidget } from './lib/widget';
import { load, save } from './lib/storage';
import { AlertsPage } from './pages/AlertsPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { ForecastPage } from './pages/ForecastPage';
import { NowPage } from './pages/NowPage';
import { brand, condensed } from './theme';

const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));

const TABS = [
  { id: 'now', label: 'AGORA', icon: '◉' },
  { id: 'forecast', label: 'PREVISÃO', icon: '▤' },
  { id: 'map', label: 'MAPA', icon: '◈' },
  { id: 'analysis', label: 'ANÁLISE', icon: '▥' },
  { id: 'alerts', label: 'ALERTAS', icon: '▲' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function NavIcon({ ch, badge }: { ch: string; badge?: boolean }) {
  return (
    <Box sx={{ position: 'relative', fontSize: 18, lineHeight: 1, fontFamily: condensed }}>
      {ch}
      {badge && <Box sx={{ position: 'absolute', top: -2, right: -6, width: 8, height: 8, bgcolor: brand.red, borderRadius: '50%' }} />}
    </Box>
  );
}

export default function App() {
  const { place, requestGps, locating, geoError } = useLocation();
  const [tab, setTab] = useState<TabId>(() => load<TabId>('atmos:tab', 'now'));
  const [searchOpen, setSearchOpen] = useState(false);
  const wide = useMediaQuery('(min-width:900px)');
  const { mode, setMode } = useColorScheme();
  const fc = useForecast(place?.lat, place?.lon);
  const refetch = fc.refetch;

  const refresh = useCallback(async () => {
    if (STANDALONE) (await import('./engine/net')).expireShortLived();
    await refetch();
  }, [refetch]);
  const { pull, refreshing } = usePullToRefresh(refresh, !!place && tab !== 'map');

  // Ao voltar para o app depois de um tempo, atualiza sozinho
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && fc.data && Date.now() / 1000 - fc.data.generatedAt > 5 * 60) refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [fc.data, refresh]);

  const go = (t: TabId) => {
    setTab(t);
    save('atmos:tab', t);
    window.scrollTo({ top: 0 });
  };

  useEffect(() => {
    if (fc.data) notifyAlerts([...fc.data.alerts.official, ...fc.data.alerts.estimated]).catch(() => undefined);
    if (fc.data && place) pushWidget(fc.data, place);
  }, [fc.data, place]);

  const alertBadge = !!fc.data && (fc.data.alerts.official.some((a) => a.inForce) || fc.data.alerts.estimated.some((a) => a.severity !== 'info'));
  const live = !!fc.data && !fc.isError && Date.now() / 1000 - fc.data.generatedAt < 20 * 60;

  let body: ReactNode;
  if (!place) {
    body = <Welcome onGps={requestGps} onSearch={() => setSearchOpen(true)} locating={locating} error={geoError} />;
  } else if (fc.isLoading) {
    body = <Loading label="Consultando radar, estações, modelos e ensembles…" />;
  } else if (fc.isError && !fc.data) {
    body = <ErrorState message={(fc.error as Error).message} onRetry={() => fc.refetch()} />;
  } else if (fc.data) {
    const d = fc.data;
    body = (
      <>
        {tab === 'now' && <NowPage data={d} live={live} onOpenAlerts={() => go('alerts')} />}
        {tab === 'forecast' && <ForecastPage data={d} />}
        {tab === 'map' && (
          <Suspense fallback={<Loading label="Carregando mapa…" />}>
            <MapPage data={d} />
          </Suspense>
        )}
        {tab === 'analysis' && <AnalysisPage data={d} />}
        {tab === 'alerts' && <AlertsPage data={d} />}
      </>
    );
  }

  const nav = (
    <BottomNavigation
      value={tab}
      onChange={(_, v) => go(v)}
      showLabels
      sx={
        wide
          ? { flexDirection: 'column', height: 'auto', width: 96, bgcolor: 'transparent', gap: 1, pt: 2 }
          : { bgcolor: brand.purple, '& .MuiBottomNavigationAction-root': { color: 'rgba(255,255,255,0.7)' }, '& .Mui-selected': { color: `${brand.green} !important` } }
      }
    >
      {TABS.map((t) => (
        <BottomNavigationAction key={t.id} value={t.id} label={t.label} icon={<NavIcon ch={t.icon} badge={t.id === 'alerts' && alertBadge} />} />
      ))}
    </BottomNavigation>
  );

  return (
    <AppProvider setTab={setTab}>
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: wide ? 2 : 'calc(64px + env(safe-area-inset-bottom))' }}>
      <AppBar position="sticky" elevation={0} sx={{ bgcolor: brand.purple, color: '#fff', borderBottom: `3px solid ${brand.green}`, pt: 'env(safe-area-inset-top)' }}>
        <Toolbar sx={{ gap: 1.5, minHeight: { xs: 56 } }}>
          <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 24, letterSpacing: '0.08em' }}>
            ATM<Box component="span" sx={{ color: brand.green }}>O</Box>S
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setSearchOpen(true)} role="button" aria-label="Trocar local">
            <Typography noWrap sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
              {place ? place.label : 'Escolher local'}
            </Typography>
            <Typography noWrap sx={{ fontSize: '0.7rem', opacity: 0.75 }}>
              {place ? `${place.source === 'gps' ? 'GPS' : 'manual'} · ` : ''}
              {fc.data ? `atualizado ${ago(fc.data.generatedAt)}` : fc.isFetching ? 'atualizando…' : ''}
              {fc.isError && fc.data ? ' · falha ao atualizar' : ''}
            </Typography>
          </Box>
          {place && (
            <Tooltip title="Atualizar">
              <IconButton aria-label="Atualizar" onClick={() => refresh()} sx={{ color: '#fff' }} disabled={fc.isFetching}>
                ⟳
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Tema claro/escuro">
            <IconButton
              aria-label="Alternar tema"
              sx={{ color: '#fff', fontSize: 16 }}
              onClick={() => setMode(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark')}
            >
              {mode === 'dark' ? '☾' : mode === 'light' ? '☀' : '◐'}
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex' }}>
        {wide && <Box sx={{ position: 'sticky', top: 64, alignSelf: 'flex-start' }}>{nav}</Box>}
        <Container maxWidth={tab === 'map' ? 'xl' : 'md'} sx={{ py: 2, px: { xs: 1.5, sm: 2 } }}>
          {(pull > 0 || refreshing) && (
            <Box sx={{ height: refreshing ? 40 : pull * 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <Typography sx={{ fontFamily: condensed, fontWeight: 700, letterSpacing: '0.1em', fontSize: '0.8rem', color: pull >= 70 || refreshing ? 'primary.main' : 'text.secondary' }}>
                {refreshing ? 'ATUALIZANDO…' : pull >= 70 ? 'SOLTE PARA ATUALIZAR' : 'PUXE PARA ATUALIZAR'}
              </Typography>
            </Box>
          )}
          {body}
        </Container>
      </Box>

      {!wide && place && (
        <Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10, pb: 'env(safe-area-inset-bottom)', bgcolor: brand.purple }}>{nav}</Box>
      )}
      <LocationSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Box>
    </AppProvider>
  );
}

function Welcome({ onGps, onSearch, locating, error }: { onGps: () => void; onSearch: () => void; locating: boolean; error: string | null }) {
  return (
    <Stack spacing={3} sx={{ py: 4, maxWidth: 520, mx: 'auto' }}>
      <Box sx={{ bgcolor: brand.purple, color: '#fff', p: 3, borderRadius: '6px', borderBottom: `6px solid ${brand.green}` }}>
        <Typography sx={{ fontFamily: condensed, fontWeight: 800, fontSize: 40, lineHeight: 1 }}>
          O QUE VAI ACONTECER COM O TEMPO ONDE VOCÊ ESTÁ?
        </Typography>
        <Typography sx={{ mt: 2, opacity: 0.9 }}>
          O ATMOS cruza radar, satélite, estações, seis modelos numéricos, ensembles e alertas oficiais — e mostra de onde vem cada número.
        </Typography>
      </Box>
      <Button variant="contained" size="large" onClick={onGps} disabled={locating} sx={{ bgcolor: brand.green, color: brand.purple, '&:hover': { bgcolor: '#00d870' } }}>
        {locating ? 'Localizando…' : 'Usar minha localização'}
      </Button>
      <Button variant="outlined" size="large" onClick={onSearch}>
        Buscar cidade, bairro ou endereço
      </Button>
      {error && <Typography color="warning.main">{error}</Typography>}
      <Typography variant="body2" color="text.secondary">
        A localização só é usada com o seu consentimento, é arredondada a ~100 m e fica guardada apenas neste aparelho.
      </Typography>
    </Stack>
  );
}
