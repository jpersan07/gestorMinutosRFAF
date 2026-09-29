# Plan Fase 3 — Supabase: acceso, base de datos compartida y sincronización

Estado: **APROBADO** — decisiones F3-1…F3-7 resueltas (§11). Bloques **3a** (servidor y seguridad), **3b** (acceso), **3c** (subida) y **3d** (descarga y TOMAR CONTROL) implementados; 3e pendiente.

Objetivo: que varios móviles compartan jugadores, partidos y resultados **sin perder la regla de oro de la Fase 2**: durante el partido la app funciona igual con o sin Internet. La interfaz sigue hablando solo con IndexedDB (Dexie); Supabase es persistencia y sincronización compartida, **no** el motor del partido.

---

## 1. Arquitectura

```
┌───────────────────────── Móvil ─────────────────────────┐
│ UI ⇄ hooks ⇄ repositorios Dexie   (sin cambios en la UI) │
│      motor del partido = dominio TS (decide/evolve/tick) │
│                  │ syncState = 'pending'                  │
│                  ▼                                        │
│            syncEngine (3c/3d, src/data/sync)              │
└──────────────────┬───────────────────────────────────────┘
                   │ HTTPS · sesión de Supabase Auth (cuenta individual)
                   ▼
┌──────────────────────── Supabase ────────────────────────┐
│ Auth: una cuenta por entrenador (sin registro público)   │
│ PostgreSQL + RLS: cada usuario solo ve sus equipos       │
│ append_match_events(): guardián de los eventos           │
│ Storage (bucket privado "crests"): imágenes de escudos   │
└──────────────────────────────────────────────────────────┘
```

Principios:
- **Local primero**: ninguna pantalla espera a la red.
- **Idempotente**: todo lleva UUID generado en el móvil; reenviar no duplica.
- **El servidor no se fía del móvil**: RLS por equipo, permisos por columna, validación de eventos, estado del partido derivado de los eventos.
- En el frontend solo la clave **publishable**; la **secret/service-role** nunca sale de entornos de servidor/tests.

---

## 2. Acceso (F3-2: cuentas individuales)

- Cada entrenador tiene su cuenta de Supabase Auth (creada por un administrador; registro público desactivado).
- `profiles` (1:1 con `auth.users`, creado automáticamente) + `team_members (team_id, user_id, role: admin|coach)`.
- "¿QUIÉN ERES?" deja de ser un mecanismo de identidad: la identidad es la sesión. En 3b se decidirá cómo queda como UX (p. ej. confirmar el perfil).
- La sesión queda guardada en el móvil; sin conexión con sesión guardada la app entra igual.
- Datos locales de pruebas de la Fase 2: se descartan en el primer inicio de sesión con aviso explícito y una confirmación (F3-3).

---

## 3. Base de datos (bloque 3a — implementado)

Migraciones versionadas en `supabase/migrations/`:

| Migración | Contenido |
|---|---|
| `…_core_teams_and_membership.sql` | esquema `private`, `profiles` (+ trigger de alta), `teams`, `seasons`, `team_members`, funciones de autorización, RLS |
| `…_team_data.sql` | `formation_slots`, `players`, `crests`, `matches`, `match_squads`, `match_reports`, `player_match_minutes`, `client_logs`, bloqueos, RLS |
| `…_match_events_and_control.sql` | `match_events` (inmutable), `private.match_states`, `append_match_events()` |
| `…_crest_storage.sql` | bucket privado `crests` y sus políticas |

### Tablas y relaciones

```
auth.users 1─1 profiles 1─N team_members N─1 teams 1─N seasons
                                              │
            ┌───────────┬──────────┬──────────┼───────────┬──────────────┐
         players     crests     matches ──── seasons (FK compuesta)  client_logs
            │                    │  └── crest (FK compuesta)
            │        ┌───────────┼──────────────┬───────────────────┐
            │   match_squads  match_events  match_reports  player_match_minutes
            └─────────────────────────────────────────────────────── (FK compuesta a players)
```

- **Todas** las entidades del equipo llevan `team_id`.
- Claves foráneas **compuestas** `(id, team_id)`: imposible enlazar un partido con la temporada, el escudo o un jugador de otro equipo.
- Columnas de sincronización: `updated_at` (hora del móvil, para "gana el último") y `synced_at` / `received_at` (hora del **servidor**, cursor de descarga).
- `formation_slots`: espejo de `src/domain/formations.ts` (un test comprueba que coinciden).
- `private.match_states`: estado interno del guardián de eventos (no expuesto por la API).

### Seguridad

- **RLS en todas las tablas desde su creación**; `anon` sin permisos; `authenticated` con permisos **por columna**.
- Lectura/escritura solo en equipos a los que pertenece el usuario (`private.user_team_ids()`, `security definer`, patrón recomendado por Supabase).
- Roles: solo `admin` gestiona miembros, nombre del equipo y temporadas.
- El móvil **no puede escribir** `status`, controlador, `last_seq`, `saved_at`, autores (`created_by`, `user_id`) ni mover filas entre equipos.
- Claves inmutables (`id`, `team_id`, `match_id`, `season_id`, `created_at`) mediante trigger, compatible con `upsert`.
- Triggers: "gana el último" (se ignora un cambio con `updated_at` más antiguo), `synced_at` del servidor, bloqueos de la Fase 2:
  - datos del partido y convocatoria: solo antes de PLAY (`MATCH_DETAILS_LOCKED`, `SQUAD_LOCKED`);
  - informe y minutos: solo con el partido finalizado; guardado = solo lectura (`MATCH_NOT_FINISHED`, `MATCH_LOCKED`; reenviar valores idénticos no falla);
  - dorsal único entre jugadores activos del equipo; convocatoria solo con jugadores del equipo.
- `match_events`: **inmutable** (trigger contra UPDATE/DELETE/TRUNCATE, también para `service_role`); solo se añade con `append_match_events()`.
- Storage: bucket **privado**, carpeta por equipo (`<team_id>/<crest_id>.<ext>`), solo imágenes ≤ 256 KB, sin sobrescribir ni borrar.

### Guardián de eventos: `append_match_events(match_id, events)`

El motor sigue siendo el dominio TypeScript. El servidor comprueba, sin fiarse del móvil:

1. Autenticación y pertenencia al equipo; el autor es `auth.uid()`.
2. Orden estricto `seq = último + 1`; reintentos idempotentes por `id`.
3. **Control único** (ver abajo).
4. Transiciones válidas de la máquina de estados.
5. Alineaciones (formación, sus 11 posiciones exactas, sin repetidos, convocados), convocatoria del equipo, cambios (quién está en el campo, reentradas, deshacer solo el último de la parte).
6. Coherencia temporal: el segundo de partido declarado debe coincidir con los timestamps (no se pueden inventar minutos); final de parte a la hora exacta; 15 s mínimos de descanso.
7. Partido guardado = bloqueado; guardar exige RESULTADO en `match_reports`.

Procesa en orden y se detiene en el primer rechazo, devolviendo `{ accepted, duplicates, rejected: {id, seq, reason}, match: {status, last_seq, controller_device_id, control_epoch} }`. Motivos: `SEQ_CONFLICT`, `SEQ_GAP`, `NOT_CONTROLLER`, `ALREADY_CONTROLLER`, `INVALID_TRANSITION`, `INVALID_MATCH_SECOND`, `INVALID_HALF_END`, `HALFTIME_WAIT`, `HALF_OVER`, `PLAYER_NOT_ON_FIELD`, `PLAYER_ALREADY_ON_FIELD`, `PLAYER_NOT_IN_SQUAD`, `SUBSTITUTION_MISMATCH`, `NOT_LAST_SUBSTITUTION`, `LINEUP_INCOMPLETE`, `UNKNOWN_SLOT`, `UNKNOWN_FORMATION`, `PLAYER_DUPLICATED`, `SQUAD_PLAYER_NOT_IN_TEAM`, `RESULT_REQUIRED`, `MATCH_LOCKED`, `ID_CONFLICT`, `INVALID_EVENT`…

### Control único por partido (TOMAR CONTROL)

- `matches.controller_device_id`, `controller_user_id`, `control_epoch` (derivados de los eventos).
- `SETUP_STARTED` asigna el controlador; `CONTROL_TAKEN` lo cambia e incrementa `control_epoch`.
- Cualquier otro evento solo se acepta del **dispositivo + usuario** controlador.
- La llamada bloquea la fila del partido (`FOR UPDATE`) y exige `seq = último + 1`: dos móviles nunca pueden escribir el mismo `seq`; el que llega tarde recibe `SEQ_CONFLICT`.
- Un móvil que perdió el control sin saberlo (sin conexión) ve rechazados sus eventos (`SEQ_CONFLICT` / `NOT_CONTROLLER`) → en 3d: aviso y recarga desde el servidor.
- TOMAR CONTROL en la app (3d): solo con conexión, por `take_match_control` (comparar-y-cambiar sobre `control_epoch`); solo se actúa como controlador cuando el servidor lo acepta. `append_match_events` ya no acepta `CONTROL_TAKEN`.

### Preparado para después (sin implementarlo ahora)
- **Realtime**: `matches` (estado/controlador) y `match_events` tienen clave primaria y cursor de servidor; bastará con añadirlas a la publicación `supabase_realtime`.
- Estadísticas por posición: proyectar alineaciones desde `LINEUP_CONFIRMED` con una vista.
- Invitar entrenadores / panel de administración: `team_members` con roles ya existe.

---

## 4. Datos iniciales

- Producción: equipo, temporada y membresías los crea un administrador (guía en 3e). Nada de datos reales en el repositorio.
- Desarrollo local: `supabase/seed.sql` crea **solo datos DEMO** (dos equipos DEMO y cuentas `*.demo@demo.local`); nunca se aplica en producción.
- En 3b, equipo/temporada/entrenadores de la app pasan a venir del servidor (hoy cada móvil los crea en local).

## 5. Subida (3c) — notas de diseño recogidas en 3a

- Orden por partido: `players` → escudo (subida a Storage + fila `crests`) → `matches` → `match_squads` → `match_events` → `match_reports` / `player_match_minutes`.
- Si `MATCH_SAVED` llega antes que el informe → `RESULT_REQUIRED`: subir informe y minutos y reintentar (rechazo recuperable, distinto de un conflicto de control).
- `upsert` idempotente soportado: se concede UPDATE sobre las claves (`id`, `team_id`, `match_id`…) y un trigger (`IMMUTABLE_COLUMN`) impide cambiarlas; reenviar los mismos datos funciona y mover filas entre partidos/equipos no.
- `mapping` evento dominio ↔ servidor ya implementado y probado: `src/data/remote/eventMapping.ts`.

## 6. Descarga (3d) — implementada (ver `PLAN_3D.md`)

- Cada 15 s y, además, inmediatamente al abrir un partido, volver de segundo plano, recuperar conexión, TOMAR CONTROL y ante pérdida de control (F3-6). Partido en consulta: cada 5 s.
- Datos editables: por tabla, `synced_at > cursor − 2 min` y fusión idempotente con la regla del servidor.
- Eventos: por partido, `seq > último local` (el servidor garantiza que no hay huecos); se añaden los que falten y nunca se modifican.

## 7. Interfaz nueva (3b–3d)

INICIAR SESIÓN, aviso de descarte de datos de prueba, banner SIN CONEXIÓN, indicador de sincronización, aviso de control perdido, CERRAR SESIÓN.

## 8. Pruebas

- `npm test`: dominio, datos locales y mapeo de eventos (sin servidor).
- `npm run test:db` (Supabase local con Docker): RLS, permisos por columna, bloqueos, guardián de eventos (con eventos generados por el propio motor de la app, incluidos partidos aleatorios), control único y concurrencia, inmutabilidad, Storage y seed.
- E2E con dos navegadores (3d, `e2e/devices.spec.ts`): descarga, modo consulta, TOMAR CONTROL y pérdida de control. En 3e, contra el despliegue real.

## 9. Bloques

| Bloque | Contenido | Estado |
|---|---|---|
| 3a | Supabase local, migraciones, RLS, bloqueos, guardián de eventos, control único, Storage, seed de prueba, tipos generados, tests de base de datos | hecho |
| 3b | Cuentas individuales: INICIAR SESIÓN, sesión persistente (también sin conexión), recuperación de contraseña, elegir equipo, descarte de datos de prueba, CERRAR SESIÓN; equipo/temporada/perfiles desde el servidor; Dexie v2 (ver `PLAN_3B.md`) | hecho |
| 3c | Subida offline-first (orden fijo, idempotente, exclusión mutua), aviso sin conexión, indicador, conflictos C-1/C-2, cuarentena y CONTROL PERDIDO, errores técnicos (ver `PLAN_3C.md`) | hecho |
| 3d | Descarga + fusión (eventos solo se añaden; editables "gana el último" como el servidor), TOMAR CONTROL atómico (`take_match_control`), historial sin huecos, reloj del servidor, modo consulta, CONTROL PERDIDO con estado oficial y ENTENDIDO (ver `PLAN_3D.md`) | hecho |
| 3e | E2E multi-dispositivo; despliegue en Vercel (HTTPS); guía de puesta en marcha | pendiente |

---

## 11. Decisiones (resueltas)

| # | Decisión |
|---|---|
| F3-1 | Supabase Free. Sin mecanismos externos (p. ej. GitHub Actions) contra la pausa por inactividad; si molesta, se pasará a Pro. La app sigue funcionando en local si el proyecto está pausado |
| F3-2 | Cuentas individuales por entrenador; la autorización real es Supabase Auth + RLS; "¿QUIÉN ERES?" solo como UX |
| F3-3 | Datos locales de pruebas de la Fase 2: se descartan en el primer inicio de sesión con aviso explícito y una confirmación |
| F3-4 | Supabase local con CLI + Docker; `supabase/` en el repositorio; migraciones versionadas; seeds solo de prueba |
| F3-5 | Publicación en Vercel con HTTPS más adelante (3e), no en 3a |
| F3-6 | Sincronización cada 15 s + inmediata al abrir partido, volver de segundo plano, recuperar conexión, TOMAR CONTROL y ante pérdida de control |
| F3-7 | Escudos en Supabase Storage; PostgreSQL guarda ruta y metadatos |
