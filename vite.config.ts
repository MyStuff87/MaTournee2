import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MaTournée',
        short_name: 'MaTournée',
        description: 'Guidage de tournée pour facteur',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#E8ECEF',
        theme_color: '#E8ECEF',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // carte vectorielle : tuiles, polices, icônes (versionnées, ne changent pas)
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && !url.pathname.startsWith('/styles') && url.pathname !== '/planet',
            handler: 'CacheFirst',
            options: {
              cacheName: 'carte-vectorielle',
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // styles et index des tuiles : on sert le cache tout de suite, mis à jour en fond
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'carte-styles', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // fonds de carte IGN : gardés pour la tournée hors-ligne
            urlPattern: ({ url }) => url.hostname === 'data.geopf.fr' && url.pathname.startsWith('/wmts'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tuiles-ign',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
