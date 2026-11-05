import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'ATMOS — Inteligência Meteorológica Local',
        short_name: 'ATMOS',
        description: 'O que provavelmente vai acontecer com o tempo exatamente onde você está.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#17171B',
        theme_color: '#28003D',
        categories: ['weather', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Previsão: rede primeiro; cópia local só como último recurso (o app mostra a idade do dado)
            urlPattern: ({ url }) => url.pathname.startsWith('/api/forecast'),
            handler: 'NetworkFirst',
            options: { cacheName: 'atmos-forecast', networkTimeoutSeconds: 12, expiration: { maxEntries: 10, maxAgeSeconds: 6 * 3600 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: { cacheName: 'basemap', expiration: { maxEntries: 600, maxAgeSeconds: 14 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          mui: ['@mui/material', '@emotion/react', '@emotion/styled'],
        },
      },
    },
  },
  test: { environment: 'jsdom' },
} as never);
