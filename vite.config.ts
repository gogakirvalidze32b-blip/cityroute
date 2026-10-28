import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  define: {
    'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'CityRoute',
        short_name: 'CityRoute',
        description: 'საგამოცდო მარშრუტები ინსტრუქტორებისთვის',
        theme_color: '#0f766e',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'ka',
        start_url: '/',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Exclude route preview photos from precache (loaded on-demand from network)
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2,mp3,wav,aac,json}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/routes.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'routes-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          // Route preview photos - load from network, cache in browser
          {
            urlPattern: /\/routes\/route-.*\.png$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'route-photos',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // თელავის რუკის ფილები - zoom 13-18 (street level detail)
          {
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*\/16\/.*\/(26653|26654|26655|26656|26657)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'telavi-map-tiles-z16',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*\/17\/.*\/(53306|53307|53308|53309|53310|53311|53312|53313|53314|53315)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'telavi-map-tiles-z17',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*\/18\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'telavi-map-tiles-z18',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles-other',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
    }),
  ],
})
