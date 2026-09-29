# Plan bloque 3b — Acceso con cuentas individuales

Estado: **IMPLEMENTADO** (decisiones B-1…B-5 en §9).

Objetivo: que la app funcione con **la cuenta de cada entrenador** (Supabase Auth) y con el **equipo y la temporada del servidor**, manteniendo intacto el funcionamiento sin conexión. **No incluye** subida ni descarga de jugadores, partidos o eventos (3c/3d).

---

## 1. Qué cambia para el entrenador

```
Primera vez en el móvil (con Internet)          Siguientes veces (con o sin Internet)
┌──────────────────────────┐                   ┌──────────────────────────┐
│ INICIAR SESIÓN           │                   │ PARTIDOS                 │
│ Email / Contraseña       │                   │ ISAAC · Equipo X         │
│ [ENTRAR]                 │                   │ ...                      │
└────────────┬─────────────┘                   └──────────────────────────┘
             ▼                                   (sesión guardada: no se pide nada)
 ¿Datos de prueba de la versión anterior en el móvil?
   sí → aviso + UNA confirmación: "BORRAR Y CONTINUAR"
             ▼
 ¿Varios equipos? → elegir equipo (con uno, directo)
             ▼
          PARTIDOS
```

- La identidad es la **sesión**: el nombre que aparece es el del perfil de Supabase.
- "¿QUIÉN ERES?" desaparece (decisión B-1).
- En la lista de partidos, "Cambiar" pasa a ser **CERRAR SESIÓN**.

## 2. Configuración

- `.env.local` (ya ignorado por git): `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` del Supabase local; en producción, variables de Vercel (3e).
- `.env.example` con los nombres, sin valores.
- Solo la clave **publishable** en la app. Un test comprueba que el build no contiene claves `sb_secret_`/service-role.
- Cliente único `src/data/remote/client.ts`: sesión persistente en el dispositivo, renovación automática del token y sin enlaces mágicos en la URL.

## 3. Arranque (sin depender de la red)

`resolveStartup()` es una función pura y probada que decide la pantalla a partir del estado local:

| Estado local | Resultado |
|---|---|
| Sin sesión guardada | INICIAR SESIÓN |
| Sesión guardada + contexto de equipo en el móvil | App directamente (**también sin conexión**) |
| Sesión de otra cuenta distinta a la de los datos locales | Reconfirmar equipo/datos (§5) |
| Partido en juego controlado por este móvil | Se reabre el partido (como en la Fase 2) |

- Con conexión, en segundo plano, se refresca el contexto (nombre del equipo, temporada actual, perfiles de los compañeros).
- Si el servidor dice que ya no perteneces al equipo, se cierra la sesión **cuando no haya un partido en juego**.

## 4. Sesión caducada o revocada durante un partido

Nunca se interrumpe un partido (prioridad del PRD):
- Si el token no se puede renovar por falta de red, no pasa nada: se reintenta solo.
- Si la sesión deja de ser válida (contraseña cambiada, cuenta desactivada), con un partido en juego se muestra solo un aviso no bloqueante: "Tu sesión ha caducado. Vuelve a iniciar sesión al terminar el partido para sincronizar". Todo sigue guardándose en el móvil.
- Fuera del partido: pantalla INICIAR SESIÓN.

## 5. Datos locales al iniciar sesión (F3-3)

- **Datos de prueba de la Fase 2** (base de datos local sin cuenta asociada y con jugadores/partidos): aviso explícito con el recuento ("12 jugadores y 3 partidos de prueba") y **una confirmación**, BORRAR Y CONTINUAR. Cancelar cierra la sesión sin borrar nada.
- Se borra todo salvo el identificador del dispositivo.
- Los datos locales quedan **vinculados a la cuenta y al equipo** (`meta.accountUserId`, `meta.teamId`):
  - Misma cuenta o mismo equipo → se conservan.
  - **Otro equipo** → mismo aviso y una confirmación (en 3c se añadirá "hay cambios sin sincronizar").

## 6. Modelo local (Dexie versión 2)

| Cambio | Motivo |
|---|---|
| `coaches` → **`profiles`** (id = usuario de Auth, nombre) + **`teamMembers`** (equipo, usuario, rol) | Identidad real del servidor |
| `teams`, `seasons` con los ids del **servidor** | Lo creado en el móvil ya lleva el `team_id` / `season_id` correctos para subirlo en 3c |
| `meta`: `accountUserId`, `teamId`, `seasonId`, `deviceId` (se mantiene) | Arranque sin red y vinculación de los datos |
| Se eliminan el `bootstrap` local (crear equipo/temporada/entrenadores) y `selectedCoachId` | Ya no se inventan equipos en el móvil |

- El `coachId` de los eventos del dominio pasa a ser el **id del usuario** (sin cambios en el dominio).
- Actualización v1 → v2 sin pérdida: las tablas nuevas se añaden y el borrado de los datos de prueba lo decide el §5, no la actualización.

## 7. Qué NO entra en 3b

- Subir o descargar jugadores, partidos, convocatorias o eventos (3c/3d): lo que se cree localmente en 3b queda en el móvil, ya con los ids del equipo del servidor, listo para 3c.
- Banner de sincronización / sin conexión (3c).
- Despliegue (3e).

## 8. Pruebas

- **Unitarias**: `resolveStartup` (todas las combinaciones), detección de datos de prueba, conversión del contexto del servidor → registros locales, mensajes de error de acceso.
- **Datos (IndexedDB simulada)**: actualización v1 → v2, `applyTeamContext`, borrado que conserva `deviceId`, vinculación a cuenta/equipo.
- **Servidor (`test:db`)**: `loadTeamContext` con usuarios del seed (equipo, temporada, compañeros) y con una cuenta sin equipo.
- **E2E (Playwright + Supabase local)**:
  - Contraseña incorrecta: mensaje claro.
  - Iniciar sesión con ISAAC DEMO.
  - La sesión se mantiene al recargar.
  - **Arranque sin conexión con sesión guardada**.
  - Cerrar sesión → pantalla de acceso.
  - Datos de otro equipo → aviso + confirmación.
  - Las 18 pruebas E2E de la Fase 2 pasan con inicio de sesión.
- El build del E2E recibe las variables del Supabase local en tiempo de ejecución (desde `supabase status`), sin claves en el repositorio.

## 9. Decisiones (resueltas)

| # | Decisión |
|---|---|
| B-1 | Se elimina "¿QUIÉN ERES?". Cabecera: nombre del entrenador (perfil de Supabase) + CERRAR SESIÓN |
| B-2 | CERRAR SESIÓN no borra los datos locales en 3b (aún no hay sincronización). Misma cuenta → se conservan. Otra cuenta de otro equipo → aviso + confirmación antes de borrar |
| B-3 | Varios equipos → elegir equipo tras el login; queda guardado; para cambiar: cerrar sesión → entrar → elegir |
| B-4 | Recuperación de contraseña **desde la app** con el flujo de Supabase Auth por correo |
| B-5 | Nunca expulsar de un partido en curso por caducidad/revocación de sesión; aviso no bloqueante; al terminar el partido (o con conexión) se vuelve a entrar |

## 10. Recuperación de contraseña (B-4)

1. INICIAR SESIÓN → "¿Has olvidado la contraseña?" → email → `resetPasswordForEmail(email, { redirectTo: <origen>/restablecer })`. Mensaje siempre igual ("si existe una cuenta con ese email…"), para no revelar qué emails existen.
2. El correo (plantilla propia en español, `supabase/templates/recovery.html`) enlaza a `/restablecer?token_hash=…&type=recovery`.
3. `/restablecer` valida el enlace con `verifyOtp({ token_hash, type: 'recovery' })` y pide la contraseña nueva dos veces (mínimo 8 caracteres) → `updateUser({ password })` → entra en la app.
4. Se usa `token_hash` (no el código PKCE) porque funciona **aunque el enlace se abra en otro navegador** distinto del de la app instalada (en iPhone, el correo abre Safari, cuyo almacenamiento no es el de la PWA).
5. Enlace caducado o ya usado → mensaje claro y botón para pedir otro.

**Importante para producción (3e):** el correo integrado de Supabase Free solo envía a direcciones del equipo del proyecto y con un límite muy bajo. Para que llegue a los entrenadores hay que configurar un SMTP propio (p. ej. un servicio con plan gratuito). En local, los correos se ven en Mailpit (`http://127.0.0.1:54324`) y los tests E2E leen el enlace de ahí.

## 11. Detalle técnico verificado: arranque sin conexión

Con el token de acceso caducado y **sin red**, `supabase.auth.getSession()` devuelve `session: null` y un error de red, aunque la sesión siga guardada. El arranque trata ese caso como "sin conexión con sesión" (usa la cuenta local vinculada) y **no** como "sin sesión"; solo va a INICIAR SESIÓN si no hay ninguna sesión guardada. Cubierto por un test E2E sin conexión.

## 12. Implementación: detalles y limitaciones conocidas

- La sesión de un enlace de recuperación **solo** sirve para cambiar la contraseña: se usa para entrar en la app después de guardar la nueva; si se abandona (incluso cerrando la pestaña), se cierra en ese navegador.
- El aviso de sesión caducada (B-5) está dentro de la página (no flotante) para no tapar controles; en la pantalla de juego aparece junto a los cambios.
- Los borradores de alineación se guardan en cada toque; una recarga **a los pocos milisegundos** de un toque puede cancelar esa última escritura (IndexedDB no permite esperar al cerrar la página). Lo ya guardado sobrevive siempre.
- Producción (3e): configurar un SMTP propio para que el correo de recuperación llegue a los entrenadores, y la URL de la app en *Site URL* / *Redirect URLs* de Supabase.
