import { defineConfig } from 'vitest/config'

// Tests de base de datos contra Supabase LOCAL (requiere `npm run db:start`, con Docker).
// Van aparte de `npm test` porque necesitan el servidor local en marcha.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    // IndexedDB en memoria para los tests del motor de subida (cada "móvil" su base de datos).
    setupFiles: ['fake-indexeddb/auto'],
  },
})
