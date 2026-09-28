import type { ReportInput } from '../../data'
import { TextArea } from '../../ui/TextArea'
import { TextField } from '../../ui/TextField'

interface Props {
  readonly values: ReportInput
  readonly readOnly: boolean
  readonly status: string | null
  readonly resultError: string | null
  readonly onChange: (patch: Partial<ReportInput>) => void
  readonly onBlur: () => void
}

/** INFORME DEL PARTIDO: resultado (texto, p. ej. "3-1") y observaciones libres. */
export function ReportForm({ values, readOnly, status, resultError, onChange, onBlur }: Props) {
  return (
    <section aria-label="INFORME DEL PARTIDO" className="flex flex-col gap-4">
      <h2 className="text-sm font-bold tracking-wide text-muted">INFORME DEL PARTIDO</h2>
      <TextField
        label="Resultado"
        placeholder="3-1"
        value={values.result}
        disabled={readOnly}
        autoComplete="off"
        onChange={(e) => onChange({ result: e.target.value })}
        onBlur={onBlur}
        error={resultError}
      />
      <TextArea
        label="Incidencias relevantes / observaciones"
        value={values.observations}
        disabled={readOnly}
        onChange={(e) => onChange({ observations: e.target.value })}
        onBlur={onBlur}
      />
      {status && (
        <p aria-live="polite" className="text-sm text-muted">
          {status}
        </p>
      )}
    </section>
  )
}
