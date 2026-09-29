# Administración (sin panel dentro de la app)

Plantillas SQL para el administrador. Se ejecutan en el **panel de Supabase → SQL Editor** del
proyecto de **producción**, que ya tiene permisos de administración: **nunca** hace falta poner la
clave secreta (service-role) en la app, en Vercel ni en un fichero.

| Fichero | Para qué | ¿Cambia datos? |
|---|---|---|
| `00_comprobar_instalacion.sql` | Tras `db push`: RLS, permisos de las funciones, historial protegido, tolerancia de hora, bucket privado y que la instalación esté **vacía** (nada DEMO) | No |
| `01_crear_equipo_y_temporada.sql` | Equipo nuevo con su primera temporada activa | Sí |
| `02_nueva_temporada_y_activar.sql` | Temporada nueva (o existente) como activa | Sí |
| `03_consultar_usuarios.sql` | Cuentas, último acceso y equipos | No |
| `04_anadir_entrenador_al_equipo.sql` | Añadir un entrenador (o cambiar su rol) y su nombre visible | Sí |
| `05_retirar_entrenador_del_equipo.sql` | Retirar a un entrenador de un equipo | Sí |
| `06_consultar_miembros.sql` | Miembros de cada equipo | No |
| `07_consultar_equipos_y_temporadas.sql` | Equipos, temporadas y cuál está activa | No |
| `08_consultar_errores_tecnicos.sql` | Errores técnicos que envían los móviles | No |
| `09_borrar_equipo_de_pruebas.sql` | Borrar el equipo TEMPORAL de la puesta en marcha con todos sus datos (solo equipos cuyo nombre empieza por `PRUEBAS`) | Sí |

Reglas:

- Sustituye **todos** los valores entre `< >` de la sección `DATOS`. Si queda alguno, el script se
  detiene sin cambiar nada.
- Los ficheros del repositorio **no** llevan datos reales (nombres, emails, ids): no guardes aquí
  las versiones rellenadas.
- **Cuentas nuevas**: Authentication → Users → *Add user* → *Create new user*, con el email del
  entrenador, *Auto Confirm User* marcado y una contraseña **aleatoria que no guardes**. Después,
  `04_…`. El entrenador pone **su propia** contraseña desde la app con "¿Has olvidado la
  contraseña?": el administrador nunca la conoce.
- Los scripts están probados contra el Supabase local (`supabase/tests/admin.test.ts`).

Guía completa: `docs/GUIA_PUESTA_EN_MARCHA.md` (Parte C, pasos 3 y 12–17, y Parte E).
