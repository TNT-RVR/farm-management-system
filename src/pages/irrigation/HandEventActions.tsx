import { useState } from 'react'
import { DeleteButton, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { hasManagerAccess, useAuth } from '@/lib/auth'
import { useDeleteIrrigationEvent, useReplaceIrrigationEvent } from '@/lib/irrigation'
import { canRemoveEvent, isHandLogged } from '@/lib/irrigation-edits'
import { conv, depthToMm, type UnitSystem } from '@/lib/units'

const md = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })

export type HandEvent = {
  id: string
  field_id: string
  date: string
  gross_mm: number | null
  note: string | null
  source: string
  fieldnet_ref: string | null
  created_by: string | null
  zone_id: string | null
  coverage_deg: number | null
}

/**
 * Edit or delete a pass that was logged by hand (Sam, 7 Oct 2026). FieldNET's
 * own passes come back on the next hourly read, so those are corrected instead
 * (Adjust irrigation amounts). Shown to a manager or to whoever logged the
 * pass — the delete policy on irrigation_events — since a change is a re-log
 * and needs a delete. Renders nothing for anyone else.
 */
export function HandEventActions({ e, u }: { e: HandEvent; u: UnitSystem }) {
  const { profile } = useAuth()
  const isMgr = hasManagerAccess(profile?.role)
  const del = useDeleteIrrigationEvent()
  const replace = useReplaceIrrigationEvent()
  const [editing, setEditing] = useState(false)
  if (!isHandLogged(e) || !canRemoveEvent(e, profile?.id, isMgr)) return null
  const unit = conv.depthUnit(u)
  const dp = u === 'metric' ? 1 : 2
  const fields: EditField[] = [
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'amount', label: `Gross (${unit})`, kind: 'number', step: 'any', required: true },
    { key: 'note', label: 'Note', kind: 'textarea' },
  ]
  // A corrected hand pass edits from its corrected figure, which is gross_mm.
  const row = { date: e.date, amount: conv.depth(e.gross_mm, u, dp), note: e.note }
  const err = replace.error ?? del.error
  return (
    <>
      <EditButton
        onClick={() => {
          replace.reset()
          setEditing(true)
        }}
      />
      <DeleteButton
        onDelete={() => del.mutate(e.id)}
        disabled={del.isPending}
        confirm={`Delete the ${conv.depth(e.gross_mm, u, dp)} ${unit} logged by hand on ${md(e.date)}? It comes out of the balance at the next model run.`}
      />
      {del.isError && <span className="text-[11px] text-red-700">{(del.error as Error).message}</span>}
      {editing && (
        <RecordEditModal
          title={`Pass logged by hand — ${md(e.date)}`}
          fields={fields}
          row={row}
          onClose={() => setEditing(false)}
          onSave={(p) => {
            const amount = p.amount as number | null
            if (amount == null || amount < 0) return Promise.reject(new Error('Enter the gross depth.'))
            return replace.mutateAsync({
              old: { id: e.id, field_id: e.field_id, zone_id: e.zone_id, coverage_deg: e.coverage_deg },
              date: String(p.date),
              gross_mm: depthToMm(amount, u),
              note: (p.note as string | null) ?? null,
            })
          }}
          saving={replace.isPending}
          error={err ? (err as Error).message : null}
        />
      )}
    </>
  )
}
