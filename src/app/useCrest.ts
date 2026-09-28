import { useLiveQuery } from 'dexie-react-hooks'
import type { Id } from '../domain'
import { useApp } from './context'

/** Data URL del escudo (null si no tiene o aún no ha cargado). */
export function useCrest(crestId: Id | null): string | null {
  const { db } = useApp()
  return useLiveQuery(async () => (crestId ? ((await db.crests.get(crestId))?.dataUrl ?? null) : null), [db, crestId]) ?? null
}
