# Bloque 3d — Descarga, fusión y TOMAR CONTROL entre dispositivos

Estado: **IMPLEMENTADO** — decisiones cerradas (§10).

Objetivo: cerrar el escenario **A sin conexión → B toma el control → A reconecta → A detecta la pérdida → A descarga el estado oficial de B → A ve el partido actualizado en modo consulta**.

**No incluye** (queda para 3e o después): Realtime, SMTP, gestión avanzada de pérdida de cuenta, despliegue.

---

## 1. Principios

1. **Local primero.** La UI sigue leyendo y escribiendo solo en IndexedDB. La descarga escribe en IndexedDB por detrás; las pantallas (`useLiveQuery`) se actualizan solas.
2. **Cada pasada: primero subir, después descargar**, bajo un único candado (`syncOnce`):
   1. subir lo pendiente;
   2. procesar respuestas y rechazos;
   3. detectar pérdida de control y conflictos;
   4. descargar;
   5. actualizar el estado local.
3. **Eventos: nunca "gana el último"** (§3).
4. **Datos editables:** jugadores, datos del partido, convocatoria, informe y minutos. Siguen la regla ya acordada de "gana el último", **idéntica a la del servidor** (§4). El estado y el control del partido nunca pasan por esta vía.
5. **Nunca dos controladores.** Un móvil solo controla un partido cuando el servidor ha aceptado su `SETUP_STARTED` o su `CONTROL_TAKEN`.

## 2. Qué se descarga

| Datos | Cómo se detecta lo nuevo | Fusión |
|---|---|---|
| Equipo, temporadas, miembros y perfiles | Instantánea en cada pasada completa | Se sustituyen (solo lectura en el móvil) |
| Jugadores, datos de partidos, convocatorias, informes, minutos | `synced_at` (hora del **servidor**) > cursor − 2 min, por páginas | Gana el último, como el servidor (§4) |
| **Eventos** | `matches.last_seq` del servidor > último `seq` sincronizado en el móvil → `seq > local`, en orden | Solo se añaden (§3) |
| Imágenes de escudo | Escudos que usa algún partido y aún no están en el móvil | Storage → `dataUrl` local |

Detalles de la descarga:

- **Cursores.** Se guarda uno por equipo y tabla en `meta` (`cursor:<equipo>:<tabla>`). Es el mayor `synced_at` recibido y nunca retrocede. Solo avanza si **todo** lo de esa tabla (incluidos los eventos de los partidos) se guardó. Si algo falla, se reintenta desde el mismo punto.
- **Móvil nuevo.** Sin cursor, descarga todo el equipo: todas las temporadas, jugadores activos e inactivos, partidos, convocatorias, informes, minutos, eventos y escudos. Los ids son siempre los del servidor.
- **Partidos con CONTROL PERDIDO sin estado oficial.** Se recargan completos, pidiendo **todos** los eventos desde `seq = 1` y verificando los que ya había.
- **Modo consulta.** Cada 5 s, una pasada ligera: subida y descarga **solo de ese partido** (fila, eventos, convocatoria, informe y minutos).

## 3. Eventos: nunca "gana el último"

`mergeServerEvents`, en una sola transacción:

| Evento del servidor con `seq = n` | Qué se hace |
|---|---|
| El móvil no tiene `n` | Se **añade** como `synced` |
| Mismo `seq` y mismo `id` | Ya estaba; si era pendiente, pasa a `synced`. **Nunca se modifica** |
| Mismo `seq`, distinto `id`, el local pendiente | El local y **todos** los posteriores van a la **cuarentena** (`SEQ_CONFLICT`); CONTROL PERDIDO; entran los del servidor |
| Mismo `seq`, distinto `id`, el local "sincronizado" (no debería pasar) | Igual, con motivo `DIVERGED` y registro técnico. Nada se borra |
| La descarga dejaría un hueco | No se guarda nada (`DownloadGapError`); se reintenta |

Después de fusionar:

- La caché del partido (estado, controlador, `managedBy`) y los minutos se recalculan con `replay`, a partir de los eventos oficiales.
- **CONTROL PERDIDO sin nada pendiente.** Si este móvil controlaba y la descarga trae el `CONTROL_TAKEN` de otro dispositivo, se marca `TAKEN_BY_OTHER`. Es el caso de A **con** conexión.
- **Estado oficial.** Cuando el historial local es exactamente el del servidor hasta su `last_seq`, se marca `officialStateAt`.
- **TOMAR CONTROL cuya respuesta se perdió.** Si la descarga trae un `CONTROL_TAKEN` de este mismo móvil y cuenta, el móvil vuelve a controlar el partido. El servidor ya lo había aceptado.

## 4. Datos editables

`adoptServerVersion` refleja el trigger `last_write_wins` del servidor:

| Versión local | Resultado |
|---|---|
| No existe, o ya sincronizada | Se toma la del servidor |
| Pendiente, con `updated_at` ≥ el del servidor | Se conserva. Se sube en la siguiente pasada y el servidor la acepta |
| Pendiente, con `updated_at` < el del servidor | Se toma la del servidor (estrictamente más reciente) |
| Conflicto `MATCH_LOCKED` (C-2) | Se toma la del servidor, que es definitiva. El aviso se mantiene en la ficha |
| Conflicto `NUMBER_TAKEN` (C-1) | Se conserva hasta que el entrenador cambie el dorsal |

- La hora de edición la pone el móvil **corregida con la hora del servidor** (§6). El cursor usa solo la hora del servidor.
- Esto también cierra un hueco de 3c: si el servidor ignoraba un cambio por ser más antiguo, el móvil lo marcaba `synced` y seguía mostrando su versión. Ahora la descarga le trae la buena.

## 5. TOMAR CONTROL (atómico en el servidor)

- **Nueva RPC** `take_match_control(p_match_id, p_expected_control_epoch, p_event)`.
  - Bajo `FOR UPDATE` sobre la fila del partido, toma el control **solo si** el `control_epoch` que el móvil descargó sigue siendo el actual. Si no, responde `CONTROL_CHANGED` y no escribe nada.
  - Después pasa el `CONTROL_TAKEN` por la validación completa de 3a: pertenencia al equipo, `seq = último + 1`, partido no guardado…
- **`append_match_events` ya no acepta `CONTROL_TAKEN`.** Procesa los eventos anteriores y lo rechaza con `TAKE_CONTROL_REQUIRED`. La validación interna pasa a ser privada (`private.append_match_events_unchecked`) y no se puede llamar desde la API.
- **En el móvil** (`takeControl`), bajo el candado de sincronización:
  1. sube lo pendiente;
  2. descarga el partido completo;
  3. comprueba el control actual;
  4. mide el reloj con el servidor;
  5. envía `CONTROL_TAKEN` **sin guardarlo antes en local**.
- **Respuestas posibles:**
  - **Aceptado:** se guarda como `synced`, se limpia CONTROL PERDIDO y se congela la referencia de reloj.
  - **`SEQ_CONFLICT`:** el controlador registró algo entre medias. Se descarga y se reintenta, como máximo 3 veces, con el **mismo** epoch.
  - **`CONTROL_CHANGED`:** otro móvil ganó. Se descarga el estado oficial y se sigue en consulta.
  - **Red o servidor:** no cambia **nada** en el móvil.
- **Sin conexión**, el botón está desactivado: "Necesitas conexión para tomar el control."
- `runMatchCommand` rechaza `TAKE_CONTROL` (`TAKE_CONTROL_REQUIRES_SERVER`). El dominio no cambia.

## 6. Reloj del servidor

- **Nueva RPC** `server_time()`, solo para usuarios autenticados.
- **`ServerClock`** mide la diferencia con el servidor: hora del servidor − punto medio de la ida y vuelta.
  - Descarta medidas con más de 5 s de ida y vuelta.
  - Ignora cambios menores de 500 ms.
  - Guarda la última medida para arrancar sin conexión.
- **`env.now()`** de la app es la hora estimada del servidor. Se usa en las ediciones y para pintar partidos en consulta.
- **Eventos del partido** (`matchClockOffset`):
  - **Antes de PLAY**, se usa la corrección en vivo.
  - **Desde PLAY**, la corrección queda **congelada** para ese periodo de control, identificado por el `SETUP_STARTED` o `CONTROL_TAKEN` que lo inició. Nunca cambia a mitad de partido.
  - **Al TOMAR CONTROL**, se mide de nuevo y se congela para el nuevo periodo.
- El servidor sigue siendo la **autoridad final**: valida la coherencia temporal de cada evento. Esto está probado: un móvil con el reloj atrasado y sin corrección ve rechazado su cambio.

## 7. Interfaz

- **Modo consulta** (`ViewerScreen` + `MatchReadOnly`), cuando el partido lo controla otro dispositivo.
  - **Muestra:**
    - estado, reloj ("Cronómetro (solo consulta)");
    - jugadores en el campo (lista "En el campo", sin botones);
    - cambios ("Cambios del partido");
    - resultado si existe;
    - quién lo gestiona.
  - **Solo acción posible:** TOMAR CONTROL.
  - **Refresco:** cada 5 s mientras está en pantalla.
- **Control perdido** (`LostControlScreen`):
  - aviso "OTRO DISPOSITIVO HA TOMADO EL CONTROL";
  - "Cambios no aplicados" (de la cuarentena);
  - en cuanto está descargado, "ASÍ ESTÁ EL PARTIDO AHORA" con el estado oficial;
  - botones **ENTENDIDO** y VOLVER A PARTIDOS.
- **ENTENDIDO** solo está disponible con el estado oficial ya cargado y con otro dispositivo como controlador (`canAcknowledgeControlLoss`).
  - Solo oculta el aviso: **no devuelve el control**. `controlLostAt` se mantiene y el móvil sigue sin poder escribir.
  - Desde el modo consulta se puede volver a TOMAR CONTROL.
- **Ficha del partido:**
  - "Controlado por otro dispositivo (nombre)";
  - desplegable **CAMBIOS NO APLICADOS**, con la cuarentena consultable. Nunca se reaplica ni se borra;
  - aviso de partido ya empezado (C-2): "Se muestran los datos del servidor";
  - botón VER PARTIDO en lugar de CONTINUAR PARTIDO.
- **Lista de partidos:** "Controlado por otro dispositivo" también en partidos en juego que controla otro móvil.
- **Resumen:** solo quien controla el partido escribe el informe y lo guarda. El resto lo consulta.

## 8. Cambios técnicos

- **Migración** `20260930080000_take_control_and_download.sql`:
  - trigger `a_contiguous_seq`;
  - `append_match_events` con el filtro de `CONTROL_TAKEN`;
  - `take_match_control`;
  - `server_time`.
- **Dexie:** sin cambio de versión. Solo campos opcionales nuevos en `MatchRecord`:
  - `officialStateAt`;
  - `controlLossAcknowledgedAt`;
  - `clockOffset`.

  Los cursores y la última corrección de reloj van en `meta`.
- **Código:**
  - `src/data/remote/syncRemote.ts`: lecturas y RPC, con una interfaz para probarlas con un servidor simulado;
  - `src/data/sync/`: `clock.ts`, `lock.ts`, `merge.ts`, `pull.ts`, `sync.ts`, `takeControl.ts`;
  - `src/data/repositories/control.ts`: ENTENDIDO;
  - `src/app/sync/SyncProvider.tsx`: pasada completa cada 15 s desde el final de la anterior, y 5 s para el partido en consulta;
  - `src/features/match/`: `ViewerScreen`, `MatchReadOnly`, `TakeControlButton` y `LostControlScreen`.

## 9. Garantías

**Los eventos nunca usan "gana el último":**

- **En el servidor:**
  - `match_events` es inmutable: triggers que impiden UPDATE, DELETE y TRUNCATE, también con la clave de servicio;
  - solo se añade mediante RPC, con `seq = último + 1` bajo bloqueo;
  - el trigger `a_contiguous_seq` impide que exista `seq = n` sin `n − 1`.
- **En el móvil:**
  - la descarga solo **añade** eventos;
  - un evento existente nunca se toca;
  - ante un choque de `seq`, el evento local se aparta a una cuarentena que no se borra ni se reaplica.
- No hay ninguna ruta de código que actualice un evento a partir de datos del servidor. Está probado en `download.test.ts` ("un evento que ya está en el móvil nunca se modifica").

**TOMAR CONTROL es atómico:**

- Es una sola llamada al servidor que compara `control_epoch` y cambia el control dentro de la misma transacción y bajo `FOR UPDATE` sobre la fila del partido.
- Dos tomas simultáneas con el mismo epoch: la segunda espera al bloqueo, ve el epoch ya cambiado y recibe `CONTROL_CHANGED`. Nunca decide la hora ni el orden de llegada.
- No existe otra forma de escribir un `CONTROL_TAKEN`: `append_match_events` lo rechaza y la validación interna no es accesible.
- El móvil no se considera controlador hasta que la respuesta lo confirma.

**Un móvil con el reloj mal no genera tiempos incoherentes:**

- Todos los tiempos de evento se calculan con la hora del servidor: reloj del móvil + diferencia medida con `server_time()`.
- La referencia se congela por periodo de control, así que el cronómetro no salta.
- El servidor valida la coherencia (segundo declarado frente a hora, finales de parte exactos, descanso) y rechaza lo incoherente, que va a cuarentena.
- Probado con relojes de +90 s y −75 s (unitario) y de +3 min y −3 min contra el Supabase local.

## 10. Decisiones (cerradas)

| # | Decisión |
|---|---|
| D-1 | Modo consulta completo en solo lectura: estado, reloj, jugadores en el campo, cambios, información del partido y resultado |
| D-2 | Descarga cada 5 s con el partido abierto en consulta y cada 15 s fuera. Sin Realtime |
| D-3 | ENTENDIDO solo con el estado oficial descargado. No devuelve el control; el partido sigue en consulta |
| D-4 | La cuarentena nunca se borra ni se reaplica; se consulta desde la ficha. Repetir un cambio se hace a mano, con las reglas del dominio |
| D-5 | La hora del servidor es la referencia, con la corrección congelada por periodo de control |
| D-6 | Un móvil nuevo descarga todo el equipo (todas las temporadas). Nunca se inventan equipos ni temporadas |
| D-7 | Puede TOMAR CONTROL cualquier miembro del equipo (el servidor lo comprueba). Sin bloqueos por tiempo, actividad o controlador anterior |

## 11. Pruebas

- **`npm test`**: `src/data/__tests__/download.test.ts`, 20 tests con un servidor simulado (`fakeServer.ts`). Cubren:
  - fusión de eventos, evento existente intacto, choque de `seq` y cuarentena, huecos;
  - cursores de eventos y de datos editables;
  - la regla de "gana el último";
  - modo consulta;
  - TOMAR CONTROL: aceptado, `control_epoch`, simultáneo, `SEQ_CONFLICT` con reintento, sin conexión y fallo de red (también con la respuesta perdida);
  - escenario A/B con ENTENDIDO antes y después, y recuperación del control;
  - relojes.
- **`npm run test:db`**: `supabase/tests/download.test.ts`, con dos o tres móviles con la app real contra el Supabase local:
  - móvil nuevo, incluido el escudo;
  - RLS en la descarga;
  - el **escenario completo de 18 pasos**;
  - TOMAR CONTROL simultáneo;
  - relojes desfasados.

  Además, en `events.test.ts`:
  - `TAKE_CONTROL_REQUIRED` y `CONTROL_CHANGED`;
  - reintento idempotente;
  - no miembros y validación interna inaccesible;
  - `server_time`;
  - **historial sin huecos**, también con la clave de servicio;
  - lotes concurrentes con el mismo `seq`.
- **E2E** (`e2e/devices.spec.ts`), con dos navegadores independientes:
  - móvil nuevo;
  - lista cada 15 s;
  - modo consulta cada 5 s, y TOMAR CONTROL desactivado sin conexión;
  - escenario A/B completo con ENTENDIDO y recuperación del control;
  - conflicto de partido ya empezado.
- **Tests E2E aislados.** Los de `auth.spec.ts` que modificaban el equipo DEMO compartido ahora usan equipos propios. Como la app descarga los datos del equipo, compartir datos entre tests los hacía depender unos de otros.

## 12. Límites que quedan (3e o después)

- **Sin Realtime.** Lo que hace otro móvil tarda hasta 5 s (en consulta) o 15 s (resto) en verse.
- **Mismo móvil, otra cuenta del mismo equipo con un partido en juego.** El controlador en el móvil se identifica por dispositivo (dominio) y en el servidor por dispositivo y cuenta. En ese caso raro, el aviso de CONTROL PERDIDO no ofrece ENTENDIDO; se puede volver a la lista.
- **Hora futura.** Resuelto en 3e.1: el servidor rechaza eventos más de 60 s en el futuro (`EVENT_IN_FUTURE`, reintentable; ver `PLAN_3E.md` §11).
- **Salir de un equipo o perder la membresía** con datos pendientes no tiene todavía un flujo propio en la app. El servidor ya lo impide con RLS.
- **Descarga inicial sin paginación avanzada.** Solo páginas de 1000 filas por tabla; suficiente para el volumen previsto.
- **Una desconexión a mitad de TOMAR CONTROL** (tras aceptarlo el servidor) se resuelve en la siguiente descarga, sin reintento automático del botón.
