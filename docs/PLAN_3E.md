# Plan bloque 3e — Puesta en producción (Vercel + Supabase) y guía

Estado: **3e.1 IMPLEMENTADO** (`2df0a05`, §11). **Camino de 3e.2 preparado y revisado** (§12). La puesta en marcha real sigue pendiente de autorización. Decisiones cerradas en §9.

Objetivo: que los entrenadores usen la app de verdad, en sus móviles, **instalada como PWA con HTTPS**, contra un Supabase en la nube. Todo lo de 3a–3d (seguridad, offline, TOMAR CONTROL) debe funcionar igual que en local. Además, debe quedar una **guía** para ponerla en marcha y administrarla sin depender de mí.

**No incluye**:
- Realtime.
- Panel de administración dentro de la app.
- Invitaciones por correo.
- Estadísticas nuevas ni Excel.
- Cambios de UX que no sean necesarios para producción.

---

## 1. Cómo se divide

3e toca cuentas y servicios externos (Supabase, Vercel, correo, dominio). Por eso propongo **dos bloques**, cada uno con su commit:

| Bloque | Qué | ¿Necesita tus cuentas? |
|---|---|---|
| **3e.1 Preparación** | Todo lo que vive en el repositorio (configuración de producción, cabeceras de seguridad, plantillas de administración, guía y pruebas contra una URL) | No. Lo hago y lo pruebo en local |
| **3e.2 Puesta en marcha** | Crear los proyectos, aplicar las migraciones, configurar el correo, publicar y verificar en móviles reales | Sí. Tú creas las cuentas; los pasos que publican o cambian producción se hacen **solo con tu confirmación explícita** |

## 2. Supabase de producción

- **Proyecto.** Supabase Free (F3-1), en una región de la UE (D-E5).
  - Aviso de protección de datos: si los jugadores son menores, sus nombres son datos personales de menores; conviene que estén en la UE y que el club lo sepa.
  - La contraseña de la base de datos va a tu gestor de contraseñas. Nunca al repositorio ni al chat.
- **Migraciones.**
  - Se enlaza con `supabase link --project-ref <ref>`.
  - Primero `supabase db push --dry-run` para ver qué se aplicaría; después `supabase db push`.
  - **Nunca** se aplica `seed.sql`: sin `--include-seed`, las cuentas y equipos DEMO no llegan a producción.
- **Configuración de Auth reproducible.**
  - En `config.toml` se añade una sección `[remotes.production]` con lo que cambia en producción: *Site URL* y *Redirect URLs* con el dominio real, SMTP (§4) y la plantilla del correo de recuperación.
  - Se aplica con `supabase config diff` (revisar) y `supabase config push` (pide confirmación por cada cambio).
  - Se mantiene lo que ya existe: registro público desactivado, acceso por email activo y contraseña de 8 caracteres como mínimo.
- **Claves.**
  - En la app, solo la clave **publishable**, como variable de Vercel (no en el repositorio).
  - La clave secreta/service-role **no se usa en ningún sitio**: ni en la app, ni en Vercel, ni en scripts.
- **Storage.** El bucket privado `crests` lo crea la migración de 3a. Se comprueba tras el `db push`.
- **Pausa por inactividad** (Free, F3-1, aceptada).
  - La guía explica cómo reactivar el proyecto.
  - Mientras esté pausado, la app sigue funcionando en el móvil y sincroniza al volver.
- **Copias de seguridad** (D-E8).
  - Guía y script para `supabase db dump`: esquema y datos, a un fichero **fuera del repositorio**.
  - Se ejecuta a mano, por ejemplo una vez al mes o al final de la temporada.
  - Se comprueba qué copias incluye el plan Free en el momento de crear el proyecto.

## 3. Vercel (HTTPS)

- **Publicación.**
  - Proyecto conectado al repositorio de GitHub. Preset Vite: `npm run build` → `dist`.
  - Variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` solo en *Production*.
  - Cada `push` a `main` publica. Como tú decides cuándo hago push, **el push es la puerta de la publicación**.
- **Actualizaciones.** Si hay una versión nueva, la app pregunta y **nunca se recarga sola durante un partido** (ya existe desde la Fase 2).
- **Previews** (D-E6). Propongo desactivarlas, o dejarlas **sin** variables: una preview no debe escribir en la base de datos de producción.
- **`vercel.json`** (nuevo):
  - todas las rutas → `index.html` (para abrir directamente `/restablecer?token_hash=…` desde el correo, antes de que exista el service worker);
  - `index.html`, `sw.js` y el manifest sin caché de navegador (para que las actualizaciones se detecten);
  - los ficheros con hash, caché inmutable de 1 año.
- **Cabeceras de seguridad:**
  - `Content-Security-Policy`:
    - `default-src 'self'`;
    - `connect-src 'self' https://<ref>.supabase.co`;
    - `img-src 'self' data: blob:` (los escudos son data URL);
    - `frame-ancestors 'none'`;
    - `object-src 'none'`;
    - `base-uri 'self'`;
    - `form-action 'self'`;
  - `Strict-Transport-Security`;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy: strict-origin-when-cross-origin`;
  - `Permissions-Policy` mínima.

  La CSP se prueba antes en local sirviendo `dist` con esas mismas cabeceras. Así, si algo se rompe (Supabase, service worker, escudos), se detecta antes de publicar.
- **Dominio** (D-E2): `*.vercel.app` para empezar, o uno propio.

## 4. Correo de recuperación de contraseña (SMTP propio)

- El correo integrado de Supabase Free solo llega a los miembros del proyecto y con un límite muy bajo. Por eso hace falta un SMTP propio (D-E1).
- Remitente con nombre claro (p. ej. "Gestor de Minutos"). Plantilla en español: la de `supabase/templates/recovery.html`, ya probada.
- El usuario y la contraseña del SMTP se guardan solo en el panel de Supabase, o como variable de entorno al hacer `config push` (`env(...)` en `config.toml`). Nunca en el repositorio.
- Límite de envíos por hora de Auth ajustado a un valor razonable.
- Se prueba de extremo a extremo: pedir el correo desde el móvil → llega → el enlace abre `/restablecer` → contraseña nueva → entra.

## 5. Administración sin panel (guía + plantillas SQL)

Propuesta (D-E4): **plantillas SQL** en `supabase/admin/` con marcadores, sin datos reales, que el administrador ejecuta en el *SQL Editor* de Supabase.

| Tarea | Cómo |
|---|---|
| Crear el equipo y su temporada | `01_crear_equipo.sql`: equipo + temporada + temporada actual |
| Dar de alta a un entrenador | Panel → Authentication → *Add user* (email, confirmado, **sin** contraseña conocida) + `02_anadir_entrenador.sql` (miembro con rol). El entrenador pone **su propia** contraseña con "¿Has olvidado la contraseña?": el administrador nunca la conoce |
| Nombre visible del entrenador | Se guarda en el perfil al crearlo (`display_name`) o después con `03_nombre_entrenador.sql` |
| Quitar a un entrenador del equipo | `04_quitar_entrenador.sql`. Sus eventos siguen en el historial; la app le cierra la sesión si no está en un partido (3b) |
| Nueva temporada | `05_nueva_temporada.sql`: nueva temporada + temporada actual. La app la recoge al abrirse con conexión |
| Consultar quién controla un partido o revisar errores técnicos | `06_consultas.sql` (solo lectura: `matches`, `client_logs`) |

Todas las plantillas llevan comentarios y se prueban contra el Supabase local en `test:db`, con los marcadores sustituidos por datos de prueba.

## 6. Pruebas

**En 3e.1 (automáticas, en local):**
- `vercel.json`: un test comprueba las reescrituras y que las cabeceras de seguridad estén todas.
- Un E2E sirve `dist` **con las cabeceras de producción** (CSP incluida) y repite los flujos críticos:
  - acceso;
  - partido;
  - modo sin conexión;
  - TOMAR CONTROL entre dos navegadores;
  - recuperación de contraseña.

  Así se demuestra que la CSP no rompe nada.
- Plantillas SQL de administración, con `test:db`.
- **Prueba rápida contra una URL** (`npm run test:prod -- <url>`), sin iniciar sesión y sin escribir nada en el servidor:
  - HTTPS;
  - cabeceras;
  - manifest instalable;
  - service worker activo;
  - pantalla de acceso;
  - el código publicado sin claves secretas;
  - redirección de `/restablecer`.
- Toda la batería de siempre.

**En 3e.2 (contra producción, D-E3):**
- La prueba rápida contra la URL real.
- **Lista de comprobación en móviles reales**, Android (Chrome) e iPhone (Safari), instalando la PWA:
  - acceso;
  - abrir la app sin conexión;
  - pantalla siempre encendida en el partido;
  - partido completo con cambios;
  - sin conexión a mitad de partido;
  - TOMAR CONTROL entre dos móviles;
  - control perdido y ENTENDIDO;
  - correo de recuperación;
  - aviso de versión nueva.
- Se hace con un **equipo de pruebas temporal** creado con las plantillas y se borra al terminar (incluidos sus usuarios).

## 7. Documentación

- **`docs/GUIA_PUESTA_EN_MARCHA.md`**, paso a paso para alguien no técnico:
  - crear Supabase, Vercel y SMTP;
  - aplicar migraciones y configuración;
  - variables;
  - primera publicación;
  - comprobaciones;
  - qué hacer si el proyecto se pausa;
  - copias de seguridad;
  - cómo publicar una versión nueva;
  - qué datos se guardan y dónde.
- **`docs/ADMINISTRACION.md`**: las tareas de §5 con capturas descritas en texto.
- **README**: sección "Producción" con enlaces a las guías.

## 8. Qué haces tú y qué hago yo en 3e.2

| Paso | Quién |
|---|---|
| Crear cuentas: Supabase, Vercel, proveedor SMTP (y dominio, si lo hay) | Tú |
| `supabase login` / `supabase link` | Tú, con `! npx supabase login` en esta sesión. O yo, si me pasas el acceso de otra forma. **Nunca pegues tokens en el chat** |
| `db push --dry-run` y `config diff` | Yo. Te enseño la salida |
| `db push` y `config push` (cambian producción) | Yo, **solo tras tu "sí"** a cada uno |
| Conectar Vercel con GitHub y poner las variables | Tú, en el panel (te digo exactamente qué poner) |
| Crear el primer administrador, el equipo y los entrenadores | Tú, con las plantillas y la guía (yo te acompaño) |
| Prueba rápida contra la URL | Yo |
| Lista de comprobación en móviles | Tú (y yo reviso los resultados) |

## 9. Decisiones (cerradas)

| # | Decisión |
|---|---|
| D-E1 | SMTP: **Brevo** (no hay dominio propio). Credenciales solo en la terminal y en Supabase; nunca en el repositorio. Limitaciones de un remitente sin dominio, documentadas (Paso 5) |
| D-E2 | URL `*.vercel.app` (sin dominio propio); se podrá añadir un dominio después sin cambiar la arquitectura (guía, E8) |
| D-E3 | Comprobación automática de la URL publicada sin sesión ni escrituras + lista en móviles reales con un equipo de pruebas, que se hará en 3e.2 |
| D-E4 | Administración con plantillas SQL en el panel de Supabase; el entrenador pone su propia contraseña. Sin administración dentro de la PWA ni claves secretas |
| D-E5 | Región de la UE adecuada para España, elegida entre las que ofrezca Supabase al crear el proyecto (no se fija una concreta) |
| D-E6 | Previews **habilitadas** y aisladas: nunca leen ni escriben en producción. Sin staging, muestran "Falta configuración"; con staging (opcional, `deploy/staging.json`), solo ese proyecto. El build falla ante cualquier combinación peligrosa |
| D-E10 | El *project ref* y la URL pública de Supabase no son secretos y se versionan (`deploy/production.json`, `supabase/config.toml`) |
| D-E11 | La CSP de producción se restringe al proyecto real en cuanto exista (`npm run prod:csp`) y se repiten los E2E "como producción" |
| D-E7 | CI en GitHub Actions: typecheck, lint, unitarios y build en cada push a `main` y en cada PR, sin secretos |
| D-E8 | Script de copia manual (`npm run db:backup`), siempre fuera del repositorio, con procedimiento de restauración documentado |
| D-E9 | **Sí**: el servidor rechaza eventos con hora futura (§11) |

## 10. Riesgos

- **Correo en spam.** Con un remitente sin dominio verificado, parte de los correos puede acabar en spam. La guía indica cómo comprobarlo y qué decirles a los entrenadores.
- **CSP demasiado estricta.** Puede romper algo que solo se ve en producción. Por eso se prueba antes en local con las mismas cabeceras.
- **iPhone.** Safari limita el almacenamiento de las PWA no usadas durante semanas. Los datos pendientes se suben en cuanto hay conexión; la guía recomienda abrir la app con conexión después de cada partido.
- **Plan Free.** La pausa por inactividad y los límites de uso están aceptados (F3-1). Si se quedan cortos, se cambia a Pro sin tocar la app.

## 11. 3e.1 — Lo implementado

**Horas futuras (D-E9)** — migración `20260930090000_event_time_guard.sql`:
- El servidor rechaza con `EVENT_IN_FUTURE` un evento cuya hora supera en **más de 60 s** la hora del servidor al recibirlo. Lo hace en `append_match_events`, en `take_match_control` y con un trigger sobre `match_events` que protege incluso frente a la clave de servicio.
- **Por qué 60 s:**
  - un móvil con la corrección de reloj de 3d fecha los eventos con un error de ≤ 2,5 s (media ida y vuelta, que como máximo es de 5 s), y 60 s es más de 20 veces ese error;
  - los minutos se cuentan en minutos enteros;
  - sin conexión no afecta: los eventos ya han ocurrido cuando se suben.
- **En el móvil es un rechazo reintentable:** el evento queda pendiente y entra cuando su hora ha pasado; no va a cuarentena ni se pierde.
- **La tolerancia** está en `private.event_time_policy`. Solo la cambia la clave de servicio, con `set_event_time_policy`. Los E2E, que adelantan el reloj del navegador para simular minutos de partido, la amplían en el Supabase local solo mientras se ejecutan (`e2e/global-setup.ts` / `global-teardown.ts`). `test:db` usa la tolerancia real.

**Vercel:**
- `vercel.json`: rutas de la SPA (los `/assets` que faltan dan 404), caché y cabeceras (CSP estricta sin `unsafe-*`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` sin tocar la pantalla siempre encendida, `X-Frame-Options`, `COOP`).
- `scripts/check-build-env.mjs` + `deploy/production.json`: separación de entornos.
- `scripts/serve-dist.mjs`: sirve `dist` como Vercel.
- `scripts/check-deployment.mjs` (`npm run check:deploy`): comprueba una URL publicada sin iniciar sesión ni escribir.
- `playwright.prodlike.config.ts` (`npm run test:e2e:prodlike`): flujos críticos con la CSP de producción, comprobación de que no hubo violaciones y de que la CSP bloquea scripts inyectados.

**Supabase:**
- `supabase/remotes/production.toml.template` + `npm run prod:config`: bloque `[remotes.production]` con URLs, SMTP por variables de entorno y seed desactivado. No se deja en `config.toml` hasta 3e.2 porque la CLI exige el *project ref* real.
- `supabase/admin/`: plantillas SQL con marcadores `< >`.
- `npm run db:backup`: copia con `supabase db dump`.
- Las migraciones de 3a–3e.1 se aplican desde cero (`db reset`).

**CI:** `.github/workflows/ci.yml`.

**Documentación:** `docs/GUIA_PUESTA_EN_MARCHA.md` (Partes A–F) y sección "Producción" del README.

**Pendiente para 3e.2** (con cuentas reales y confirmación explícita en cada paso que cambie producción):
1. crear los proyectos (Supabase en la UE y Vercel);
2. `supabase link` y `db push`;
3. `npm run prod:config` y `config push`, con el SMTP;
4. variables de Vercel y `deploy/production.json`;
5. primera publicación;
6. `npm run check:deploy` contra la URL real;
7. primer equipo y entrenadores con las plantillas;
8. lista de la Parte D en móviles reales;
9. primera copia de seguridad.

## 12. Camino de 3e.2 preparado (sin tocar servicios remotos)

**Orden exacto** (`docs/GUIA_PUESTA_EN_MARCHA.md`, Parte C):
1. Supabase de producción;
2. repositorio + `db push --dry-run`;
3. migraciones + `00_comprobar_instalacion.sql`;
4. Auth;
5. Brevo SMTP;
6. correo de recuperación;
7. Vercel;
8. variables de Production;
9. variables de Preview aisladas;
10. primer despliegue;
11. `check:deploy`;
12. equipo `PRUEBAS…`;
13. entrenadores de prueba;
14. dos móviles;
15. borrar las pruebas (`09_…`);
16. equipo real;
17. entrenadores reales (cada uno pone su contraseña);
18. primera copia.

**Añadido para ese camino:**
- **`check-build-env`** (en `vercel.json` y, además, dentro de Vite):
  - ningún secreto en cualquier `VITE_*`, por valor o por nombre;
  - las previews solo pueden usar el staging declarado, o nada;
  - producción debe estar completa (`supabaseUrl`, `appUrl` y la URL de producción de Vercel coherente).
- **`deploy/staging.json`** (opcional) y **`npm run prod:csp`**: `connect-src` exacto a partir de `deploy/*.json`. Un test comprueba que `vercel.json` siempre es coherente con ellos.
- **`npm run check:deploy`**:
  - `--expect-supabase` en una URL real exige la CSP sin comodín;
  - `--forbid-supabase` comprueba que una preview no apunta a producción.
- **`npm run prod:config`**:
  - `--without-smtp` (Paso 4) y `--replace` (Paso 5);
  - `--remote staging --preview-redirect` (staging opcional).
- **Nuevas plantillas SQL:**
  - `00_comprobar_instalacion.sql`, verificado sobre una instalación simulada sin seed: 13/13 correcto, 0 equipos, 0 cuentas, nada DEMO;
  - `09_borrar_equipo_de_pruebas.sql`: solo equipos `PRUEBAS…`, desactiva y reactiva el trigger del historial en una sola transacción.
