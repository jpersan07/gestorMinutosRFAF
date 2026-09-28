# Gestor de Minutos

PWA para gestionar alineaciones, cambios y minutos de los jugadores durante los partidos.

- Requisitos: `docs/PRD.md`
- Arquitectura y decisiones: `docs/PLAN_TECNICO.md`

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests E2E (Playwright; la primera vez: `npx playwright install chromium`) |
| `npm run typecheck` | Comprobación de tipos (incluye el dominio sin APIs del navegador) |
| `npm run lint` | Lint (oxlint) |
| `npm run build` | Build de producción + service worker |
| `npm run generate-pwa-assets` | Regenera los iconos PWA desde `public/icon.svg` |

## Estructura

- `src/domain/` — motor del partido en TypeScript puro (sin React, navegador, IndexedDB ni Supabase).
- `src/app/` — capa de aplicación (p. ej. mensaje de convocatoria para WhatsApp).
- `e2e/` — tests de extremo a extremo.
