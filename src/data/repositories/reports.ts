import { canEditReport, type Id } from '../../domain'
import type { AppDatabase, MatchReportRecord } from '../db'
import type { DataEnv } from '../env'
import { failResult, okResult, type DataResult } from '../errors'

export interface ReportInput {
  readonly result: string
  readonly observations: string
}

export async function getReport(db: AppDatabase, matchId: Id): Promise<MatchReportRecord | null> {
  return (await db.matchReports.get(matchId)) ?? null
}

/** Se llama mientras el entrenador escribe: el informe nunca se pierde. */
export async function saveReport(
  db: AppDatabase,
  env: DataEnv,
  matchId: Id,
  input: ReportInput,
  coachId: Id | null,
): Promise<DataResult<MatchReportRecord>> {
  return db.transaction('rw', [db.matches, db.matchReports], async () => {
    const match = await db.matches.get(matchId)
    if (!match) return failResult({ code: 'NOT_FOUND' })
    if (!canEditReport(match.status)) return failResult({ code: 'LOCKED' })
    const record: MatchReportRecord = {
      matchId,
      result: input.result,
      observations: input.observations,
      updatedAt: env.now(),
      updatedBy: coachId,
      syncState: 'pending',
      syncIssue: null,
    }
    await db.matchReports.put(record)
    return okResult(record)
  })
}
