# Gestor de Minutos

PWA para gestionar alineaciones, cambios y minutos de los jugadores durante los partidos.

- Requisitos: `docs/PRD.md`
- Arquitectura y decisiones: `docs/PLAN_TECNICO.md`

## Desarrollo local (Supabase)

Requiere Docker (Docker Desktop).

1. `npm run db:start` — arranca Supabase local y aplica migraciones y seed (datos DEMO).
2. `npm run env:local` — escribe `.env.local` con la URL y la clave **publishable** locales.
3. `npm run dev` — la app; entra con una cuenta DEMO del seed (`isaac.demo@demo.local`, contraseña `demo-local-2026`; ver `supabase/seed.sql`).
4. Correos locales (recuperación de contraseña): Mailpit en http://127.0.0.1:54324.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright, contra Supabase local; la primera vez: `npx playwright install chromium`) |
| `npm run test:db` | Tests de base de datos (RLS, validación de eventos, Storage…) contra Supabase local |
| `npm run db:start` / `db:stop` / `db:reset` | Supabase local (Docker) |
| `npm run db:types` | Regenera `src/data/remote/database.types.ts` desde el esquema |
| `npm run env:local` | Escribe `.env.local` desde el Supabase local |
| `npm run typecheck` | Comprobación de tipos (incluye el dominio sin APIs del navegador) |
| `npm run lint` | Lint (oxlint) |
| `npm run build` | Build de producción + service worker |
| `npm run generate-pwa-assets` | Regenera los iconos PWA desde `public/icon.svg` |

## Estructura

- `src/domain/` — motor del partido en TypeScript puro (sin React, navegador, IndexedDB ni Supabase).
- `src/data/` — persistencia local (IndexedDB con Dexie): una tabla por entidad, repositorios y transacciones.
- `src/app/` — capa de aplicación: contexto, hooks del partido (reloj, final automático, pantalla encendida), mensajes, WhatsApp.
- `src/features/` — pantallas (entrenador, jugadores, partidos, convocatoria, alineación, partido, resumen).
- `src/ui/` — componentes reutilizables sin lógica de negocio (botones, campo, hojas, diálogos).
- `e2e/` — tests de extremo a extremo (incluye el flujo completo del PRD §37).

## Probar en el móvil

`npm run build && npx vite preview --host` y abrir la URL de la red local en el móvil.
Así la app funciona, pero **no se puede instalar ni funciona sin conexión**: el service worker exige HTTPS
(salvo en `localhost`). Para probar la PWA completa hay que publicarla con HTTPS (p. ej. Vercel/Netlify) o usar un túnel HTTPS.
En desarrollo (`npm run dev`), con la lista de partidos vacía aparece un botón para cargar datos DEMO.
