/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { assertBuildEnv } from './scripts/check-build-env.mjs'

export default defineConfig(({ command, mode }) => {
  // Segunda barrera (la primera es el buildCommand de vercel.json): una preview nunca contra
  // producción y ningún secreto en variables VITE_* (tampoco en ficheros .env locales).
  if (command === 'build') assertBuildEnv({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env })
  return config
})

const config = {
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': una versión nueva nunca recarga la app sola (p. ej. en mitad de un partido).
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        name: 'Gestor de Minutos',
        short_name: 'Minutos',
        description: 'Alineaciones, cambios y minutos de los jugadores durante el partido.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b1f14',
        theme_color: '#0b1f14',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Toda la app queda precacheada: abre sin conexión.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    // IndexedDB en memoria para los tests de la capa de datos (se carga antes que Dexie).
    setupFiles: ['fake-indexeddb/auto'],
  },
}
