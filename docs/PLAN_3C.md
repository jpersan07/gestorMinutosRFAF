# Plan bloque 3c — Subida de datos al servidor

Estado: **IMPLEMENTADO** — decisiones C-1…C-5 cerradas (§10).

Objetivo: que todo lo que el entrenador hace en su móvil **llegue al servidor** en cuanto haya conexión, sin bloquearle nunca, y que un móvil que ha perdido el control del partido **lo sepa y no dé por buenos** eventos que el servidor ha rechazado.

**No incluye** (3d): descargar lo que hacen otros móviles, fusionarlo, TOMAR CONTROL entre dispositivos ni recargar un partido desde el servidor.

---

## 1. Principios (incluidas tus dos condiciones)

1. **Local primero**: la UI sigue escribiendo solo en IndexedDB; la subida va por detrás y nunca bloquea una pantalla.
2. **`match_events` nunca usa "gana el último"**. Los eventos solo se añaden con `append_match_events()`, en orden de `seq`, validados por el servidor. Un evento local es:
   - **aceptado** (pasa a `synced`);
   - **pendiente** (se reintenta);
   - **rechazado** (se aparta a cuarentena).

   Nunca se sobrescribe, se fusiona ni se modifica.
3. **Solo los datos editables** (jugadores, datos del partido, convocatoria, informe, minutos) usan "gana el último" por `updated_at`, y eso ya lo aplica el servidor (3a).
4. **Idempotente**: todo lleva UUID del móvil; reenviar no duplica nada. Una subida cortada a medias se retoma sin efectos secundarios.
5. **Un evento rechazado nunca se queda como si fuera válido** (condición 2, §5).

## 2. Qué se sube y en qué orden

La cola es simplemente lo que tiene `syncState = 'pending'`; no hay una tabla aparte.

| Orden | Datos | Cómo | Si el servidor lo rechaza |
|---|---|---|---|
| 1 | Jugadores | upsert (ids del móvil) | Dorsal repetido con otro móvil → conflicto visible (C-1) |
| 2 | Escudos | subir la imagen a Storage (`<equipo>/<id>.<ext>`) + fila en `crests` | Reintento; si la imagen ya existe, se da por subida |
| 3 | Partidos (solo datos editables; **nunca** estado ni controlador) | upsert | Partido ya empezado en el servidor → se descarta el cambio local con aviso (C-2) |
| 4 | Convocatorias | upsert | Igual que 3 |
| 5 | **Eventos**, por partido y en orden de `seq` | `append_match_events()` | §4 y §5 |
| 6 | Informe y minutos | upsert (el servidor exige partido finalizado) | Reintento tras los eventos |
| 7 | Errores técnicos (`errorLog`) | insert; después se borran del móvil | Se descartan si no caben |

- Si `MATCH_SAVED` llega antes que el informe, el servidor responde `RESULT_REQUIRED`: se suben el informe y los minutos y se reenvían los eventos en la misma pasada.
- Cada fila solo se marca `synced` si **no ha cambiado mientras se subía** (se compara `updatedAt` en la misma transacción). Si cambió, sigue pendiente.

## 3. Cuándo se sube (F3-6)

- **Cada 15 s**, con la app visible, conexión y una sesión válida.
- **Inmediatamente** (con un pequeño margen para agrupar toques) al:
  - hacer un cambio local;
  - recuperar la conexión (`online`);
  - volver de segundo plano;
  - abrir un partido;
  - producirse una pérdida de control (3d añadirá TOMAR CONTROL).
- **Una sola subida a la vez**: si llega otra orden mientras se sube, se hace una pasada más al terminar.
- Durante el partido también se suben los eventos (C-4): así el servidor tiene copia de seguridad casi al momento.
- Sin sesión válida (caducada durante un partido, B-5) no se sube nada. Todo queda pendiente hasta volver a entrar.

## 4. Respuesta del servidor a los eventos

| Respuesta | Tipo | Qué hace el móvil |
|---|---|---|
| `accepted` / `duplicates` | — | Marca esos eventos `synced` |
| `RESULT_REQUIRED` | recuperable | Sube informe y minutos y reintenta |
| `SEQ_GAP`, error de red, error 5xx | recuperable | Reintenta en la siguiente pasada, con espera creciente |
| `SEQ_CONFLICT`, `NOT_CONTROLLER` | **control perdido** | §5 |
| Cualquier otro rechazo de validación (`INVALID_MATCH_SECOND`, `PLAYER_NOT_ON_FIELD`…) | **inválido** | Cuarentena (§5), registro técnico y aviso: "El servidor no ha aceptado parte de este partido" |

## 5. Control perdido: A sin conexión → B toma el control → A reconecta

Al recibir `SEQ_CONFLICT` o `NOT_CONTROLLER`, en una sola transacción:

1. **Cuarentena.** El evento rechazado y **todos los eventos pendientes posteriores de ese partido** (dependen de él) se sacan de `matchEvents` y pasan a una tabla `rejectedEvents`, con el motivo y la hora. Así:
   - dejan de contar para el estado, los minutos y el resumen;
   - no chocan con los eventos del otro móvil cuando se descarguen (3d);
   - quedan guardados para auditoría y no se borran.
2. **El partido se marca "control perdido"** (`controlLostAt`, motivo). Desde ese momento:
   - `runMatchCommand` y el final automático se niegan a escribir (`CONTROL_LOST`), aunque la app siga abierta en la pantalla de juego;
   - se apagan el reloj que registra finales automáticos y la pantalla encendida;
   - se recalculan la caché del estado y los minutos a partir de los eventos que quedan.
3. **Pantalla clara en A**, en lugar de la de juego:

   ```
   OTRO DISPOSITIVO HA TOMADO EL CONTROL
   de este partido. Los cambios hechos aquí sin conexión
   NO se han aplicado:
     • 57' Jugador 10 → Jugador 12
     • Final de la 1ª parte (45')
   El partido continúa en el otro dispositivo.
   ```

   Muestra la lista de cambios en cuarentena en lenguaje del partido. Aparece al instante, esté donde esté el entrenador. La ficha y la lista de partidos muestran "Controlado por otro dispositivo".
4. En **3d** se completará: descarga de los eventos del otro móvil, estado reconstruido desde el servidor y opción de TOMAR CONTROL de nuevo.

## 6. Interfaz

| Pieza | Dónde | Texto |
|---|---|---|
| Sin conexión | Banner en la página (no flota); dentro del partido, junto a los cambios | "SIN CONEXIÓN — Los datos se guardarán localmente y se sincronizarán cuando vuelva Internet." |
| Estado de sincronización | Cabecera de la lista de partidos | "✓ Sincronizado" · "3 cambios pendientes" · "No se ha podido sincronizar; se reintentará" |
| Conflicto de dorsal | Lista de jugadores, en el jugador afectado | "No se ha podido guardar en el servidor: el dorsal 7 ya lo tiene otro jugador. Edítalo." |
| Control perdido | Pantalla de partido y ficha | §5 |
| CERRAR SESIÓN con pendientes | Diálogo de cerrar sesión | "Hay N cambios sin subir. Se conservan en este móvil." + SINCRONIZAR AHORA (C-3) |

Nunca aparecen errores técnicos (PRD §33): los detalles van al registro técnico.

## 7. Cambios en el modelo local (Dexie v3)

- Índice `syncState` en jugadores, partidos, convocatorias, eventos, informes, minutos y escudos, para leer la cola sin recorrer todo.
- `syncState` admite además `'conflict'`, con un motivo legible (`syncIssue`).
- Tabla nueva `rejectedEvents` (cuarentena): evento completo, motivo y hora.
- Partido: `controlLostAt` y `controlLossReason`.
- `meta`: última sincronización correcta y último error (para el indicador).
- La actualización v2 → v3 es sin pérdida y tiene test.

## 8. Estructura

```
src/data/sync/
  mapping.ts      local ↔ filas del servidor (puro)
  classify.ts     clasificar respuestas del servidor (puro)
  quarantine.ts   cuarentena + marca de control perdido (transacción)
  push.ts         una pasada de subida (orden §2, marcado seguro)
src/app/sync/
  SyncProvider    programación §3, estado para la interfaz
  OfflineBanner, SyncIndicator, LostControlScreen
```

El dominio no cambia; `append_match_events` y las tablas del servidor tampoco.

## 9. Pruebas

- **Unitarias**:
  - conversión de cada tipo de fila;
  - clasificación de todas las respuestas;
  - selección de qué eventos van a cuarentena;
  - marcado seguro (una fila que cambió durante la subida sigue pendiente).
- **Datos (IndexedDB simulada)**:
  - la cuarentena recalcula estado y minutos;
  - con el control perdido no se puede escribir, ni por comando ni por el final automático;
  - actualización v2 → v3.
- **Contra Supabase local** (motor de subida real con un usuario DEMO):
  - subida completa y **reintento idempotente**;
  - escudo en Storage;
  - `RESULT_REQUIRED` → informe → guardado;
  - conflicto de dorsal;
  - datos del partido tras PLAY;
  - **control perdido**: el móvil A sube eventos mientras "B" (simulado en el servidor con el `seq` correcto) ha tomado el control → cuarentena, marca y nada inválido en el historial del servidor.
- **E2E**:
  - banner sin conexión;
  - cambios sin conexión → vuelve la red → "✓ Sincronizado" y los datos están en el servidor;
  - **A sin conexión juega → B toma el control → A reconecta → pantalla "OTRO DISPOSITIVO HA TOMADO EL CONTROL"** con la lista de cambios no aplicados, y sin poder seguir registrando;
  - CERRAR SESIÓN con pendientes.

## 10. Decisiones (cerradas)

| # | Decisión |
|---|---|
| C-1 | Dorsal repetido entre móviles: decide el servidor; sin "gana el último" ni fusión; el jugador rechazado queda como **conflicto de dorsal** con mensaje claro ("No se pudo guardar el jugador … — el dorsal ya está utilizado por otro jugador en el servidor") |
| C-2 | Partido bloqueado por otro móvil: manda el servidor; el cambio local queda **rechazado/en conflicto** (no se sobrescribe el remoto) con aviso claro; sin resolución automática en 3c |
| C-3 | CERRAR SESIÓN con pendientes: número de cambios + SINCRONIZAR AHORA; con conexión se intenta subir antes de cerrar; sin conexión no se borra nada; se puede cancelar |
| C-4 | Los eventos se suben **durante** el partido (inmediato tras eventos + cada 15 s). Subir no implica descargar en otros móviles (3d) |
| C-5 | Errores técnicos: con conexión se suben y, confirmados, se limpian; sin conexión se guardan como mucho los últimos 200; no forman parte del estado deportivo |

Texto del aviso sin conexión: **"SIN CONEXIÓN — Los datos se guardarán cuando vuelva Internet."**

## 11. Implementación: detalles

- La fila del partido solo sube los datos editables con su propia hora de edición (`detailsUpdatedAt`): los eventos cambian `updatedAt` a cada momento y, si se usara esa hora, unos datos antiguos podrían "ganar" a una edición más nueva hecha en otro móvil.
- Los eventos solo cambian la caché local del estado del partido; no dejan la fila del partido pendiente de subir.
- Exclusión mutua: Web Locks (entre pestañas) o una cola por base de datos; además el programador agrupa peticiones y hace una pasada extra si llegan durante una subida.
- Un rechazo del servidor por contenido inválido (no por control) también aparta los eventos a cuarentena, pero el móvil sigue controlando el partido y se muestra un aviso en la ficha.
- Las pruebas E2E usan una cuenta y un equipo propios por test (los datos ya se suben al servidor).

## 12. Limitaciones que quedan deliberadamente para 3d

- No se descargan los cambios de otros móviles: un partido con CONTROL PERDIDO no muestra lo que hace el otro dispositivo; solo explica qué no se aplicó aquí.
- No hay TOMAR CONTROL entre dispositivos desde la app (el servidor ya lo soporta).
- Los conflictos (dorsal, partido bloqueado) no se resuelven solos; tampoco se recargan los datos del servidor que "ganaron".
- Sin Realtime: la subida es periódica (15 s) e inmediata tras cambios; la descarga llegará en 3d.
