# PRD — Gestor de minutos de jugadores de fútbol

> Copia del PRD proporcionado por el usuario (2026-09-29). Las decisiones técnicas están en `docs/PLAN_TECNICO.md`.

## 1. Objetivo del proyecto

Construir una aplicación web responsive, optimizada principalmente para móvil, para que los entrenadores de un equipo de fútbol puedan gestionar las alineaciones, cambios y minutos jugados de los jugadores durante los partidos.

Actualmente los entrenadores llevan los minutos en un Excel, añadiendo manualmente los minutos de cada jugador en columnas correspondientes a cada partido. La nueva aplicación debe sustituir ese proceso manual.

> Durante el partido, el entrenador únicamente debe preocuparse de seleccionar la alineación y registrar los cambios. La aplicación debe encargarse automáticamente de calcular los minutos de cada jugador y generar el resumen final.

Debe funcionar en Android e iPhone desde navegador y ser instalable como PWA.

## 2. Usuarios

Tres entrenadores: ISAAC, JORDI, JOSÉ. Sin autenticación compleja inicialmente. Pantalla inicial "¿QUIÉN ERES?" con tres botones; se guarda quién usa la app para registrar quién gestionó el partido.

## 3. Flujo

Seleccionar entrenador → Seleccionar partido → Crear alineación → Elegir formación → Asignar jugadores a posiciones → Confirmar alineación → Comenzar partido → Cronómetro → Registrar cambios → Finalizar primera parte → Confirmar alineación de segunda parte → Continuar cronómetro → Registrar cambios → Finalizar partido automáticamente → Resumen de minutos → Formulario del partido → Confirmación de guardado → Partido guardado.

## 4. Requisitos técnicos

TypeScript, React/Next.js (o alternativa más sencilla/robusta), PWA, BD persistente, multi-dispositivo, mobile-first, táctil, botones grandes, sin depender de conexión durante el partido.
Prioridad: 1. Fiabilidad 2. Simplicidad 3. Experiencia móvil 4. Mantenimiento 5. Seguridad. No sobrearquitecturar.

## 5. Base de datos (relacional)

- **Coaches**: id, name. Seed: ISAAC, JORDI, JOSÉ.
- **Players**: id, name, number (opcional), active, created_at.
- **Matches**: id, opponent, date, competition, home_away, status, created_at, updated_at, managed_by. Estados: scheduled, setup, first_half, halftime, second_half, finished, saved. Lista creada/importada previamente.
- **Formations**: 4-3-3, 5-3-2, 4-3-2-1. Slots con coordenadas, no depender del texto.
- **Lineups**: id, match_id, half (1|2), formation, confirmed_at.
- **Lineup Players**: id, lineup_id, player_id, position, slot.
- **Match Events** (MUY IMPORTANTE): historial de eventos, no solo el resultado. Tipos: LINEUP_CONFIRMED, PLAYER_IN, PLAYER_OUT, HALF_STARTED, HALF_ENDED, MATCH_STARTED, MATCH_ENDED. Campos: id, match_id, event_type, player_id, related_player_id, match_minute, timestamp, metadata.

## 6. Principio del cronómetro

No depender de `setInterval()` para el minuto; calcular con timestamps (match_started_at, half_started_at). No perder el partido si se apaga la pantalla, se cambia de app, se cierra el navegador, se pierde Internet o se suspende JS. Persistir la información crítica.

## 7–8. Pantalla inicial y lista de partidos

Selección de entrenador → lista de partidos ordenada por fecha (rival, fecha, competición, ENTRAR). Estado visible: Pendiente, En preparación, En juego, Descanso, Finalizado, Guardado. Un partido guardado se consulta pero no se modifica accidentalmente.

## 9–11. Alineación

Elegir formación (4-3-3 / 5-3-2 / 4-3-2-1) → campo tipo editor FIFA simplificado, usable con un dedo. Pulsar posición → elegir jugador. Un jugador no puede ocupar dos posiciones (mensaje claro). Validar alineación completa ("La alineación está incompleta. Faltan 2 posiciones."). Al confirmar: guardar lineup, jugadores, posiciones, evento LINEUP_CONFIRMED, habilitar PLAY.

## 12–13. Pantalla de partido y PLAY

Rival, parte, cronómetro muy visible; campo con jugadores pulsables. PLAY deshabilitado hasta confirmar alineación. Al pulsar: MATCH_STARTED, primera parte, timestamp, cronómetro.

## 14. Primera parte

00:00 → 45:00 automático. Al 45:00: detener, HALF_ENDED, estado halftime, bloquear cambios, pantalla de descanso.

## 15. Descanso

"DESCANSO — Debes confirmar la alineación de la segunda parte [CONFIGURAR 2ª PARTE]". Se puede cambiar formación, jugadores y posiciones.

## 16. Segunda parte

Tras confirmar: "SEGUNDA PARTE [▶ CONTINUAR]". Continúa desde 45:00 hasta 90:00.

## 17. Regla de los 15 segundos

El botón de iniciar la 2ª parte solo disponible cuando (1) hayan pasado 15 s desde el final de la 1ª parte y (2) la alineación de la 2ª esté confirmada. Si se confirma antes de 15 s, esperar; si después, comenzar cuando se pulse continuar.

## 18–20. Cambios

Pulsar jugador → menú CAMBIO (sale X, selecciona quién entra, CANCELAR). Registrar PLAYER_OUT + PLAYER_IN con el minuto exacto (57:23). Un jugador en campo no aparece como candidato. Por ahora un jugador puede entrar, salir y NO volver a entrar; diseñar para permitir reentradas en el futuro. Cada sustitución es un evento inmutable; lista "CAMBIOS 32' Carlos → Pablo".

## 21. Final automático

A 90:00: MATCH_ENDED, estado finished, sin cambios, mostrar resumen.

## 22. Cálculo de minutos

A partir de eventos. Titular sale 57' → 57; entra 57' → 33; juega todo → 90. Guardar segundos internamente (57m 42s), mostrar 57'.

## 23. Resumen

PARTIDO FINALIZADO, rival, MINUTOS por jugador, CAMBIOS, ALINEACIÓN INICIAL, FORMACIÓN 1ª y 2ª PARTE.

## 24. Formulario posterior

Resultado, Goles a favor, Goles en contra, Observaciones. Configurable para añadir campos.

## 25. Guardado

GUARDAR PARTIDO → "¿Guardar partido?" (CANCELAR/CONTINUAR) → "¿ESTÁS SEGURO?" (VOLVER/GUARDAR DEFINITIVAMENTE) → "✓ PARTIDO GUARDADO [VOLVER A PARTIDOS]".

## 26–27. Estadísticas

Tabla equivalente al Excel (jugador × partido, total calculado). Futuro: minutos totales, partidos jugados, titularidades, suplencias, goles, asistencias, tarjetas, convocatorias, minutos por competición, últimos 5, porcentaje, por temporada.

## 28. Persistencia y recuperación

Si se bloquea el teléfono, se cierra el navegador, se pierde Internet, se cambia de app o se recarga: recuperar el estado. Nunca perder cronómetro, alineación, cambios, eventos, entrenador, estado. Sin conexión: "SIN CONEXIÓN — Los datos se guardarán localmente y se sincronizarán cuando vuelva Internet." No bloquear al entrenador.

## 29–30. UX y orientación

Mobile-first, botones grandes, pocos elementos, alto contraste, una mano, sin menús profundos, sin escritura durante el partido, confirmar acciones destructivas. Cambio en 2-3 pulsaciones. Evaluar si recomendar horizontal en la pantalla de partido.

## 31. Máquina de estados

SCHEDULED → SETUP → FIRST_HALF → HALFTIME → SECOND_HALF → FINISHED → SAVED. Sin saltos arbitrarios.

## 32. Reglas

No iniciar sin alineación confirmada. No iniciar 2ª parte sin alineación 2ª confirmada. Sin cambios en el descanso ni tras 90:00. No modificar partido guardado. Cronómetro no depende de contador local. Eventos = fuente de verdad. Minutos calculados de eventos. No borrar eventos físicamente.

## 33. Errores

Mensajes claros ("No se ha podido guardar el cambio. Tus datos están guardados localmente..."). Nunca errores técnicos al usuario; registrarlos para debugging.

## 34–36. Futuro

Panel admin (Jugadores, Partidos, Entrenadores, Temporadas, Estadísticas, Exportar Excel). Seguridad preparada para admin/entrenadores/jugadores/varios equipos; sin secretos en frontend. Importación inicial de jugadores y partidos vía seed; arquitectura preparada para importar Excel.

## 37. Criterios de aceptación

1 Abrir app · 2 Seleccionar ISAAC · 3 Seleccionar partido · 4 Elegir 4-3-3 · 5 Asignar todas las posiciones · 6 Confirmar · 7 Iniciar cronómetro · 8 Una sustitución · 9 Llegar a 45:00 · 10 Bloquear cambios · 11 Esperar ≥15 s · 12 Configurar 2ª alineación · 13 Confirmarla · 14 Continuar · 15 Varias sustituciones · 16 Llegar a 90:00 · 17 Fin automático · 18 Minutos calculados · 19 Historial de cambios · 20 Rellenar informe · 21 GUARDAR · 22 Confirmar dos veces · 23 Guardar definitivamente · 24 Volver a la lista · 25 Ver partido guardado · 26 Ver minutos acumulados.

## 38. Fases

1 Arquitectura · 2 MVP · 3 Persistencia · 4 Informe · 5 Estadísticas.

## 39–41. Metodología y calidad

Detectar ambigüedades y preguntar las decisiones de arquitectura; documentar decisiones menores; no inventar funcionalidades; no añadir complejidad. TypeScript estricto, modular, lógica separada de UI, tests de máquina de estados, minutos, sustituciones y recuperación del cronómetro. Casos límite: titular sale en 45:00; entra exactamente en 45:00; entra después de 45:00; sale en 90:00; no juega; juega todo; entra y sale; cambio sin conexión; recarga durante el partido; teléfono bloqueado varios minutos.

Prioridad absoluta: que un entrenador pueda gestionar un partido entero con una mano y sin pensar en cómo funciona la app. Robustez > espectacularidad; sistema de cambios fiable > estadísticas; recuperación > animaciones.
