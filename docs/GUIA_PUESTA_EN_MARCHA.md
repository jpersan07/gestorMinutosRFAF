# Guía de puesta en marcha y administración

Para poner en marcha **Gestor de Minutos** en producción y administrarlo **sin depender de nadie**.
Los nombres de los botones de Supabase y Vercel pueden cambiar con el tiempo. Si algo no aparece
exactamente así, busca la opción equivalente.

> **Regla de oro de seguridad**
> - En la app y en Vercel solo va la clave **publicable** de Supabase (`sb_publishable_…`, o la
>   antigua *anon*). La clave **secreta** (`sb_secret_…` / *service_role*), la contraseña de la
>   base de datos, las del correo (SMTP) y los tokens de acceso **nunca** se pegan en el código,
>   en Git, en Vercel, en un chat ni en un documento compartido. Van a tu gestor de contraseñas.
> - Los datos DEMO (`supabase/seed.sql`) son solo para desarrollo local y **nunca** llegan a
>   producción.

---

## Parte A — Qué hace falta

| Necesitas | Para qué | Coste |
|---|---|---|
| Cuenta de **GitHub** con acceso al repositorio | Código; Vercel publica desde aquí | Gratis |
| Cuenta de **Supabase** | Base de datos, cuentas de entrenadores, escudos | Plan Free |
| Cuenta de **Vercel** (entrando con la misma cuenta de GitHub) | Publicar la app con HTTPS | Plan Hobby |
| **Proveedor de correo (SMTP)** | Correos de "¿Has olvidado la contraseña?" | Plan gratuito |
| (Opcional) **Dominio propio** | Dirección tipo `minutos.tuclub.es`; mejor entrega de correos | De pago |

**Proveedor de correo:**
- **Sin dominio propio** → **Brevo**. Permite verificar una dirección de remitente sin tener dominio.
- **Con dominio propio** → **Resend** (o Brevo con el dominio verificado): los correos llegan mejor.

El correo que trae Supabase de serie **no sirve** en producción: solo envía a los miembros del
proyecto y muy pocos correos por hora.

**En tu ordenador:**
- Node.js 24 o superior.
- Una copia del repositorio.
- `npm ci` ejecutado una vez.

Los comandos `npx supabase …` usan la CLI de Supabase que ya viene en el proyecto.

**Entornos:**

| Entorno | Base de datos | Dónde |
|---|---|---|
| Desarrollo / tests | Supabase **local** (Docker) con datos DEMO | Tu ordenador (`npm run db:start`) |
| **Producción** | Proyecto Supabase de producción | Vercel → *Production* (rama `main`) |
| Preview (opcional) | **Nunca** la de producción: sin base de datos, o un proyecto de *staging* aparte | Vercel → *Preview* |

---

## Parte B — Supabase de producción

### B1. Crear el proyecto

1. En supabase.com → **New project**.
2. **Nombre**: por ejemplo `gestor-minutos`.
3. **Contraseña de la base de datos**: pulsa *Generate* y guárdala **solo** en tu gestor de contraseñas.
4. **Región**: elige una región **de la Unión Europea** de las que ofrezca Supabase en ese momento (Europa occidental o central), la más cercana a España.
   - Así los datos quedan en la UE. Es importante si hay datos de menores (nombres de jugadores).
   - Informa al club de qué datos se guardan (Parte E7).
5. **Plan**: Free.
   - Si el proyecto pasa una semana sin usarse, Supabase lo **pausa**. Se reactiva desde el panel (Parte F).
   - Mientras está pausado, la app sigue funcionando en los móviles y sincroniza al volver.

### B2. Datos públicos del proyecto

En **Project Settings → API** (o *Data API* / *API Keys*):

- **Project URL**: `https://<project-ref>.supabase.co`. El *project ref* son 20 letras.
- **Clave publicable** (*Publishable key*, `sb_publishable_…`), o la *anon* en proyectos antiguos.

Ninguno de los dos es secreto (van dentro de la app), pero no hace falta pegarlos en ningún chat.

### B3. Aplicar las migraciones (esquema, seguridad RLS, reglas del partido)

En tu ordenador, en la carpeta del repositorio:

```bash
npx supabase login                          # abre el navegador para autorizar la CLI
npx supabase link --project-ref <project-ref>   # pide la contraseña de la base de datos
npx supabase db push --dry-run              # REVISA la lista: deben salir todas las migraciones de supabase/migrations
npx supabase db push                        # aplica las migraciones (no aplica seed.sql: nada de datos DEMO)
```

- `db push` **no** ejecuta `seed.sql` salvo que se le pida expresamente con `--include-seed`. **Nunca uses `--include-seed` en producción.**
- Las migraciones crean también el bucket privado de escudos (`crests`), la tolerancia de horas del servidor y todas las políticas RLS.

### B4. Configurar el acceso (Auth), las URLs y el correo

1. **Genera la configuración de producción**. `<app>` es la dirección que te dará Vercel en la Parte C; si aún no la tienes, haz primero la C1–C4 y vuelve aquí:

   ```bash
   npm run prod:config -- --project-ref <project-ref> --app-url https://<app>.vercel.app
   ```

   Esto añade a `supabase/config.toml` un bloque `[remotes.production]` con:
   - la URL de la app (*Site URL*);
   - la dirección de recuperación de contraseña (`https://<app>.vercel.app/**`);
   - el límite de correos por hora;
   - el servidor de correo.

   Nada de eso es secreto. Haz commit de ese cambio.

2. **Prepara el proveedor de correo:**
   - **Brevo**: verifica la dirección de remitente. En *SMTP & API* verás el servidor (`smtp-relay.brevo.com`, puerto 587), el usuario y una clave SMTP.
   - **Resend**: verifica tu dominio (registros DNS) y crea una API key. El servidor es `smtp.resend.com`, puerto 587, usuario `resend` y contraseña la API key.

3. **Aplica la configuración**. Los datos del correo solo se ponen en la terminal, nunca en ficheros:

   ```bash
   export SUPABASE_AUTH_SMTP_HOST='<servidor SMTP>'
   export SUPABASE_AUTH_SMTP_USER='<usuario SMTP>'
   export SUPABASE_AUTH_SMTP_PASS='<contraseña o clave SMTP>'      # secreto
   export SUPABASE_AUTH_SMTP_ADMIN_EMAIL='<remitente verificado>'
   npx supabase config diff      # REVISA: solo deben cambiar URLs, límite de correos y SMTP
   npx supabase config push      # pide confirmación por cada cambio
   ```

   Si prefieres el panel, lo mismo está en:
   - **Authentication → URL Configuration**: *Site URL* y *Redirect URLs*;
   - **Authentication → Emails → SMTP Settings**.

4. **Comprueba en el panel:**
   - **Authentication → Sign In / Providers**:
     - registro de usuarios **desactivado** (*Allow new users to sign up* apagado);
     - acceso por email activado;
     - contraseña de 8 caracteres como mínimo.
   - **Authentication → Emails → Reset password**: la plantilla en español (asunto "Restablecer contraseña · Gestor de Minutos"). Si no está, copia el contenido de `supabase/templates/recovery.html`.

### B5. Comprobar la seguridad (RLS)

- **Table Editor**: todas las tablas de `public` muestran **RLS enabled**.
- **Advisors → Security Advisor**: no debe haber avisos de nivel *Error*.
- La app nunca usa la clave secreta. Cada entrenador solo ve los equipos de los que es miembro (probado en `npm run test:db`).

### B6. Primer equipo y entrenadores

Se hace con las plantillas de `supabase/admin/` en **SQL Editor** (instrucciones dentro de cada fichero):

1. `01_crear_equipo_y_temporada.sql` → apunta el **id del equipo**.
2. Por cada entrenador:
   1. **Authentication → Users → Add user → Create new user**:
      - su email;
      - marca **Auto Confirm User**;
      - en la contraseña, una **aleatoria que no guardes** (el botón de generar, o `openssl rand -base64 24`).
   2. Después, `04_anadir_entrenador_al_equipo.sql`, con el rol (`admin` o `coach`) y el nombre visible.
   3. Dile al entrenador que abra la app → **¿Has olvidado la contraseña?** → pone **su** contraseña desde el correo. Tú nunca la conoces.
3. Comprueba con `06_consultar_miembros.sql`.

---

## Parte C — Vercel

1. **Importar el repositorio.** En vercel.com → *Add New… → Project* → importa el repositorio de GitHub.
2. **Framework y build.** Vercel lee `vercel.json`:
   - framework Vite;
   - instalación `npm ci`;
   - build `node scripts/check-build-env.mjs && npm run build`;
   - salida `dist`;
   - rutas de la app, caché y cabeceras de seguridad.

   No cambies nada en *Build & Output Settings*.
3. **Variables de entorno** (*Settings → Environment Variables*), **solo** en el entorno **Production**:

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | la clave publicable (`sb_publishable_…`) |

   **Nunca** pongas la clave secreta. El build lo comprueba y falla si la detecta.
4. **Declara la producción en el repositorio.**
   - Rellena `deploy/production.json` con los datos **públicos**:
     - `supabaseUrl`: `https://<project-ref>.supabase.co`;
     - `appUrl`: `https://<app>.vercel.app`.
   - Haz commit y push.
   - A partir de ahí, el build de Vercel:
     - **falla** si *Production* no apunta a ese Supabase;
     - **falla** si una *Preview* apunta a él.
5. **Production y Preview:**
   - **Production**: cada push a `main` publica una versión nueva. Los móviles la ven con un aviso y la instalan cuando el entrenador quiere, **nunca en mitad de un partido**.
   - **Preview**: cada rama o pull request genera una dirección de prueba.
     - **No** configures las variables de Preview con la base de datos de producción (el build lo impide).
     - Sin variables, la preview muestra "Falta configuración": sirve para ver la interfaz, no escribe en ningún sitio.
     - Para probar de verdad en previews: crea un **segundo proyecto de Supabase ("staging")** con las Partes B3–B6 y pon **sus** URL y clave publicable solo en el entorno *Preview*.
     - Si no lo necesitas, desactiva las previews en *Settings → Git*.
6. **Publicar.** *Deploy*, o haz push a `main`. La dirección será `https://<app>.vercel.app`. Un dominio propio se añade después en *Settings → Domains* sin cambiar nada de la app (recuerda repetir la B4 con la nueva URL).
7. **Comprobar la URL.** Desde tu ordenador, sin iniciar sesión y sin escribir datos:

   ```bash
   npm run check:deploy -- https://<app>.vercel.app --expect-supabase https://<project-ref>.supabase.co
   ```

   Todo debe salir con ✓:
   - HTTPS;
   - cabeceras de seguridad;
   - service worker;
   - manifest instalable;
   - ruta `/restablecer`;
   - código sin claves secretas;
   - Supabase de producción.

---

## Parte D — Primera puesta en marcha (lista de comprobación)

Hazla con un **equipo de pruebas** creado con las plantillas; bórralo al acabar (Parte E2).

**Hazla con dos móviles reales, uno Android (Chrome) y otro iPhone (Safari):**

| ✓ | Paso |
|---|---|
| ☐ | Abrir `https://<app>.vercel.app` en el móvil e **instalar** la app (Android: *Instalar app*; iPhone: *Compartir → Añadir a pantalla de inicio*) |
| ☐ | **¿Has olvidado la contraseña?** → llega el correo (mira también en spam) → el enlace abre la app → contraseña nueva → entra |
| ☐ | Iniciar sesión: se ve el entrenador y el **equipo**; la temporada activa es la correcta |
| ☐ | **JUGADORES**: añadir jugadores con dorsal |
| ☐ | **NUEVO PARTIDO** con rival, fecha, hora y **escudo** (probar con la cámara del móvil) |
| ☐ | **Convocatoria** y **alineación**; confirmar |
| ☐ | **▶ COMENZAR**: el reloj corre y la pantalla no se apaga |
| ☐ | Hacer una **sustitución** |
| ☐ | Final de la 1ª parte (automático); configurar y empezar la **2ª parte** |
| ☐ | Otra sustitución; final del partido |
| ☐ | **Resultado**, observaciones y **GUARDAR PARTIDO** |
| ☐ | En el **segundo móvil** (otro entrenador del equipo): ver el partido y los minutos descargados |
| ☐ | Partido nuevo en juego en el móvil A; el móvil B lo abre en **modo consulta** (se actualiza solo en ≤ 5 s) |
| ☐ | B pulsa **TOMAR CONTROL**; A ve "OTRO DISPOSITIVO HA TOMADO EL CONTROL" |
| ☐ | A: **ENTENDIDO** → modo consulta; A vuelve a **TOMAR CONTROL**; B ve que lo ha perdido |
| ☐ | **Sin conexión** (modo avión) en mitad del partido: la app sigue; al volver la conexión, sincroniza ("✓ Sincronizado") |
| ☐ | Cerrar la app y abrirla **sin conexión**: abre y continúa el partido |
| ☐ | **Sincronización**: lo hecho en un móvil aparece en el otro en ≤ 15 s |
| ☐ | Publicar un cambio (push a `main`): aparece el aviso de versión nueva, y **no** durante el partido |

---

## Parte E — Administración habitual

### E1. Añadir un entrenador

Sigue la B6, paso 2: crear la cuenta en *Authentication → Users*, ejecutar `04_…` y que el entrenador ponga su contraseña con "¿Has olvidado la contraseña?".

### E2. Quitar un entrenador

- `05_retirar_entrenador_del_equipo.sql`.
  - Deja de ver el equipo.
  - Si tiene la app abierta, se le cierra la sesión al recuperar la conexión; si está en mitad de un partido, al terminarlo.
  - Sus partidos anteriores se conservan.
  - No se puede retirar al último administrador.
- Para borrar la cuenta: *Authentication → Users → Delete user*, **solo si no tiene partidos registrados**. El historial del partido guarda quién hizo cada cosa, y la base de datos impide borrar una cuenta con eventos.

### E3. Nueva temporada

`02_nueva_temporada_y_activar.sql` (por ejemplo, en verano).
- Las temporadas anteriores se conservan.
- Los móviles pasan a la nueva al abrir la app con conexión.

### E4. Copias de seguridad

```bash
npx supabase link --project-ref <project-ref>   # una vez
npm run db:backup -- --linked                   # pide la contraseña de la base de datos
```

- **Qué hace:**
  - crea una carpeta **fuera del repositorio** (por defecto `~/copias-gestor-minutos/linked-<fecha>`) con `roles.sql`, `schema.sql` y `data.sql`;
  - añade `SHA256SUMS` para comprobar la integridad;
  - se niega a guardar dentro del repositorio.
- **Comprueba que existe y está bien:**

  ```bash
  ls -l ~/copias-gestor-minutos/<carpeta>
  (cd ~/copias-gestor-minutos/<carpeta> && sha256sum -c SHA256SUMS)
  ```

- **Dónde guardarla:** en un disco o carpeta **privada y cifrada**. Contiene datos personales y los datos de acceso cifrados (hashes) de las cuentas.
- **Qué NO hacer:** **nunca** subirla a Git ni a una carpeta compartida.
- **Cuándo:** una vez al mes y al terminar cada temporada. También **antes** de cualquier cambio grande (migraciones nuevas).
- **Escudos:** las imágenes están en Storage, **no** en esta copia. Si quieres guardarlas, descárgalas en *Storage → crests*; si se perdieran, basta con volver a ponerlas en cada partido.
- **Restaurar.** Depende de las herramientas de Supabase y PostgreSQL (`psql`); sigue la documentación actual de Supabase ("Backup and restore using the CLI"). En resumen:
  1. Crea un proyecto **nuevo y vacío** en Supabase.
  2. **No** apliques las migraciones: `schema.sql` ya trae el esquema.
  3. En *Project Settings → Database*, copia la cadena de conexión y ejecuta:

     ```bash
     psql --single-transaction --variable ON_ERROR_STOP=1 \
       --file roles.sql --file schema.sql \
       --command 'SET session_replication_role = replica' \
       --file data.sql --dbname '<cadena de conexión del proyecto nuevo>'
     ```

  4. Repite la Parte B4 (configuración) y la C3–C4 (variables y `deploy/production.json`) con el proyecto nuevo, y vuelve a comprobar con `npm run check:deploy`.

### E5. Comprobar errores

- `08_consultar_errores_tecnicos.sql`: los errores técnicos que envían los móviles (la app nunca se los enseña al entrenador).
- Complementos: *Logs* del panel de Supabase y *Deployments → Logs* en Vercel.

### E6. Recuperación de contraseña

La hace el propio entrenador desde la app ("¿Has olvidado la contraseña?"). Si el correo no llega, consulta la Parte F. El administrador no necesita (ni debe) conocer contraseñas.

### E7. Qué datos se guardan y dónde

**En Supabase** (región UE elegida en B1):
- cuentas (email y nombre visible);
- equipos y temporadas;
- jugadores (nombre y dorsal);
- partidos, alineaciones, cambios y minutos;
- informes;
- escudos;
- errores técnicos.

**En cada móvil**, la copia local para poder trabajar sin conexión.

**Vercel** solo sirve la app: no guarda datos de los partidos.

---

## Parte F — Problemas habituales

| Problema | Qué hacer |
|---|---|
| **No llega el correo de recuperación** | Mirar spam. En Supabase: *Authentication → Emails → SMTP Settings* activo y con los datos correctos, y *Logs → Auth* para ver el error. En el proveedor (Brevo/Resend): remitente o dominio verificado y límite diario. Pedir otro correo pasado un minuto (hay límite por hora). La *Redirect URL* debe ser la URL real de la app (B4) |
| **No sincroniza** ("cambios pendientes" o "No se ha podido sincronizar") | Comprobar la conexión. Si el proyecto de Supabase está **pausado**, reactivarlo (*Restore project*): los datos siguen en el móvil y se suben solos. Revisar `08_consultar_errores_tecnicos.sql`. Si el reloj del móvil está muy adelantado, los eventos esperan a que su hora pase (no se pierden); poner la hora automática en el móvil |
| **"Controlado por otro dispositivo"** | Es normal: otro entrenador (u otro móvil) lleva el partido. Se puede consultar en directo o pulsar **TOMAR CONTROL** (necesita conexión). El otro móvil verá que ha perdido el control |
| **"OTRO DISPOSITIVO HA TOMADO EL CONTROL"** con cambios no aplicados | Esos cambios se hicieron sin conexión mientras otro móvil llevaba el partido: no cuentan, pero se conservan en la ficha (CAMBIOS NO APLICADOS). Si hay que repetir alguno, lo hace quien controla el partido |
| **Se pierde la conexión en un partido** | No hay que hacer nada: la app guarda todo en el móvil y lo sube al volver la conexión |
| **Se pierde la sesión** ("Tu sesión ha caducado") | En mitad de un partido, la app no echa al entrenador: termina el partido y después vuelve a iniciar sesión. Los datos no se borran al cerrar sesión |
| **Vercel devuelve error o la página no carga** | *Deployments*: ver el último build. Si falla en `check-build-env`, el mensaje dice qué variable está mal (p. ej. una preview apuntando a producción). Se puede volver a una versión anterior con *Promote to Production*. Después, `npm run check:deploy -- <url>` |
| **Supabase devuelve error** | *Project Status* y *Logs* del panel. Si una migración nueva falló, **no** tocar tablas a mano: revisar `db push --dry-run`, y si hace falta restaurar la copia (E4) |
| **Un entrenador no ve su equipo** | `06_consultar_miembros.sql`: debe aparecer como miembro. Si no, `04_…` |
