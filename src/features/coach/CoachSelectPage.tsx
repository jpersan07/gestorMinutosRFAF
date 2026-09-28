import { useLiveQuery } from 'dexie-react-hooks'
import { useNavigate } from 'react-router'
import { useApp } from '../../app/context'
import { Button } from '../../ui/Button'

export function CoachSelectPage() {
  const { db, scope, selectCoach } = useApp()
  const navigate = useNavigate()
  const coaches = useLiveQuery(
    async () =>
      (await db.coaches.where('teamId').equals(scope.teamId).toArray())
        .filter((c) => c.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [db, scope.teamId],
  )

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-4 py-10">
      <div className="text-center">
        <p className="text-sm font-bold tracking-[0.3em] text-muted">GESTOR DE MINUTOS</p>
        <h1 className="mt-3 text-4xl font-black">¿QUIÉN ERES?</h1>
      </div>
      <div className="flex flex-col gap-4">
        {coaches?.map((coach) => (
          <Button
            key={coach.id}
            className="min-h-20 text-2xl"
            onClick={async () => {
              await selectCoach(coach.id)
              navigate('/', { replace: true })
            }}
          >
            {coach.name}
          </Button>
        ))}
      </div>
    </main>
  )
}
