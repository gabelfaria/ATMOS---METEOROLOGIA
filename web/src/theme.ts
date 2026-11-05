import { createTheme } from '@mui/material/styles';

// Tokens da identidade ATMOS: Material 3 + linguagem de placar esportivo televisivo (original).
export const brand = {
  purple: '#28003D',
  purpleMid: '#3A0A55',
  purpleLight: '#4B1670',
  green: '#00FF85',
  white: '#FFFFFF',
  graphite: '#17171B',
  graphite2: '#202027',
  graphite3: '#2A2A33',
  grey: '#F4F5F7',
  yellow: '#FFC928',
  blue: '#3488FF',
  red: '#FF3B5C',
};

export const condensed = '"Barlow Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
export const body = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Cor de cada tipo de dado (barras laterais e selos). */
export const kindColor: Record<string, string> = {
  observation: brand.green,
  radar: brand.green,
  nowcast: brand.blue,
  model: brand.yellow,
  ensemble: brand.yellow,
  consensus: brand.yellow,
  official: brand.red,
  estimated: brand.blue,
  unavailable: '#8A8A99',
};

export const confColor: Record<string, string> = { high: brand.green, moderate: brand.yellow, low: brand.red };

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-theme' },
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: brand.green, contrastText: brand.purple },
        secondary: { main: brand.purple, contrastText: brand.white },
        warning: { main: brand.yellow },
        info: { main: brand.blue },
        error: { main: brand.red },
        success: { main: brand.green },
        background: { default: brand.graphite, paper: brand.graphite2 },
        text: { primary: '#FFFFFF', secondary: '#B9B9C6' },
        divider: 'rgba(255,255,255,0.10)',
      },
    },
    light: {
      palette: {
        primary: { main: brand.purple, contrastText: brand.white },
        secondary: { main: '#00A85A', contrastText: brand.white },
        warning: { main: '#B88400' },
        info: { main: '#1F6FE0' },
        error: { main: '#D61F45' },
        success: { main: '#00A85A' },
        background: { default: brand.grey, paper: '#FFFFFF' },
        text: { primary: brand.graphite, secondary: '#55556A' },
        divider: 'rgba(23,23,27,0.10)',
      },
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: body,
    h1: { fontFamily: condensed, fontWeight: 800, letterSpacing: '-0.01em' },
    h2: { fontFamily: condensed, fontWeight: 800 },
    h3: { fontFamily: condensed, fontWeight: 800 },
    h4: { fontFamily: condensed, fontWeight: 700 },
    h5: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.02em' },
    h6: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.04em' },
    overline: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.12em', fontSize: '0.78rem', lineHeight: 1.6 },
    button: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.95rem' },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: { styleOverrides: { root: { borderRadius: 4, textTransform: 'uppercase' } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 4, fontWeight: 600 } } },
    MuiTab: {
      styleOverrides: {
        root: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.95rem', minHeight: 44 },
      },
    },
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: { minWidth: 56, padding: '6px 0' },
        label: { fontFamily: condensed, fontWeight: 700, letterSpacing: '0.08em', fontSize: '0.72rem', '&.Mui-selected': { fontSize: '0.72rem' } },
      },
    },
  },
});
