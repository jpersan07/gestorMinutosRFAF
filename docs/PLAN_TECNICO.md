# Plan técnico — Gestor de minutos

Estado: **Fase 1 implementada** (scaffold + motor de dominio con tests). Decisiones D1–D12 resueltas (§11).
Referencia: `docs/PRD.md`.

---

## 0. Estado actual del proyecto

- Repositorio git inicializado, rama `main`, **sin commits ni ficheros**.
- Entorno: Node 24, npm 11.
- Conclusión: proyecto desde cero. No hay restricciones heredadas.

---

## 1. Stack tecnológico propuesto

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript `strict` | Requisito PRD |
| UI | React 19 | Requisito PRD |
| Build / app | **Vite (SPA)** en lugar de Next.js | Ver justificación abajo |
| Routing | React Router (modo SPA) | Simple, funciona 100% offline |
| Estilos | Tailwind CSS | Rápido para mobile-first, botones grandes, alto contraste |
| PWA | `vite-plugin-pwa` (Workbox) | Precache de toda la app → abre sin Internet |
| BD local | **IndexedDB vía Dexie** | Transacciones, consultas reactivas (`useLiveQuery`), sobrevive a recargas/cierres |
| BD remota | **Supabase (PostgreSQL)** | Relacional, RLS para seguridad, auth lista para el futuro, capa gratuita |
| Tests unitarios | Vitest (+ `fake-indexeddb`) | Dominio y persistencia |
| Tests E2E | Playwright (con `page.clock`) | Permite "avanzar" 45 min y validar el flujo completo del §37 |
| Hosting | Estático (Vercel / Netlify / Cloudflare Pages) | Sin servidor propio que mantener |

### ¿Por qué Vite SPA y no Next.js?

El PRD prefiere Next.js pero permite alternativa "más sencilla o robusta". Esta app es:
- 100% interactiva en cliente (no hay SEO, no hay páginas públicas).
- **Offline-first**: durante el partido la app debe funcionar sin red.

Con Next.js, el soporte offline (service worker + rutas dinámicas como `/partidos/[id]` + SSR/RSC) es la parte más frágil y con más configuración. Una SPA estática precacheada por el service worker abre **siempre**, con o sin Internet, y no tiene servidor que se caiga. Supabase aporta la BD, la seguridad (RLS) y la lógica transaccional (funciones SQL) sin backend propio.

Si preferís Next.js igualmente, la arquitectura de dominio/persistencia descrita aquí es idéntica; solo cambia la capa de shell/routing y la configuración PWA (Serwist).

---

## 2. Arquitectura

Principio: **la lógica de negocio es TypeScript puro sin dependencias**, la UI solo la invoca y pinta el resultado. El teléfono es la fuente primaria durante el partido (local-first); el servidor es la copia compartida.

```
┌──────────────────────── Navegador / PWA ────────────────────────┐
│                                                                 │
│  UI (React)  ──comandos──▶  Application (casos de uso)          │
│      ▲                         │                                │
│      │ useLiveQuery            │ decide() ──▶ eventos nuevos    │
│      │                         ▼                                │
│  Proyecciones  ◀── evolve() ── Dominio puro (state machine,     │
│  (estado derivado)             reloj, minutos, reglas)          │
│                                │                                │
│                                ▼                                │
│                   IndexedDB (Dexie) — escritura SIEMPRE local   │
│                                │  marca "pendiente de sync"     │
│                                ▼                                │
│                   Sync worker (reintentos, idempotente)         │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTPS (cuando hay red)
                                 ▼
                   Supabase: PostgreSQL + RLS + RPC
```

### Estructura de carpetas

```
src/
  domain/                 # TS puro. Sin React, sin Dexie, sin Supabase. 100% testeado.
    types.ts              # Tipos principales
    formations.ts         # 4-3-3, 5-3-2, 4-3-2-1 con slots y coordenadas
    constants.ts          # HALF_DURATION_S=2700, HALFTIME_MIN_WAIT_S=15
    match/
      evolve.ts           # (estado, evento) → estado   (reconstrucción)
      decide.ts           # (estado, comando, now) → eventos | error  (validación)
      tick.ts             # (estado, now) → eventos automáticos vencidos (fin de parte)
      clock.ts            # segundo de partido a partir de timestamps
      errors.ts           # códigos de error de dominio → mensajes en español
    minutes/
      computeMinutes.ts   # eventos → segundos por jugador
      format.ts           # política de redondeo (una única función)
    lineup/
      validateLineup.ts
    __tests__/
  data/
    local/db.ts           # esquema Dexie
    local/repositories.ts # matchRepo, playerRepo… (transacciones atómicas)
    remote/supabase.ts    # cliente
    sync/syncWorker.ts    # push de pendientes + pull de cambios
    logger.ts             # log técnico local (+ subida al servidor)
  app/                    # casos de uso: startMatch(), substitute()… (dominio + repos)
  features/
    coach-select/
    matches-list/
    lineup-editor/
    live-match/
    halftime/
    summary/
    report/
    stats/
  ui/                     # componentes reutilizables: BigButton, Pitch, PlayerChip,
                          # BottomSheet, ConfirmDialog, OfflineBanner, Clock
  main.tsx, router.tsx
supabase/
  migrations/             # SQL versionado
  seed.sql                # entrenadores, jugadores, partidos
e2e/                      # Playwright: flujo completo §37
docs/
```

### Rutas

| Ruta | Pantalla |
|---|---|
| `/` | ¿Quién eres? (si ya hay entrenador guardado → redirige a `/partidos`) |
| `/partidos` | Lista de partidos con estado |
| `/partidos/:id` | **Un único "router por estado"**: `scheduled/setup` → editor de alineación · `first_half/second_half` → pantalla de partido · `halftime` → descanso (+ editor 2ª parte) · `finished` → resumen + informe · `saved` → resumen solo lectura |
| `/estadisticas` | Tabla tipo Excel (Fase 5) |

Que la pantalla dependa del **estado** (y no de la URL) evita que el entrenador acabe en una pantalla incoherente tras recargar.

---

## 3. Esquema de base de datos (PostgreSQL)

Decisiones de diseño:
- **IDs UUID generados en el cliente** → se pueden crear registros offline y reenviarlos sin duplicar (idempotencia).
- `team_id` y `season_id` desde el principio: cuestan una columna y evitan una migración dolorosa cuando haya varios equipos/temporadas (§27, §35).
- Tiempos de partido en **segundos** (`match_second`), nunca solo minutos (§22).
- `match_events` es **append-only**: sin `UPDATE`/`DELETE` permitidos por RLS.
- Las tablas `lineups`, `lineup_players` y `player_match_minutes` son **proyecciones**: se pueden regenerar a partir de los eventos.

```sql
create type match_status as enum
  ('scheduled','setup','first_half','halftime','second_half','finished','saved');
create type home_away as enum ('home','away');
create type match_event_type as enum (
  'SETUP_STARTED','CONTROL_TAKEN','LINEUP_CONFIRMED','MATCH_STARTED','HALF_STARTED',
  'PLAYER_OUT','PLAYER_IN','SUBSTITUTION_UNDONE','HALF_ENDED','MATCH_ENDED','MATCH_SAVED'
  -- futuro: 'GOAL','ASSIST','CARD'… sin cambiar tablas
);

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  name text not null,                    -- '2026-27'
  starts_on date, ends_on date
);

create table coaches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  name text not null,                    -- ISAAC, JORDI, JOSÉ
  active boolean not null default true,
  user_id uuid null,                     -- futuro: vínculo con auth.users
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  name text not null,
  number smallint null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  season_id uuid null references seasons(id),
  opponent text not null,
  match_date date not null,              -- fecha local (sin zona horaria: no se desplaza el día)
  kickoff_time time null,                -- hora local
  location text null,                    -- ubicación / campo
  competition text not null,             -- 'Liga', 'Copa'… (texto; tabla propia si hace falta)
  home_away home_away not null,
  status match_status not null default 'scheduled',   -- caché del estado derivado de eventos
  managed_by uuid null references coaches(id),
  controller_device_id text null,        -- dispositivo que controla el partido en vivo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  saved_at timestamptz null
);

create table lineups (
  id uuid primary key,
  match_id uuid not null references matches(id),
  half smallint not null check (half in (1,2)),
  formation_id text not null,            -- '4-3-3' | '5-3-2' | '4-3-2-1'
  confirmed_at timestamptz not null,
  confirmed_by uuid references coaches(id),
  unique (match_id, half)
);

create table lineup_players (
  id uuid primary key,
  lineup_id uuid not null references lineups(id) on delete cascade,
  player_id uuid not null references players(id),
  slot_id text not null,                 -- 'GK','LB','LCB'… (estable por formación)
  position text not null,                -- rol: 'GK','DEF','MID','ATT'
  unique (lineup_id, player_id),         -- un jugador no ocupa dos posiciones
  unique (lineup_id, slot_id)
);

create table match_events (
  id uuid primary key,                   -- generado en cliente → idempotente
  match_id uuid not null references matches(id),
  seq integer not null,                  -- orden dentro del partido
  event_type match_event_type not null,
  player_id uuid null references players(id),
  related_player_id uuid null references players(id),
  half smallint null,
  match_second integer null,             -- 0..5400 (57:42 → 3462)
  occurred_at timestamptz not null,      -- reloj del dispositivo que lo generó
  received_at timestamptz not null default now(),  -- reloj del servidor
  coach_id uuid null references coaches(id),
  device_id text not null,
  metadata jsonb not null default '{}',  -- p.ej. substitution_id, slot_id, lineup snapshot
  unique (match_id, seq)
);
create index on match_events (match_id, seq);

-- Informe configurable (§24): los campos se definen en datos, no en columnas.
create table report_fields (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id),
  key text not null,                     -- 'goals_for', 'observations'…
  label text not null,
  field_type text not null check (field_type in ('number','text','textarea','select')),
  options jsonb null,
  required boolean not null default false,
  sort_order smallint not null default 0,
  active boolean not null default true,
  unique (team_id, key)
);

-- Convocatoria (D6): editable hasta PLAY; MATCH_STARTED guarda una copia congelada.
create table match_squad (
  match_id uuid not null references matches(id),
  player_id uuid not null references players(id),
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

-- Acceso (D2): usuarios de Supabase Auth ↔ equipos con rol. MVP: una cuenta por equipo;
-- después, cuentas individuales sin cambiar el modelo.
create table team_members (
  user_id uuid not null references auth.users(id),
  team_id uuid not null references teams(id),
  role text not null check (role in ('admin','coach','player')),
  primary key (user_id, team_id)
);

create table match_reports (
  match_id uuid primary key references matches(id),
  data jsonb not null default '{}',      -- { goals_for: 2, goals_against: 1, observations: '…' }
  updated_at timestamptz not null default now(),
  updated_by uuid references coaches(id)
);

-- Proyección para estadísticas / tabla Excel (§26, §27). Se calcula con la MISMA
-- función TS del dominio al finalizar y al guardar; recalculable desde eventos.
create table player_match_minutes (
  match_id uuid not null references matches(id),
  player_id uuid not null references players(id),
  seconds_played integer not null,
  minutes_display smallint not null,     -- según la política de redondeo
  started boolean not null,              -- titular
  subbed_in boolean not null,
  subbed_out boolean not null,
  primary key (match_id, player_id)
);

-- Log técnico de errores del cliente (§33)
create table client_logs (
  id uuid primary key,
  device_id text, coach_id uuid, level text, message text,
  context jsonb, created_at timestamptz not null default now()
);
```

Preparado para el futuro sin implementarlo ahora:
- **Convocatorias**: tabla `match_squad (match_id, player_id)` cuando se decida.
- **Goles/asistencias/tarjetas**: nuevos `event_type` (`GOAL`, `CARD`…) en `match_events`; no requiere cambiar tablas.
- **Roles**: tabla `team_members (user_id, team_id, role)` con `admin | coach | player`.
- **Minutos por competición/temporada/últimos 5**: consultas sobre `player_match_minutes` ⨝ `matches`.

### Formaciones

Definidas **en código** (`src/domain/formations.ts`), versionadas y disponibles offline desde el primer arranque. Cada slot tiene id estable, rol, etiqueta y coordenadas (0–100). Las alineaciones guardan `formation_id` + `slot_id`. Si en el futuro se quieren formaciones editables desde admin, se migran a tabla sin tocar el resto.

```ts
// x: 0 = banda izquierda, 100 = banda derecha · y: 0 = portería propia, 100 = rival
export const FORMATIONS = {
  '4-3-3': { id: '4-3-3', slots: [
    { id: 'GK',  role: 'GK',  label: 'POR', x: 50, y: 6  },
    { id: 'LB',  role: 'DEF', label: 'LI',  x: 12, y: 26 },
    { id: 'LCB', role: 'DEF', label: 'DFC', x: 37, y: 22 },
    { id: 'RCB', role: 'DEF', label: 'DFC', x: 63, y: 22 },
    { id: 'RB',  role: 'DEF', label: 'LD',  x: 88, y: 26 },
    { id: 'LCM', role: 'MID', label: 'MC',  x: 25, y: 50 },
    { id: 'CM',  role: 'MID', label: 'MC',  x: 50, y: 45 },
    { id: 'RCM', role: 'MID', label: 'MC',  x: 75, y: 50 },
    { id: 'LW',  role: 'ATT', label: 'EI',  x: 18, y: 78 },
    { id: 'ST',  role: 'ATT', label: 'DC',  x: 50, y: 84 },
    { id: 'RW',  role: 'ATT', label: 'ED',  x: 82, y: 78 },
  ]},
  '5-3-2':   { /* GK · LWB LCB CB RCB RWB · LCM CM RCM · LST RST */ },
  '4-3-2-1': { /* GK · LB LCB RCB RB · LCM CM RCM · LAM RAM · ST */ },
} as const;
```

---

## 4. Tipos TypeScript principales

Implementados en `src/domain/` (fuente de verdad; este documento solo resume):

- `types.ts` — `Id`, `EpochMs`, `MatchSecond`, `Half`, `MatchStatus`, `FormationId`, `Lineup { formationId, slots: Record<SlotId, Id> }`, `Player`.
- `match/events.ts` — `MatchEvent = EventMeta & EventPayload`: `SETUP_STARTED`, `CONTROL_TAKEN`, `LINEUP_CONFIRMED{half, lineup}`, `MATCH_STARTED{halfDurationS, squad}`, `HALF_STARTED`, `PLAYER_OUT`/`PLAYER_IN{half, matchSecond, substitutionId, slotId, playerId, relatedPlayerId}`, `SUBSTITUTION_UNDONE{substitutionId}`, `HALF_ENDED`, `MATCH_ENDED`, `MATCH_SAVED`.
- `match/decide.ts` — `MatchCommand` (`START_SETUP`, `TAKE_CONTROL`, `CONFIRM_LINEUP`, `START_MATCH`, `SUBSTITUTE`, `UNDO_LAST_SUBSTITUTION`, `START_SECOND_HALF`, `SAVE_MATCH`) y `CommandContext { now, deviceId, coachId, squad, newId, halfDurationS? }`.
- `match/state.ts` — `MatchState` (estado derivado).
- `errors.ts` — `DomainError` (unión discriminada por `code`) y `Result<T>`.
- `minutes/*` — `Interval`, `PlayerMinutes`, `MatchSummary`. `stats/aggregate.ts` — `PlayerTotals`.

---

## 5. Máquina de estados

Patrón decider con tres funciones puras (`src/domain/match/`):
- `evolve(state, event)` — aplica un hecho; nunca falla. `replay(events)` = ordenar por `seq`, deduplicar por id y reducir.
- `decide(state, command, ctx)` — valida y devuelve eventos o `DomainError`. No muta.
- `tick(state, ctx)` — eventos automáticos vencidos, con la hora teórica exacta. Idempotente.
- `execute` = `tick` + `decide`; `advance` = solo `tick` (temporizador de la UI / volver a primer plano).

```
scheduled ─START_SETUP─▶ setup ⟲ CONFIRM_LINEUP(1)   (libre hasta PLAY)
setup ─START_MATCH [lineup 1 ⊆ convocatoria]─▶ first_half ⟲ SUBSTITUTE / UNDO_LAST_SUBSTITUTION
first_half ─tick ≥ 45:00─▶ halftime ⟲ CONFIRM_LINEUP(2)
halftime ─START_SECOND_HALF [lineup 2 ∧ ≥ 15 s]─▶ second_half ⟲ SUBSTITUTE / UNDO_LAST_SUBSTITUTION
second_half ─tick ≥ 90:00─▶ finished ─SAVE_MATCH─▶ saved (todo comando → MATCH_LOCKED)
TAKE_CONTROL: setup…finished. Cualquier otro comando de un dispositivo no controlador → NOT_CONTROLLER.
```

Cambios: el que sale debe estar en el campo; el que entra, convocado y fuera del campo (**reentrada permitida**). Deshacer: anula el último cambio no anulado de la parte en juego mediante `SUBSTITUTION_UNDONE`; se puede encadenar en orden inverso; no alcanza la parte anterior.

---

## 6. Cronómetro basado en timestamps

Nunca se cuenta con `setInterval`. El tiempo se **calcula** siempre:

```ts
const HALF = 2700; // s

function matchSecondAt(s: MatchState, now: EpochMs): MatchSecond {
  switch (s.status) {
    case 'first_half':  return Math.min(HALF, Math.floor((now - s.half1StartedAt!) / 1000));
    case 'halftime':    return HALF;
    case 'second_half': return HALF + Math.min(HALF, Math.floor((now - s.half2StartedAt!) / 1000));
    case 'finished': case 'saved': return 2 * HALF;
    default:            return 0;
  }
}
```

- La UI solo re-renderiza cada ~250 ms (`setInterval` o `requestAnimationFrame`) para **mostrar** el valor. Si JS se suspende 20 s, al volver el cálculo da el tiempo correcto.
- Al volver a la app (`visibilitychange`, `pageshow`, `focus`, arranque) se ejecuta inmediatamente `tick()`.
- **Fin de parte con hora exacta, no la de detección**: si el móvil estuvo bloqueado y el entrenador vuelve en el "52:00", `HALF_ENDED` se registra con `occurredAt = half1StartedAt + 45 min` y `matchSecond = 2700`. Nadie queda con minutos de más.
- **Ids deterministas** para eventos automáticos (`hash(matchId, 'HALF_ENDED', half)`): si se generan dos veces (dos pestañas, reintento) no se duplican.
- **Cambio en el límite**: `SUBSTITUTE` ejecuta primero `tick(now)`; si la parte ya terminó, se rechaza con `HALF_OVER` ("La primera parte ha terminado"). Un cambio a las 44:59 es válido; a las 45:00 no.
- **Regla de los 15 s**: `canStartSecondHalf = lineup2Confirmed && now ≥ half1EndedAt + 15 000`. Como `half1EndedAt` es la hora teórica, si el móvil estuvo bloqueado el descanso, los 15 s ya habrán pasado. La UI muestra cuenta atrás "Disponible en 12 s".
- Riesgo asumido: se usa el reloj de pared del dispositivo (`Date.now()`); si alguien cambia la hora del móvil a mitad de partido, el cronómetro se desplaza. Aceptable para el caso de uso.

---

## 7. Cálculo de minutos

`src/domain/minutes/intervals.ts` construye tramos en el campo por jugador:

| Evento | Acción |
|---|---|
| `HALF_STARTED(h)` | abre tramo para los 11 de la alineación de esa parte |
| `PLAYER_OUT` / `PLAYER_IN` | cierra / abre (se ignoran si su `substitutionId` fue anulado) |
| `HALF_ENDED` | cierra todos |

Varios tramos por jugador (reentradas); los contiguos se fusionan (0–45 + 45–90 → 0–90). Los cambios del descanso salen solos de comparar alineaciones. Un cambio deshecho se ignora por completo, como si no hubiera ocurrido.

- Segundos jugados = Σ(to − from).
- Minutos mostrados = Σ(⌊to/60⌋ − ⌊from/60⌋) (D7): sale en 57:42 → 57', el que entra → 33'. **Cada puesto suma 90** (verificado con 200 partidos aleatorios con reentradas, deshacer y cambios de formación).

---

## 8. Persistencia local y sincronización

### Escritura (siempre local primero)

```
comando UI → decide() → [transacción Dexie: append eventos + actualizar proyecciones
                          + marcar pendiente de sync]  → UI se actualiza (useLiveQuery)
                                                        → syncWorker.kick()
```
- El entrenador **nunca espera a la red**. Si la transacción local falla (rarísimo), se muestra error claro y no se aplica el cambio.
- `navigator.storage.persist()` al arrancar para reducir el riesgo de que el navegador borre IndexedDB.

### Sincronización (push)
- Cada evento/fila tiene `syncState: 'pending' | 'synced'`.
- El worker envía los pendientes **en orden `seq`** mediante una función RPC de Postgres (`sync_match(...)`) en **una transacción**: upsert del partido, `insert … on conflict (id) do nothing` de eventos, lineups, informe.
- Idempotente: reenviar lo mismo 10 veces no duplica nada.
- Disparadores: tras cada escritura, evento `online`, al volver a primer plano, y cada 30 s mientras haya pendientes. Backoff exponencial ante errores.
- Banner "SIN CONEXIÓN — Los datos se guardarán localmente…" cuando `navigator.onLine === false` o falla el sync.

### Descarga (pull)
- Al arrancar y al volver a primer plano: jugadores, partidos, informes y eventos de partidos modificados (`updated_at > último pull`).
- Un partido que **este dispositivo controla** con cambios pendientes nunca se sobrescribe con datos del servidor.

### Recuperación tras recarga/cierre
1. Leer `deviceId` y `selectedCoachId` (IndexedDB + `localStorage` de respaldo).
2. Si hay un partido local en `setup/first_half/halftime/second_half` controlado por este dispositivo → navegar directamente a él.
3. Cargar sus eventos → `evolve()` → estado.
4. `tick(now)` → materializa fines de parte vencidos con su hora exacta.
5. El cronómetro se pinta a partir de los timestamps. Borradores de alineación no confirmados también están en IndexedDB.

### Service worker
- Precache de toda la app: abre en modo avión.
- **Actualizaciones en modo "prompt"**: nunca se recarga la app sola durante un partido en juego; se aplica la nueva versión al volver a la lista.

### Seguridad y acceso (D2)
- **Supabase Auth** (email + contraseña). MVP: una cuenta por equipo, sesión persistente en el móvil (refresh token); después de entrar, "¿Quién eres?" (ISAAC/JORDI/JOSÉ). Sin conexión la app sigue funcionando con la sesión guardada; la sincronización espera a que el token se pueda renovar.
- Futuro: cuentas individuales → `coaches.user_id` + `team_members.role`, sin cambiar el modelo.
- La clave pública de Supabase (`anon`/publishable) está pensada para el frontend; **no es un secreto**. La protección real es RLS: todas las tablas exigen usuario autenticado y miembro del equipo (ver decisión D2). La `service_role` key nunca va al frontend.
- RLS: toda tabla exige `auth.uid()` miembro del `team_id`. `match_events` solo `INSERT`/`SELECT`; `matches` en `saved` no editable (trigger).

### Control del partido y conflictos (D3)
- `SETUP_STARTED` fija el dispositivo controlador; `CONTROL_TAKEN` lo cambia. El dominio rechaza comandos de otros dispositivos (`NOT_CONTROLLER`).
- Fase 3: el servidor solo acepta eventos del controlador vigente (y `unique (match_id, seq)`). Si un móvil que perdió el control sin saberlo (offline) intenta sincronizar, sus eventos se rechazan y la app le avisa de que otro dispositivo tomó el control.

### Pantalla encendida (D12)
- Screen Wake Lock API durante el partido, re-solicitado al volver a primer plano. Si no está disponible, la app funciona igual (el reloj ya no depende de estar despierta).

---

## 9. UX de la pantalla de partido (resumen)

- **Vertical** por defecto (uso con una mano, prioridad del PRD). Campo en vertical, portería propia abajo (como el ejemplo del §12). Responsive a horizontal (campo a la izquierda, reloj a la derecha), **sin forzar ni recomendar girar**: 11 fichas caben bien en ~360 px de ancho y girar obliga a usar dos manos.
- Cabecera: rival · "PRIMERA PARTE" · reloj grande (≥ 64 px, alto contraste) · indicador de conexión.
- Cambio en 3 pulsaciones: tocar jugador → bottom sheet con suplentes disponibles (botones grandes) → tocar el que entra → confirmación "57:23 Carlos → Pablo [CONFIRMAR]". (Ver D8 sobre deshacer.)

---

## 10. Plan de fases (ajuste propuesto)

Propongo **un cambio respecto al PRD**: la persistencia **local** (IndexedDB) entra desde la Fase 2, no en la Fase 3. La recuperación tras recarga es un requisito central del partido y construir primero en memoria obligaría a reescribir. La Fase 3 queda para Supabase + sincronización.

| Fase | Contenido |
|---|---|
| 1 | Este documento + scaffold (Vite, TS strict, Tailwind, Vitest, PWA básica) + dominio puro con tests (state machine, reloj, minutos, cambios) |
| 2 | UI MVP completa sobre IndexedDB: entrenador, lista, editor, partido, descanso, cambios, fin automático, resumen. E2E Playwright del flujo §37 (1-19) |
| 3 | Supabase: migraciones, RLS, seed, sync push/pull, banner offline, logs, recuperación multi-dispositivo |
| 4 | Informe configurable, doble confirmación, guardado definitivo, solo lectura |
| 5 | Estadísticas: tabla tipo Excel, totales, titularidades, suplencias |

---

## 11. Decisiones (resueltas)

| # | Decisión |
|---|---|
| D1 | Vite + React 19 + TS estricto + Tailwind + PWA + Vitest + Playwright |
| D2 | Supabase Auth, cuenta de equipo con sesión persistente → "¿Quién eres?"; modelo preparado para usuarios/roles/equipos |
| D3 | Un solo móvil controla; los demás consultan; botón TOMAR CONTROL |
| D4 | 2 × 45, sin pausa; duración configurable internamente (`halfDurationS`) |
| D5 | **Reentrada permitida**, múltiples entradas/salidas; única restricción: un puesto = un jugador y un jugador no puede estar dos veces |
| D6 | Convocatoria por partido (ordenada por minutos, editable hasta PLAY) + ENVIAR WHATSAPP (`wa.me`, el entrenador elige el grupo). Ficha de partido con INFO, EDITAR (rival, fecha, hora, ubicación), CONVOCATORIA, INICIAR/CONTINUAR, RESUMEN, estado |
| D7 | Segundos internos; minutos = diferencia de minutos de reloj (57:42 → 57', el que entra 33') |
| D8 | Confirmar cada cambio; deshacer último cambio con evento compensatorio; historial inmutable; alineación libre hasta PLAY |
| D9 | Resumen manual: RESULTADO (texto "3-1") + OBSERVACIONES (texto libre). Sin goles/tarjetas todavía; sin exportación a Excel |
| D10 | SAVED = solo lectura, sin desbloqueo |
| D11 | Un equipo; `team_id` y `season_id` desde el principio; temporada configurable; CSV/Excel solo para carga inicial |
| D12 | Wake Lock si está disponible |

### Decisiones menores (documentadas)
- Formaciones en código, no en BD (ver §3).
- Tiempos internos en segundos; minuto visible derivado.
- Eventos con UUID de cliente; el orden canónico es `seq`; los duplicados se descartan por id.
- `MATCH_STARTED` congela convocatoria y duración: el historial se basta a sí mismo.
- Al cambiar de formación, los jugadores se recolocan por rol; lo que no encaje queda sin asignar.
- Un comando pulsado justo después del final de parte primero materializa el final (se persiste) y después se rechaza.
- Orden de la convocatoria: minutos acumulados (partidos `finished`/`saved` de la temporada), empate → dorsal (como número; sin dorsal, al final) → nombre.
- Mensaje de WhatsApp: jugadores por dorsal, de menor a mayor y comparado como número (no por minutos, para no publicar un ranking ni señalar a quien menos juega).
- Fecha y hora del partido como fecha/hora locales (sin zona horaria).
- Sin límite de cambios (no especificado).
- Convocatoria: botón **"CONVOCAR A TODOS"** (selecciona todos los jugadores activos); después se quitan individualmente. La lista de selección se ordena por minutos acumulados; el mensaje de WhatsApp va por dorsal.
