import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.atmos.meteorologia',
  appName: 'ATMOS',
  webDir: 'dist',
  backgroundColor: '#17171B',
  android: { allowMixedContent: false },
};

export default config;
