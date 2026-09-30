# Plan Fase 2 — Interfaz + IndexedDB

Estado: **IMPLEMENTADO** — Fase 2 completa (bloques 1–9, un commit por bloque). Sin Supabase: todo se guarda en el dispositivo.
Objetivo: la app completa usable en un móvil **sin Supabase**. Todo se guarda en el propio dispositivo (IndexedDB) y el diseño deja la sincronización (Fase 3) como un módulo que se añade sin tocar la interfaz.

Dependencias nuevas: `dexie`, `dexie-react-hooks`, `react-router` (v7, modo SPA). Tests: `fake-indexeddb`.

---

## 1. Pantallas y navegación

```
/                         ¿QUIÉN ERES?  (si ya hay entrenador guardado → /partidos)
/partidos                 Lista de partidos (por fecha, con estado y escudo)
/partidos/:id             Ficha del partido
/partidos/:id/editar        EDITAR: rival, escudo, fecha, hora, ubicación
/partidos/:id/convocatoria  CONVOCATORIA + ENVIAR WHATSAPP
/partidos/:id/juego         Pantalla de partido (cambia según el estado)
/partidos/:id/resumen       Resumen + informe + GUARDAR
```

### Ficha del partido (`/partidos/:id`)

Cabecera: escudo, rival, fecha · hora · ubicación, estado. Botones según estado:

| Estado | Botones |
|---|---|
| Pendiente / En preparación | EDITAR · CONVOCATORIA · **PREPARAR ALINEACIÓN** |
| En juego / Descanso | **CONTINUAR PARTIDO** · (convocatoria solo lectura) |
| Finalizado | **RESUMEN** (informe pendiente de guardar) |
| Guardado | RESUMEN (solo lectura) |

EDITAR y CONVOCATORIA se bloquean al pulsar PLAY.

### Pantalla de partido (`/juego`): una ruta, contenido según el estado del motor

| Estado | Contenido |
|---|---|
| `scheduled` / `setup` | Editor de alineación (1ª parte) → CONFIRMAR ALINEACIÓN → **▶ COMENZAR** |
| `first_half` / `second_half` | Cronómetro + campo + cambios |
| `halftime` | DESCANSO (cuenta atrás 15 s) → CONFIGURAR 2ª PARTE (editor precargado) → CONFIRMAR → **▶ CONTINUAR** |
| `finished` / `saved` | Redirige a `/resumen` |

Las transiciones automáticas (45:00, 90:00) cambian la pantalla solas, porque la pantalla es una función del estado.

### Arranque y recuperación
Al abrir la app: si hay un partido **en juego o en descanso controlado por este dispositivo**, se abre directamente su `/juego`. Si no, `/` → `/partidos`.

---

## 2. Componentes principales

**`src/ui/`** (reutilizables, sin lógica de negocio):

| Componente | Uso |
|---|---|
| `BigButton` | Botón táctil ≥ 56 px, variantes primario / secundario / peligro |
| `TopBar` | Volver + título + entrenador actual |
| `Pitch` | Campo vertical en SVG (portería propia abajo); en horizontal se adapta |
| `PlayerToken` | Ficha posicionada por `x,y` del slot: dorsal + nombre (o etiqueta POR/DFC si está vacío) |
| `BottomSheet` | Listas de selección (jugador para un slot, jugador que entra) |
| `ConfirmDialog` | Confirmación de cambio, doble confirmación de guardado |
| `Crest` | Escudo del rival o iniciales como alternativa |
| `StatusBadge` | Pendiente / En preparación / En juego / Descanso / Finalizado / Guardado |
| `UndoBar` | "57' Carlos → Pablo · DESHACER" tras un cambio |
| `ClockDisplay` | Cronómetro grande |

**`src/features/`** (pantallas): `coach-select`, `matches`, `match-hub`, `match-edit`, `squad`, `lineup` (`LineupEditor`, reutilizado en la 1ª y 2ª parte), `live` (`MatchScreen`, `LivePanel`, `SubstitutionSheet`, `HalftimePanel`), `summary` (`SummaryView`, `ReportForm`, `SaveFlow`).

**`src/app/`** (conecta dominio ↔ datos ↔ UI):
- `useMatch(matchId)` — eventos de Dexie → `replay` → estado + `dispatch(comando)`.
- `useAutoTick` — solo en el dispositivo controlador: cada segundo y al volver a primer plano ejecuta `advance()` y persiste los finales de parte.
- `useNow` — re-render periódico para el reloj; se refresca en `visibilitychange`, `pageshow` y `focus`.
- `useWakeLock(active)` — pantalla encendida en `/juego`; se vuelve a pedir al volver a primer plano; si no hay soporte, no hace nada.
- `errorMessages.ts` — `DomainError` → texto claro en español. Los errores inesperados van a un log local y el usuario ve un mensaje genérico.

### Flujos de detalle

- **Cambio (3 toques)**: tocar jugador → hoja "CAMBIO · Sale: Carlos (DC)" con los convocados fuera del campo → tocar el que entra → "57:23 · Carlos → Pablo [CANCELAR] [CONFIRMAR]". Después aparece la `UndoBar`.
- **Editor de alineación**: chips de formación → campo con slots → tocar slot → hoja con convocados (primero los libres; los ya colocados muestran su posición y ofrecen "MOVER AQUÍ"; opción "QUITAR"). Contador "Faltan N posiciones". Si se edita después de confirmar, hay que volver a confirmar antes de PLAY.
- **Convocatoria**: jugadores activos ordenados por minutos acumulados (mostrados en cada fila), con casillas; **CONVOCAR A TODOS**; contador; **GUARDAR**; **ENVIAR WHATSAPP** (guarda y abre `wa.me` con el mensaje ordenado por dorsal). Aviso si se sale con cambios sin guardar.
- **Resumen**: minutos (de más a menos), cambios, cambios del descanso, formaciones y alineación inicial. Después el informe: RESULTADO (texto) y OBSERVACIONES (texto grande), que se guardan solos mientras se escribe. **GUARDAR PARTIDO** → "¿Guardar partido?" → "¿ESTÁS SEGURO?" → "✓ PARTIDO GUARDADO [VOLVER A PARTIDOS]".
- **Orientación**: vertical por defecto; en horizontal, el campo a la izquierda y el reloj y los controles a la derecha.
- **Actualizaciones de la app**: el aviso "Nueva versión · ACTUALIZAR" solo se muestra fuera de `/juego`.

---

## 3. Modelo Dexie

```ts
db.version(1).stores({
  meta:              'key',                        // deviceId, selectedCoachId, seedVersion, lastPullAt
  coaches:           'id',
  players:           'id, active',
  seasons:           'id',
  matches:           'id, matchDate, status, syncState',
  matchSquads:       'matchId, syncState',         // { matchId, playerIds[], updatedAt }
  matchEvents:       'id, &[matchId+seq], matchId, syncState',
  lineupDrafts:      '[matchId+half]',             // borrador del editor (no se sincroniza)
  matchReports:      'matchId, syncState',         // { result, observations, updatedAt, updatedBy }
  playerMatchMinutes:'[matchId+playerId], matchId, playerId, syncState',
  crests:            'id',                         // { id, blob, mimeType } escudo redimensionado
  errorLog:          '++id, createdAt',
})
```

Registros principales:

```ts
interface MatchRecord {
  id; teamId; seasonId; opponent; crestId: Id | null
  matchDate: 'YYYY-MM-DD'; kickoffTime: 'HH:MM' | null; location: string | null
  competition: string; homeAway: 'home' | 'away'
  status: MatchStatus              // caché del estado derivado de los eventos
  managedBy: Id | null; controllerDeviceId: string | null
  createdAt; updatedAt; savedAt: EpochMs | null
  syncState: 'pending' | 'synced'
}
type StoredEvent = MatchEvent & { syncState: 'pending' | 'synced' }
```

- `&[matchId+seq]` es **único**: si dos pestañas intentan escribir el mismo `seq`, la segunda falla y reintenta; nunca hay dos historias distintas.
- **El informe** se guarda como `{ result, observations }` y el formulario se define en código como una lista de campos (`REPORT_FIELDS`): para añadir un campo basta con añadir una entrada.
- **Escudo**: foto o galería → se redimensiona a 256 px en un canvas → `Blob` en `crests`. Sin escudo se muestran las iniciales.

### Escritura de comandos (sin carreras)

```ts
db.transaction('rw', [matchEvents, matches, playerMatchMinutes], async () => {
  const events = await db.matchEvents.where('matchId').equals(id).sortBy('seq')  // leído DENTRO de la transacción
  const result = execute(replay(id, events), command, ctx)
  await db.matchEvents.bulkAdd(result.events.map(e => ({ ...e, syncState: 'pending' })))
  await db.matches.update(id, { status, controllerDeviceId, managedBy, updatedAt, syncState: 'pending' })
  if (result.state.status === 'finished') await writePlayerMinutes(...)       // proyección para estadísticas
})
```

El comando del entrenador y el `tick` automático pasan por aquí, y Dexie serializa las transacciones de escritura. Así se evita la carrera entre "el reloj llega a 45:00" y "el entrenador pulsa un cambio".

---

## 4. Qué se persiste localmente

| Dato | Dónde | Cuándo |
|---|---|---|
| Entrenador seleccionado, id del dispositivo | `meta` (+ `localStorage` de respaldo) | al elegir entrenador / primer arranque |
| Jugadores, entrenadores, temporada, partidos | `players`, `coaches`, `seasons`, `matches` | seed inicial; ediciones del partido |
| Convocatoria | `matchSquads` | GUARDAR / ENVIAR WHATSAPP |
| Borrador de alineación | `lineupDrafts` | en cada toque del editor |
| **Todos los eventos del partido** | `matchEvents` | en cada comando y en cada final automático |
| Estado del partido (caché) | `matches.status` | en la misma transacción que los eventos |
| Minutos por jugador | `playerMatchMinutes` | al finalizar y al guardar |
| Informe | `matchReports` | mientras se escribe (con retardo corto) |
| Escudos | `crests` | al elegir imagen |
| Errores técnicos | `errorLog` | cuando ocurren |

El cronómetro **no** se guarda: se calcula desde `HALF_STARTED.occurredAt`.
Al arrancar se llama a `navigator.storage.persist()` para que el navegador no borre los datos.

---

## 5. Recuperación de un partido en curso

1. La app arranca (recarga, cierre o reinicio del móvil) y abre Dexie.
2. Lee de `meta` el `deviceId` y el `selectedCoachId`, así que no hay que volver a elegir entrenador.
3. Busca en `matches` un partido `first_half` / `halftime` / `second_half` con `controllerDeviceId === deviceId` → navega a `/partidos/:id/juego`.
4. `useMatch` lee los eventos → `replay` → estado.
5. `useAutoTick` ejecuta `advance(now)`: si el partido debía haber llegado a 45:00 o 90:00, se registran los finales **con su hora teórica exacta** y la pantalla muestra el descanso o el resumen.
6. El reloj se pinta desde los timestamps; los borradores de alineación y del informe también se recuperan.

Tests: el motor ya lo cubre. En la Fase 2 se añaden tests de repositorio con `fake-indexeddb` que cierran y reabren la base de datos, y tests E2E de Playwright que recargan la página en mitad de cada parte.

---

## 6. Conexión posterior con Supabase (Fase 3)

Regla: **la interfaz solo habla con Dexie**. Supabase se conecta por detrás con un módulo de sincronización independiente.

```
UI ⇄ hooks (src/app) ⇄ repositorios Dexie (src/data)   ← Fase 2
                              ⇅  syncState = 'pending'
                        syncWorker (src/data/sync)      ← Fase 3
                              ⇅  RPC / Storage
                           Supabase
```

- **Push**: el worker envía las filas con `syncState: 'pending'` (eventos en orden de `seq`) mediante una RPC transaccional e idempotente, y las marca como `synced`.
- **Pull**: descarga jugadores, partidos, convocatorias, informes y eventos de otros dispositivos a Dexie, ya marcados como `synced`.

| Dexie | Supabase |
|---|---|
| `matches` (+ `crestId`) | `matches` (+ `crest_path` en Storage, bucket `crests`) |
| `matchSquads.playerIds[]` | `match_squad` (una fila por jugador) |
| `matchEvents` | `match_events` (append-only); `lineups` y `lineup_players` se proyectan en el servidor |
| `matchReports` | `match_reports.data` |
| `playerMatchMinutes` | `player_match_minutes` |
| `lineupDrafts`, `meta`, `errorLog` | locales (`errorLog` → `client_logs`) |

- **Conflictos**: los eventos son inmutables y con id único, así que no chocan. Los metadatos del partido y la convocatoria usan "gana el último `updatedAt`". El control del partido se valida en el servidor (§8 de PLAN_TECNICO).
- **Login (D2)**: se añade una pantalla de acceso antes de "¿Quién eres?".
- **Datos iniciales**: el seed local se sustituye por la descarga desde Supabase.

---

## 7. Orden de implementación (un commit por paso, todo verde en cada uno)

| Paso | Contenido |
|---|---|
| 2a | Dexie: esquema, repositorios, `dispatch` transaccional, seed, tests con `fake-indexeddb` (incluye recuperación) |
| 2b | Shell, router, ¿QUIÉN ERES?, lista de partidos, ficha, EDITAR (con escudo) |
| 2c | CONVOCATORIA (+ CONVOCAR A TODOS, orden por minutos, WhatsApp) |
| 2d | Editor de alineación + confirmación + PLAY |
| 2e | Pantalla de partido: reloj, cambios, deshacer, descanso + 15 s, 2ª parte, final automático, wake lock |
| 2f | Resumen, informe, doble confirmación, solo lectura |
| 2g | Recuperación al arrancar + E2E Playwright del flujo §37 (reloj simulado) + recargas en mitad del partido |

---

## 8. Decisiones (resueltas)

| # | Decisión |
|---|---|
| F2-1 | Jugadores y partidos son datos de la app (nada escrito en el código). **AÑADIR JUGADOR** (nombre + dorsal obligatorios) y editar jugador. **NUEVO PARTIDO** (solo el rival obligatorio; fecha, hora, ubicación y escudo opcionales y editables hasta PLAY). Sin datos reales ni importación/exportación Excel. Datos de prueba solo DEMO, con un botón visible únicamente en desarrollo |
| F2-2 | NUEVO PARTIDO en la lista, con el mismo formulario que EDITAR |
| F2-3 | En la hoja de cambio, minutos que lleva cada suplente en el partido, calculados desde los eventos |
| F2-4 | RESULTADO obligatorio para guardar; OBSERVACIONES opcional |
| F2-5 | Sin competición ni local/visitante por ahora |

### Modelo de datos
- Entidades separadas: `teams`, `seasons`, `coaches`, `players`, `matches`, `matchSquads`, `matchEvents`, `lineupDrafts`, `matchReports`, `playerMatchMinutes`, `crests`, relacionadas por id. Todos los registros son JSON plano (test que lo verifica); añadir un campo opcional no rompe los datos existentes.
- El jugador pertenece al **equipo**; `active` = está en la plantilla actual (las bajas no se borran porque tienen historial). Las estadísticas por temporada salen de los partidos de esa temporada. Si más adelante hace falta una plantilla por temporada (dorsal distinto cada año), se añade una tabla de relación sin tocar las existentes.
- No puede haber dos jugadores **activos** con el mismo dorsal (0–99).
- Escudo guardado como data URL de una imagen redimensionada (serializable).
- Arranque: se crean el equipo ("Mi equipo"), la temporada actual (julio–junio) y los entrenadores ISAAC, JORDI y JOSÉ, que son los usuarios reales del PRD y no datos de prueba.
- La partida (`START_SETUP`) empieza al elegir formación por primera vez: el partido pasa a "En preparación" y este móvil pasa a controlarlo.

### Decisiones menores tomadas durante la implementación
- La lista para elegir jugador en el editor muestra primero los libres y después los ya colocados (con su posición).
- Al intentar colocar a un jugador que ya ocupa otra posición: mensaje claro + botón **MOVER AQUÍ**.
- Cambiar la alineación ya confirmada obliga a volver a confirmar antes de PLAY / CONTINUAR.
- En el descanso, la alineación de la 2ª parte se precarga con cómo acabó la 1ª.
- El informe se guarda solo mientras se escribe (y al pasar la app a segundo plano); "Guardado en el dispositivo" solo aparece si no hubo cambios durante la escritura.
- En la hoja de cambio, cada suplente muestra los minutos que lleva **en este partido**; en la convocatoria, los minutos **de la temporada**.
- En horizontal los nombres del campo se abrevian (el dorsal siempre se ve); el uso principal es en vertical.

### Verificación
- Tests unitarios (Vitest): dominio + capa de datos con IndexedDB simulada (flujo completo, concurrencia, reabrir la base de datos).
- Tests E2E (Playwright, móvil, reloj simulado): jugadores, partidos, EDITAR, convocatoria + WhatsApp, editor, PLAY, partido completo, resumen y guardado, recuperación (cerrar/reabrir en cada fase, pantalla bloqueada durante el final de parte, recarga en el descanso, sin conexión) y el flujo completo del PRD §37.
