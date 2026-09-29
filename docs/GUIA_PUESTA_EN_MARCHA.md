# Guía de puesta en marcha y administración

Para poner en marcha **Gestor de Minutos** en producción y administrarlo **sin depender de nadie**.
Los nombres de los botones de Supabase, Vercel y Brevo pueden cambiar con el tiempo. Si algo no
aparece exactamente así, busca la opción equivalente.

> **Regla de oro de seguridad**
> - En la app (variables `VITE_*`) y en Vercel solo van datos **públicos**: la URL de Supabase y
>   su clave **publicable** (`sb_publishable_…`, o la antigua *anon*).
> - **Nunca** van en el código, en Git, en Vercel, en variables `VITE_*`, en un chat ni en un
>   documento compartido:
>   - la clave **secreta** (`sb_secret_…`) o *service_role*;
>   - la contraseña de la base de datos;
>   - las credenciales SMTP de Brevo;
>   - los tokens de acceso.
>
>   Van a tu gestor de contraseñas. El build falla si detecta alguno en una variable `VITE_*`.
> - **Production y Preview están separadas.** Una preview de Vercel nunca lee ni escribe en el
>   Supabase de producción (el build lo impide).
> - Producción empieza **vacía**. Los datos DEMO (`supabase/seed.sql`) son solo para desarrollo
>   local y nunca llegan a producción.

Marcas usadas en la Parte C:

| Marca | Significado |
|---|---|
| ⚠️ **Cambia producción** | Paso que crea o modifica algo real (servicios, base de datos, usuarios, publicación). Hazlo solo cuando lo hayas revisado y decidido |
| 🔍 | Paso de comprobación, de solo lectura |

---

## Parte A — Qué hace falta

| Necesitas | Para qué | Coste |
|---|---|---|
| Cuenta de **GitHub** con acceso al repositorio | Código; Vercel publica desde aquí | Gratis |
| Cuenta de **Supabase** | Base de datos, cuentas de entrenadores, escudos | Plan Free |
| Cuenta de **Vercel** (entrando con la misma cuenta de GitHub) | Publicar la app con HTTPS en `https://<nombre>.vercel.app` | Plan Hobby (revisa sus condiciones de uso para un club) |
| Cuenta de **Brevo** | Enviar los correos de "¿Has olvidado la contraseña?" (SMTP) | Plan gratuito |
| Una **dirección de correo** para enviar (p. ej. la del club) | Remitente de esos correos | — |

- **Sin dominio propio.** Se empieza con `https://<nombre>.vercel.app`. Un dominio se puede añadir más adelante **sin cambiar la arquitectura** (Parte E8).
- **Correo integrado de Supabase:** no sirve en producción. Solo envía a los miembros del proyecto y muy pocos correos por hora.

**En tu ordenador:**
- Node.js 24 o superior.
- Una copia del repositorio.
- `npm ci` ejecutado una vez.
- Docker, para las pruebas locales.

Los comandos `npx supabase …` usan la CLI de Supabase que ya viene en el proyecto.

---

## Parte B — Entornos y variables

| Entorno | Base de datos | Dónde se configura |
|---|---|---|
| **Local** (desarrollo y tests) | Supabase **local** (Docker) con datos DEMO | `.env.local`, generado con `npm run env:local` |
| **Preview** (Vercel: ramas y pull requests) | **Ninguna** (la app muestra "Falta configuración" y no lee ni escribe nada) **o** un proyecto de **staging** aparte (Parte D) | Vercel → *Environment Variables* → **Preview** (y **Development**) |
| **Production** (Vercel: rama `main`) | Proyecto Supabase de **producción** | Vercel → *Environment Variables* → **Production** |

**Variables de la app (`VITE_*`, públicas: acaban dentro de la app):**

| Variable | Local | Preview | Production |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:54321` (lo pone `npm run env:local`) | **vacía**, o la URL de **staging** declarada en `deploy/staging.json` | `https://<ref-producción>.supabase.co` (la de `deploy/production.json`) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | la publicable local (lo pone `npm run env:local`) | vacía, o la publicable de staging | la publicable de producción |

- **La URL pública de la app no es una variable de la app.** La app usa su propia dirección.
  - Se declara en `deploy/production.json` (`appUrl`), junto con `supabaseUrl`. Son datos públicos y van versionados.
  - La usan la comprobación del build y la configuración de Auth de Supabase (Paso 4).
- **Vercel añade solo** `VERCEL`, `VERCEL_ENV` y `VERCEL_PROJECT_PRODUCTION_URL`, y la comprobación del build las usa.
  - Deja activada *Automatically expose System Environment Variables*.

**El build falla** (`scripts/check-build-env.mjs` en `vercel.json` y, otra vez, dentro de Vite) si:
- cualquier variable `VITE_*` contiene una clave secreta o *service_role*, o su nombre indica un secreto (`SECRET`, `SERVICE_ROLE`, `PASSWORD`, `TOKEN`, `SMTP`…);
- **Production** no tiene la URL y la clave, o no apunta **exactamente** al Supabase de `deploy/production.json`;
- **Production** tiene `deploy/production.json` incompleto (`supabaseUrl` o `appUrl`), o la URL de producción de Vercel no es `appUrl`;
- una **Preview** apunta al Supabase de producción, o a cualquier proyecto que no sea el staging declarado en `deploy/staging.json`;
- staging y producción son el mismo proyecto.

**Datos secretos y privados: nunca en `VITE_*`, en Vercel ni en ficheros del repositorio.**

| Dato | Dónde vive | Cuándo se usa |
|---|---|---|
| Contraseña de la base de datos | Gestor de contraseñas | `supabase link`, `db push`, copias. La CLI la pide, o se exporta como `SUPABASE_DB_PASSWORD` **solo en la terminal** |
| Token de la CLI (`supabase login`) | Lo guarda la CLI en tu ordenador | Comandos `npx supabase …` contra el proyecto |
| Credenciales SMTP de Brevo | Brevo (y, una vez aplicadas, Supabase) | Se exportan **solo en la terminal** para el Paso 5 (`SUPABASE_AUTH_SMTP_*`) |
| Clave secreta / *service_role* | Solo en el panel de Supabase | **No se usa** en ningún sitio de la app |

---

## Parte C — Puesta en marcha (3e.2), paso a paso y en este orden

Resumen:

| Paso | Qué | Marca |
|---|---|---|
| 1 | Crear Supabase de producción | ⚠️ |
| 2 | Configurar el repositorio y `supabase db push --dry-run` | 🔍 (+ commit local) |
| 3 | Aplicar las migraciones y comprobar la instalación | ⚠️ |
| 4 | Configurar Auth | ⚠️ |
| 5 | Configurar Brevo SMTP | ⚠️ |
| 6 | Comprobar el correo de recuperación | ⚠️ (cuenta temporal) |
| 7 | Crear el proyecto de Vercel | ⚠️ |
| 8 | Variables de **Production** | ⚠️ |
| 9 | Variables de **Preview**, aisladas | ⚠️ |
| 10 | Primer despliegue | ⚠️ |
| 11 | `npm run check:deploy` contra la URL real | 🔍 |
| 12 | Crear el equipo temporal de pruebas | ⚠️ |
| 13 | Crear los entrenadores de prueba | ⚠️ |
| 14 | Probar en dos móviles reales | ⚠️ (datos de prueba) |
| 15 | Borrar el equipo temporal y sus datos | ⚠️ |
| 16 | Crear el equipo real | ⚠️ |
| 17 | Crear los entrenadores reales | ⚠️ |
| 18 | Primera copia de seguridad | 🔍 (fuera del repositorio) |

### Paso 1 — Crear Supabase de producción ⚠️

1. En supabase.com → **New project**.
   - **Nombre**: por ejemplo `gestor-minutos`.
   - **Contraseña de la base de datos**: *Generate*. Guárdala **solo** en tu gestor de contraseñas.
2. **Región**: una región **de la Unión Europea** de las que ofrezca Supabase en ese momento (Europa occidental o central, la más cercana a España).
   - Así los datos quedan en la UE; importante si hay datos de menores (nombres de jugadores).
   - **No se puede cambiar después** sin migrar los datos a otro proyecto.
3. **Plan**: Free.
   - Si pasa una semana sin usarse, Supabase **pausa** el proyecto. Se reactiva desde el panel (Parte F).
   - Mientras está pausado, los móviles siguen funcionando y sincronizan al volver.
4. Anota tres datos. **Ninguno es secreto**:
   - **Project ref**: 20 letras. Está en la URL del panel o en *Project Settings → General*.
   - **URL**: `https://<project-ref>.supabase.co`.
   - **Clave publicable** (*Publishable key*, `sb_publishable_…`), en *Project Settings → API Keys*.
5. **Nombre del proyecto de Vercel.** Decide ahora cómo se llamará, porque de ahí sale la URL de la app: `https://<nombre>.vercel.app`.
   - Si el nombre ya está cogido, Vercel pondrá otra dirección. En el Paso 7 se comprueba y, si cambia, se corrigen `appUrl` y el Paso 4.

### Paso 2 — Configurar el repositorio y comprobar `supabase db push --dry-run` 🔍

En tu ordenador, en la carpeta del repositorio:

1. **Datos públicos de producción.** Edita `deploy/production.json`:

   ```json
   { "$comment": "…", "supabaseUrl": "https://<project-ref>.supabase.co", "appUrl": "https://<nombre>.vercel.app" }
   ```

2. **CSP restringida al proyecto real:**

   ```bash
   npm run prod:csp            # connect-src: 'self' https://<project-ref>.supabase.co (sin comodín)
   ```

   Revisa el cambio en `vercel.json`: solo debe cambiar `connect-src`.
3. **Configuración de Auth para el Paso 4** (sin correo todavía):

   ```bash
   npm run prod:config -- --project-ref <project-ref> --app-url https://<nombre>.vercel.app --without-smtp
   ```

   Esto añade a `supabase/config.toml` un bloque `[remotes.production]` con:
   - la URL de la app;
   - las URL de recuperación de contraseña;
   - el seed desactivado.
4. **Comprueba que todo sigue bien en local:**

   ```bash
   npm test && npm run typecheck && npm run lint
   npm run test:e2e:prodlike      # con la CSP ya restringida
   ```

   Haz commit de `deploy/production.json`, `vercel.json` y `supabase/config.toml`. **No hagas push todavía**: el push publica (Paso 10).
5. **Enlaza el proyecto y mira qué se aplicaría, sin aplicar nada:**

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>     # pide la contraseña de la base de datos
   npx supabase db push --dry-run
   ```

   Deben salir **exactamente** estas migraciones, en este orden:
   1. `20260929072452_core_teams_and_membership.sql`
   2. `20260929072454_team_data.sql`
   3. `20260929072456_match_events_and_control.sql`
   4. `20260929072458_crest_storage.sql`
   5. `20260930080000_take_control_and_download.sql`
   6. `20260930090000_event_time_guard.sql`

   Si sale otra cosa, o no sale ninguna, **para** y revisa antes de seguir.

### Paso 3 — Aplicar las migraciones ⚠️

Solo después de revisar el Paso 2:

```bash
npx supabase db push          # aplica supabase/migrations. NO aplica seed.sql (nada de datos DEMO)
```

- **Nunca** uses `--include-seed` en producción.
- Después, en el panel → **SQL Editor**, ejecuta `supabase/admin/00_comprobar_instalacion.sql`. Las 13 filas deben tener `ok = true`:
  - RLS activo en todas las tablas;
  - funciones críticas solo para usuarios con sesión;
  - la validación interna, inaccesible;
  - historial inmutable;
  - tolerancia de hora de 60 s;
  - bucket de escudos privado;
  - **0 equipos y 0 cuentas; nada DEMO**.
- Además, en **Advisors → Security Advisor** no debe haber avisos de nivel *Error*.
  - Puede avisar de funciones `security definer` en `public` (`append_match_events`, `take_match_control`…). Es intencionado: son la única puerta de entrada de los eventos y validan la pertenencia al equipo.

### Paso 4 — Configurar Auth ⚠️

```bash
npx supabase config diff --project-ref <project-ref>    # REVISA el diff (ver abajo)
npx supabase config push --project-ref <project-ref>    # pide confirmación por cada cambio
```

**Qué debe salir en el diff:**
- *Site URL* y *Redirect URLs* con la URL de la app, y **ninguna** con `localhost` o `127.0.0.1`;
- registro desactivado;
- contraseña de 8 caracteres como mínimo;
- la plantilla de recuperación en español.

**Si propone otros cambios, léelos antes de aceptar.** `config push` aplica también los valores base de `config.toml` que difieran del proyecto.

**Límite de correos por hora.** El valor base local es 2/hora; en producción se sube a 30 con el SMTP (Paso 5). Supabase solo deja cambiarlo con SMTP propio. Si el `push` de este paso falla por ese motivo, no pasa nada: rechaza ese cambio y haz los Pasos 4 y 5 en un único `config push` (ya con el SMTP).

Comprueba en el panel:
- **Authentication → Sign In / Providers**:
  - *Allow new users to sign up* **desactivado**;
  - acceso por email activado;
  - *Confirm email* como en local;
  - contraseña de 8 caracteres como mínimo.
- **Authentication → URL Configuration**:
  - *Site URL* = `https://<nombre>.vercel.app`;
  - *Redirect URLs* = `https://<nombre>.vercel.app/**`, y **nada más**: ninguna preview ni localhost.
- **Authentication → Emails → Reset password**: la plantilla en español (asunto "Restablecer contraseña · Gestor de Minutos"). Si no está, copia `supabase/templates/recovery.html`.

### Paso 5 — Configurar Brevo SMTP ⚠️

**En Brevo:**
1. Crea la cuenta (plan gratuito). Brevo puede pedir validar la cuenta o activar el envío transaccional o SMTP antes de dejarte enviar.
2. **Remitente**: en *Senders, Domains & Dedicated IPs → Senders* (o equivalente), añade la dirección desde la que saldrán los correos, p. ej. la del club. Verifícala con el código que Brevo envía a esa dirección.
3. **Credenciales SMTP**: en *SMTP & API → SMTP* verás el **servidor SMTP**, el **puerto** y el **usuario (login)**, y podrás **generar una clave SMTP**.
   - La clave es la contraseña SMTP. Guárdala en tu gestor; Brevo no vuelve a enseñarla.

**Datos que hacen falta** (cópialos del panel de Brevo; no los inventes):

| Dato | Dónde se ve en Brevo | Se pone en | ¿Secreto? |
|---|---|---|---|
| Servidor SMTP (host) | SMTP & API → SMTP | `SUPABASE_AUTH_SMTP_HOST` | No |
| Puerto | SMTP & API → SMTP | `port` del bloque generado (la plantilla trae 587, el puerto con STARTTLS; si Brevo indica otro, cámbialo en `supabase/config.toml`) | No |
| Usuario SMTP (login) | SMTP & API → SMTP | `SUPABASE_AUTH_SMTP_USER` | Privado |
| Contraseña SMTP (clave SMTP generada) | SMTP & API → SMTP → *Generate a new SMTP key* | `SUPABASE_AUTH_SMTP_PASS` | **Sí** |
| Dirección del remitente (verificada) | Senders | `SUPABASE_AUTH_SMTP_ADMIN_EMAIL` | No |
| Nombre del remitente | — | `sender_name = "Gestor de Minutos"` (ya en la plantilla) | No |

**Aplicarlo** (los datos de Brevo solo en la terminal, **nunca** en ficheros):

```bash
npm run prod:config -- --project-ref <project-ref> --app-url https://<nombre>.vercel.app --replace
export SUPABASE_AUTH_SMTP_HOST='<servidor SMTP de Brevo>'
export SUPABASE_AUTH_SMTP_USER='<usuario SMTP de Brevo>'
export SUPABASE_AUTH_SMTP_PASS='<clave SMTP de Brevo>'
export SUPABASE_AUTH_SMTP_ADMIN_EMAIL='<remitente verificado>'
npx supabase config diff --project-ref <project-ref>    # REVISA: SMTP y límite de 30 correos/hora
npx supabase config push --project-ref <project-ref>
unset SUPABASE_AUTH_SMTP_HOST SUPABASE_AUTH_SMTP_USER SUPABASE_AUTH_SMTP_PASS SUPABASE_AUTH_SMTP_ADMIN_EMAIL
```

Haz commit del nuevo `supabase/config.toml`. Solo contiene `env(...)`, ningún valor de Brevo.

**Limitación sin dominio propio:**
- **La dirección del remitente.** Será una dirección de un proveedor gratuito o del club (Gmail, Outlook…), verificada en Brevo.
- **Dominios con políticas antifraude (DMARC).** Gmail, Outlook, Yahoo… publican políticas que exigen que el correo salga de sus propios servidores. Un correo "de" `@gmail.com` enviado por Brevo **puede acabar en spam, ser rechazado o salir con el remitente cambiado por Brevo**.
- **Revisa los avisos del panel.** Brevo informa en *Senders* si el remitente está sujeto a esas limitaciones.
- **Límite diario del plan gratuito.** Consúltalo en Brevo. Para recuperar contraseñas sobra.
- **Por eso el Paso 6 es obligatorio.** Si la entrega no es fiable, la solución es un **dominio propio** autenticado en Brevo (SPF, DKIM y DMARC), sin cambiar nada de la app (Parte E8).

### Paso 6 — Comprobar el correo de recuperación ⚠️ (crea una cuenta temporal)

1. **Authentication → Users → Add user → Create new user**:
   - **tu propio email** (o un alias, p. ej. `tunombre+prueba@…`);
   - **Auto Confirm User**;
   - contraseña aleatoria que **no guardes**.
2. En ese usuario → **Send password recovery** (o, cuando la app ya esté publicada, "¿Has olvidado la contraseña?" en la app).
3. Comprueba:
   - el correo **llega**;
   - el asunto es "Restablecer contraseña · Gestor de Minutos";
   - el remitente es el de Brevo;
   - el enlace apunta a `https://<nombre>.vercel.app/restablecer…`;
   - en qué carpeta aparece: entrada o spam. Prueba con Gmail y con Outlook si puedes.
4. **El flujo completo** (abrir el enlace, poner la contraseña, entrar) se prueba en el Paso 13, cuando la app ya esté publicada.
5. Esta cuenta temporal se borra en el Paso 15.

### Paso 7 — Crear el proyecto de Vercel ⚠️

1. vercel.com → *Add New… → Project* → importa el repositorio de GitHub, con el **nombre** decidido en el Paso 1.
2. **No cambies** *Build & Output Settings*: Vercel lee `vercel.json`, con las rutas de la app, la caché, las cabeceras de seguridad y la comprobación de variables.
3. **El primer despliegue automático fallará**, y es lo esperado: todavía no hay variables de producción y la comprobación del build lo impide. **No se publica nada.**
4. **Comprueba la dirección de producción** (*Settings → Domains*). Debe ser exactamente `appUrl` de `deploy/production.json`. Si Vercel asignó otra:
   1. corrige `appUrl`;
   2. repite el Paso 4 (`prod:config … --replace` con la URL nueva y las variables SMTP exportadas, `config diff`, `config push`);
   3. haz commit.

### Paso 8 — Variables de Production ⚠️

*Settings → Environment Variables* → marca **solo** el entorno **Production**:

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | la clave publicable (`sb_publishable_…`) |

- **Nunca** la clave secreta. El build falla si la detecta.
- **No** marques *Preview* ni *Development* en estas variables.

### Paso 9 — Variables de Preview, aisladas ⚠️

- **Ahora (sin staging):** en *Preview* y *Development*, **ninguna** variable de Supabase.
  - Las previews se publican, pero muestran "Falta configuración": sirven para revisar la interfaz y no leen ni escriben datos.
  - Comprueba en la lista de variables que ninguna de producción tiene marcado *Preview*.
- **Más adelante (con staging):** las del proyecto de staging, **solo** en *Preview*. Ver Parte D.
- **Garantías:**
  - Si alguien pone por error la URL de producción en *Preview*, el build de la preview **falla**.
  - Aunque se saltase esa comprobación, el Supabase de producción no aceptaría las direcciones de las previews como URL de recuperación (Paso 4).

### Paso 10 — Primer despliegue ⚠️

1. Haz **push a `main`** con los commits de los Pasos 2, 5 y 7, o pulsa *Redeploy* en Vercel.
2. En el log del build debe aparecer: `✓ Variables de entorno correctas para Vercel (production).`
3. La app queda en `https://<nombre>.vercel.app`.
4. **Versiones nuevas:** cada push a `main` publica una. Los móviles la ven con un aviso y la instalan cuando el entrenador quiere, **nunca en mitad de un partido**.

### Paso 11 — `npm run check:deploy` contra la URL real 🔍

Desde tu ordenador (solo lectura: no inicia sesión ni escribe nada):

```bash
npm run check:deploy -- https://<nombre>.vercel.app --expect-supabase https://<project-ref>.supabase.co
```

Todo debe salir con ✓:
- HTTPS y redirección desde `http://`;
- cabeceras de seguridad y **CSP restringida a ese proyecto**;
- service worker y manifest instalable;
- ruta `/restablecer`;
- código sin claves secretas;
- apunta al Supabase de producción.

**Previews:** abre una (cualquier rama o PR) y comprueba que **no** apunta a producción:

```bash
npm run check:deploy -- https://<url-de-la-preview> --forbid-supabase https://<project-ref>.supabase.co
```

Si la preview está protegida por Vercel (*Deployment Protection*), compruébalo abriéndola en el navegador: debe mostrar "Falta configuración".

### Paso 12 — Crear el equipo temporal de pruebas ⚠️

En el panel → **SQL Editor**, ejecuta `supabase/admin/01_crear_equipo_y_temporada.sql` con un nombre que **empiece por `PRUEBAS`**, p. ej. `PRUEBAS puesta en marcha`.
- Solo los equipos con ese prefijo se pueden borrar con el script del Paso 15.
- Apunta el **id del equipo**.

### Paso 13 — Crear los entrenadores de prueba ⚠️

Para dos cuentas de prueba (tu email y otro, o alias `+prueba1`, `+prueba2` si tu proveedor los admite):

1. **Authentication → Users → Add user → Create new user**: email, **Auto Confirm User** y contraseña aleatoria que **no guardes**.
2. `supabase/admin/04_anadir_entrenador_al_equipo.sql`: id del equipo de pruebas, rol (`admin` o `coach`) y nombre visible.
3. En el móvil, abre la app → **¿Has olvidado la contraseña?** → llega el correo → el enlace abre la app → contraseña nueva → entra. Es la **prueba completa de recuperación**.

### Paso 14 — Probar en dos móviles reales ⚠️ (datos de prueba)

Uno Android (Chrome) y otro iPhone (Safari), cada uno con una cuenta del Paso 13:

| ✓ | Paso |
|---|---|
| ☐ | **Instalar** la app (Android: *Instalar app*; iPhone: *Compartir → Añadir a pantalla de inicio*) |
| ☐ | Entrar: se ven el entrenador, el **equipo** y la temporada correcta |
| ☐ | **JUGADORES**: añadir jugadores con dorsal |
| ☐ | **NUEVO PARTIDO** con rival, fecha, hora y **escudo** (probar la cámara del móvil) |
| ☐ | **Convocatoria** y **alineación**; confirmar |
| ☐ | **▶ COMENZAR**: el reloj corre y la pantalla no se apaga |
| ☐ | Hacer una **sustitución** |
| ☐ | Final de la 1ª parte (automático); configurar y empezar la **2ª parte** |
| ☐ | Otra sustitución; final del partido |
| ☐ | **Resultado**, observaciones y **GUARDAR PARTIDO** |
| ☐ | En el **segundo móvil**: ver el partido y los minutos descargados |
| ☐ | Partido nuevo en juego en el móvil A; el móvil B lo abre en **modo consulta** y se actualiza solo en ≤ 5 s |
| ☐ | B pulsa **TOMAR CONTROL**; A ve "OTRO DISPOSITIVO HA TOMADO EL CONTROL" |
| ☐ | A: **ENTENDIDO** → modo consulta; A vuelve a **TOMAR CONTROL**; B ve que lo ha perdido |
| ☐ | **Sin conexión** (modo avión) en mitad del partido: la app sigue; al volver la conexión, sincroniza ("✓ Sincronizado") |
| ☐ | Cerrar la app y abrirla **sin conexión**: abre y continúa el partido |
| ☐ | Lo hecho en un móvil aparece en el otro en ≤ 15 s |
| ☐ | Publicar un cambio (push a `main`): aparece el aviso de versión nueva, y **no** durante el partido |

### Paso 15 — Borrar el equipo temporal y sus datos ⚠️

1. `supabase/admin/09_borrar_equipo_de_pruebas.sql` con el id del equipo de pruebas.
   - Borra partidos, eventos, jugadores, temporadas, convocatorias, informes, minutos y errores técnicos del equipo.
   - **Solo** funciona con equipos cuyo nombre empieza por `PRUEBAS`.
   - Al terminar, el historial del resto queda protegido otra vez (la consulta final debe mostrar `true`).
2. **Storage → crests**: borra la carpeta con el id del equipo de pruebas (escudos de prueba).
3. **Authentication → Users**: borra las cuentas de prueba de los Pasos 6 y 13.
4. `supabase/admin/07_consultar_equipos_y_temporadas.sql` y `03_consultar_usuarios.sql`: no debe quedar nada de pruebas.

### Paso 16 — Crear el equipo real ⚠️

`supabase/admin/01_crear_equipo_y_temporada.sql` con el nombre real (**sin** `PRUEBAS`) y la temporada. Apunta el id.

### Paso 17 — Crear los entrenadores reales ⚠️

El **administrador nunca conoce las contraseñas**. Tú también sigues este flujo para tu propia cuenta. Para cada entrenador:

1. **Authentication → Users → Add user → Create new user**: su email, **Auto Confirm User** y una contraseña **aleatoria que no guardes** (el botón de generar, o `openssl rand -base64 24`).
2. `supabase/admin/04_anadir_entrenador_al_equipo.sql`: id del equipo, rol (`admin` para quien administre y `coach` para el resto) y nombre visible.
3. Dile al entrenador que:
   1. abra `https://<nombre>.vercel.app` en su móvil e instale la app;
   2. pulse **¿Has olvidado la contraseña?** con su email;
   3. siga el enlace del correo (que mire en spam) y ponga **su** contraseña.
4. Comprueba con `06_consultar_miembros.sql`.

### Paso 18 — Primera copia de seguridad 🔍

```bash
npm run db:backup -- --linked
```

Sigue la Parte E4.

---

## Parte D — (Opcional) Staging para previews completas

Las previews no necesitan base de datos para revisar la interfaz. Si más adelante quieres probar en previews el acceso, la sincronización o TOMAR CONTROL, hace falta un proyecto de Supabase **aparte**. **Nunca** se usa producción para esto.

1. Crea un segundo proyecto de Supabase (p. ej. `gestor-minutos-staging`) y repite los Pasos 1–3 con él.
   - Puede quedar **vacío** o con datos inventados de prueba. **Nunca** copies datos reales de producción.
2. `deploy/staging.json` → `"supabaseUrl": "https://<ref-staging>.supabase.co"`, y `npm run prod:csp`.
   - La CSP de todas las publicaciones permitirá también ese origen: son los dos proyectos del club.
3. Configuración de Auth de staging, con el patrón de las URLs de preview de Vercel:

   ```bash
   npm run prod:config -- --remote staging --project-ref <ref-staging> --app-url https://<nombre>.vercel.app \
     --preview-redirect 'https://<nombre>-*.vercel.app/**' --without-smtp
   npx supabase config diff --project-ref <ref-staging>
   npx supabase config push --project-ref <ref-staging>
   ```

4. En Vercel, **solo en Preview**: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` de **staging**.
   - El build de las previews comprueba que es exactamente el staging declarado.
5. Cuentas y equipo de staging, con las plantillas de `supabase/admin/` en el SQL Editor **del proyecto de staging**.

---

## Parte E — Administración habitual

Todas las plantillas están en `supabase/admin/` (ver su `README.md`) y se ejecutan en el **SQL Editor** del proyecto.

### E1. Añadir un entrenador

Paso 17. Si el entrenador ya tiene cuenta (de otro equipo), basta con `04_…`.

### E2. Quitar un entrenador

- `05_retirar_entrenador_del_equipo.sql`.
  - Deja de ver el equipo.
  - Si tiene la app abierta, se le cierra la sesión al recuperar la conexión; si está en mitad de un partido, al terminarlo.
  - Sus partidos se conservan.
  - No se puede retirar al último administrador.
- **Borrar la cuenta** (*Authentication → Users*): solo si no tiene partidos registrados. El historial guarda quién hizo cada cosa, y la base de datos lo impide.

### E3. Nueva temporada

`02_nueva_temporada_y_activar.sql`.
- Las temporadas anteriores se conservan.
- Los móviles pasan a la nueva al abrir la app con conexión.

### E4. Copias de seguridad

```bash
npx supabase link --project-ref <project-ref>   # si no está enlazado
npm run db:backup -- --linked                   # pide la contraseña de la base de datos
```

- **Qué hace:**
  - crea una carpeta **fuera del repositorio** (por defecto `~/copias-gestor-minutos/linked-<fecha>`) con `roles.sql`, `schema.sql` y `data.sql`;
  - añade `SHA256SUMS`;
  - se niega a guardar dentro del repositorio.
- **Comprobar que existe y está bien:**

  ```bash
  ls -l ~/copias-gestor-minutos/<carpeta>
  (cd ~/copias-gestor-minutos/<carpeta> && sha256sum -c SHA256SUMS)
  ```

- **Dónde guardarla:** en un disco o carpeta **privada y cifrada**. Contiene datos personales y los datos de acceso cifrados (hashes) de las cuentas.
- **Qué NO hacer:** **nunca** en Git, en una carpeta compartida ni en el chat. `.gitignore` bloquea además `copias*/`, `backups/` y `*.dump`.
- **Cuándo:** una vez al mes, al terminar cada temporada y **antes** de aplicar migraciones nuevas.
- **Escudos:** están en Storage, **no** en esta copia. Descárgalos desde *Storage → crests* si quieres conservarlos; si se perdieran, se vuelven a poner en cada partido.
- **Restaurar.** Depende de Supabase y de PostgreSQL (`psql`); sigue la documentación actual de Supabase ("Backup and restore using the CLI"). En resumen:
  1. Crea un proyecto **nuevo y vacío**. **No** apliques migraciones: `schema.sql` ya trae el esquema.
  2. En *Project Settings → Database*, copia la cadena de conexión y ejecuta:

     ```bash
     psql --single-transaction --variable ON_ERROR_STOP=1 \
       --file roles.sql --file schema.sql \
       --command 'SET session_replication_role = replica' \
       --file data.sql --dbname '<cadena de conexión del proyecto nuevo>'
     ```

  3. Repite los Pasos 2 (datos públicos del proyecto nuevo, CSP), 4, 5, 8, 10 y 11 con el proyecto nuevo.

### E5. Comprobar errores

- `08_consultar_errores_tecnicos.sql`: los errores técnicos que envían los móviles (la app nunca se los enseña al entrenador).
- También: *Logs* del panel de Supabase y *Deployments → Logs* en Vercel.

### E6. Recuperación de contraseña

La hace el propio entrenador desde la app ("¿Has olvidado la contraseña?"). El administrador no necesita (ni debe) conocer contraseñas. Si el correo no llega, ver la Parte F.

### E7. Qué datos se guardan y dónde

**En Supabase** (región UE del Paso 1):
- cuentas (email y nombre visible);
- equipos y temporadas;
- jugadores (nombre y dorsal);
- partidos, alineaciones, cambios y minutos;
- informes;
- escudos;
- errores técnicos.

**En cada móvil**, la copia local para trabajar sin conexión.

**Vercel** solo sirve la app. **Brevo** solo envía los correos de recuperación.

### E8. Añadir más adelante un dominio propio (sin cambiar la arquitectura)

1. Vercel → *Settings → Domains* → añadir el dominio (DNS según Vercel).
2. `deploy/production.json` → `appUrl` con el dominio nuevo.
   - Si no lo cambias, el build de producción **falla** avisándote.
3. `npm run prod:config -- … --app-url https://<dominio> --replace` (con las variables SMTP exportadas) → `config diff` → `config push`.
4. En Brevo, autentica el dominio (SPF, DKIM y DMARC) y usa un remitente `@<dominio>`, para mejorar la entrega. Repite el Paso 5 con el remitente nuevo.
5. Commit, push y `npm run check:deploy -- https://<dominio> --expect-supabase …`.

---

## Parte F — Problemas habituales

| Problema | Qué hacer |
|---|---|
| **No llega el correo de recuperación** | Mirar spam. En Supabase: *Authentication → Emails → SMTP Settings* activo y con los datos de Brevo, y *Logs → Auth* para ver el error. En Brevo: remitente verificado, cuenta activa para SMTP, límite diario y registro de envíos (*Transactional → Logs*). Sin dominio propio, el remitente gratuito puede provocar spam o rechazo (Paso 5): la solución definitiva es un dominio (E8). Pedir otro correo pasado un minuto (hay límite por hora). La *Redirect URL* debe ser la de la app (Paso 4) |
| **No sincroniza** ("cambios pendientes" o "No se ha podido sincronizar") | Comprobar la conexión. Si el proyecto de Supabase está **pausado**, reactivarlo (*Restore project*): los datos siguen en el móvil y se suben solos. Revisar `08_…`. Si el reloj del móvil está muy adelantado, los eventos esperan a que su hora pase (no se pierden): poner la hora automática en el móvil |
| **"Controlado por otro dispositivo"** | Es normal: otro entrenador (u otro móvil) lleva el partido. Se puede consultar en directo o pulsar **TOMAR CONTROL** (necesita conexión). El otro móvil verá que ha perdido el control |
| **"OTRO DISPOSITIVO HA TOMADO EL CONTROL"** con cambios no aplicados | Se hicieron sin conexión mientras otro móvil llevaba el partido: no cuentan, pero se conservan en la ficha (CAMBIOS NO APLICADOS). Si hay que repetir alguno, lo hace quien controla el partido |
| **Se pierde la conexión en un partido** | No hay que hacer nada: la app guarda todo en el móvil y lo sube al volver la conexión |
| **Se pierde la sesión** ("Tu sesión ha caducado") | En mitad de un partido la app no echa al entrenador: termina el partido y luego vuelve a iniciar sesión. Los datos no se borran al cerrar sesión |
| **Vercel devuelve error o la página no carga** | *Deployments*: ver el último build. Si falla en la comprobación de variables, el mensaje dice cuál (preview contra producción, clave secreta, `deploy/production.json` incompleto…). Volver a una versión anterior: *Promote to Production*. Después, `npm run check:deploy -- <url>` |
| **Una preview muestra "Falta configuración"** | Es lo esperado sin staging (Paso 9): las previews no usan la base de datos de producción |
| **Supabase devuelve error** | *Project Status* y *Logs*. Si una migración nueva falló, **no** tocar tablas a mano: revisar `db push --dry-run` y, si hace falta, restaurar la copia (E4) |
| **Un entrenador no ve su equipo** | `06_consultar_miembros.sql`: debe aparecer. Si no, `04_…` |
