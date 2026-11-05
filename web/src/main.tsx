import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { LocationProvider } from './lib/location';
import { theme } from './theme';

// No APK os arquivos já estão no aparelho; o service worker só serve à versão web.
if (!Capacitor.isNativePlatform()) registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme} defaultMode="dark">
      <CssBaseline enableColorScheme />
      <QueryClientProvider client={queryClient}>
        <LocationProvider>
          <App />
        </LocationProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
