import type { Half, Id, Lineup } from '../../domain'
import type { AppDatabase } from '../db'
import type { DataEnv } from '../env'

/** Borrador del editor: se guarda en cada toque para que una recarga no pierda nada. */
export async function getLineupDraft(db: AppDatabase, matchId: Id, half: Half): Promise<Lineup | null> {
  return (await db.lineupDrafts.get([matchId, half]))?.lineup ?? null
}

export async function saveLineupDraft(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  half: Half,
  lineup: Lineup,
): Promise<void> {
  await db.lineupDrafts.put({ matchId, half, lineup, updatedAt: env.now() })
}
