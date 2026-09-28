import type { DataError } from '../data'
import type { FieldError } from '../domain'

// Todos los textos de error que ve el entrenador. Nunca mensajes técnicos (PRD §33).

const FIELD_MESSAGES: Record<string, Partial<Record<FieldError['code'], string>>> = {
  name: { REQUIRED: 'Escribe el nombre.' },
  number: {
    REQUIRED: 'Escribe el dorsal.',
    INVALID: 'El dorsal debe ser un número del 0 al 99.',
    TAKEN: 'Ese dorsal ya lo tiene otro jugador de la plantilla.',
  },
  opponent: { REQUIRED: 'Escribe el club o equipo rival.' },
  matchDate: { INVALID: 'La fecha no es válida.' },
  kickoffTime: { INVALID: 'La hora no es válida.' },
}

/** Errores por campo para mostrarlos debajo de cada input. */
export function fieldErrors(error: DataError | null): Record<string, string> {
  if (!error || error.code !== 'VALIDATION') return {}
  return Object.fromEntries(
    error.errors.map((e) => [e.field, FIELD_MESSAGES[e.field]?.[e.code] ?? 'Revisa este campo.']),
  )
}

export function errorMessage(error: DataError): string {
  switch (error.code) {
    case 'VALIDATION':
      return 'Revisa los datos marcados.'
    case 'NOT_FOUND':
      return 'No se ha encontrado. Puede que se haya borrado.'
    case 'LOCKED':
      return 'El partido ya ha empezado: estos datos ya no se pueden cambiar.'
    case 'RESULT_REQUIRED':
      return 'Escribe el RESULTADO antes de guardar.'
    case 'MATCH_LOCKED':
      return 'El partido está guardado y no se puede modificar.'
    case 'NOT_CONTROLLER':
      return 'Este partido lo está gestionando otro dispositivo.'
    case 'ALREADY_CONTROLLER':
      return 'Ya controlas este partido.'
    case 'INVALID_TRANSITION':
      if (error.status === 'halftime') return 'Es el descanso: no se pueden hacer cambios.'
      if (error.status === 'finished') return 'El partido ha terminado.'
      return 'Esta acción no está disponible ahora.'
    case 'UNKNOWN_FORMATION':
    case 'UNKNOWN_SLOT':
      return 'Esa posición no existe en la formación.'
    case 'LINEUP_INCOMPLETE':
      return `La alineación está incompleta. ${error.missing === 1 ? 'Falta 1 posición.' : `Faltan ${error.missing} posiciones.`}`
    case 'PLAYER_DUPLICATED':
      return 'Ese jugador ya ocupa otra posición.'
    case 'PLAYER_NOT_IN_SQUAD':
      return 'Ese jugador no está convocado.'
    case 'LINEUP_NOT_CONFIRMED':
      return error.half === 1 ? 'Confirma la alineación antes de empezar.' : 'Confirma la alineación de la 2ª parte.'
    case 'PLAYER_NOT_ON_FIELD':
      return 'Ese jugador no está en el campo.'
    case 'PLAYER_ALREADY_ON_FIELD':
      return 'Ese jugador ya está en el campo.'
    case 'SAME_PLAYER':
      return 'Elige otro jugador para entrar.'
    case 'HALF_OVER':
      return error.half === 1 ? 'La primera parte ha terminado.' : 'El partido ha terminado.'
    case 'HALFTIME_WAIT':
      return 'Espera unos segundos para empezar la 2ª parte.'
    case 'NOTHING_TO_UNDO':
      return 'No hay ningún cambio que deshacer en esta parte.'
  }
}

export const UNEXPECTED_ERROR =
  'No se ha podido completar la acción. Tus datos están guardados en el dispositivo; inténtalo de nuevo.'
