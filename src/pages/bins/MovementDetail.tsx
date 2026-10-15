import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { DeleteButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import { useCrops, useFields } from '@/lib/queries'
import { useBins } from '@/lib/bins'
import { binCropOptions } from '@/lib/bin-contents'
import { refreshAfterLoad } from '@/lib/bin-loads'
import { GRAIN_MOVEMENT_TYPES, useEditGrainMovement, useTransferCandidates, type GrainMovementRow } from '@/lib/inventory'
import { findTransferPartner, loadIdOf, movementEditProblem, movementSource } from '@/lib/record-edits'

const bu = (v: number) => `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v)).toLocaleString('en-CA')} bu`

/**
 * One line of a bin's ledger, opened (Sam, 7 Oct 2026).
 *
 * Who may change it, and how, follows from where it came from (movementSource):
 * a weighed load's movement is the load's, so it opens the load instead; a
 * move between bins changes on both bins at once; anything added by hand is
 * edited and deleted here. Managers only, as the table's policy is.
 */
export function MovementDetail({
  m,
  label,
  signed,
  balance,
  isManager,
  onOpenLoad,
  onClose,
}: {
  m: GrainMovementRow
  label: string
  signed: number
  balance: number
  isManager: boolean
  /** Open the load a mirrored movement came from; absent when it is not to hand. */
  onOpenLoad?: (loadId: string) => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const { data: crops } = useCrops()
  const { data: fields } = useFields()
  const { data: bins } = useBins()
  const edit = useEditGrainMovement(() => refreshAfterLoad(qc))
  const source = movementSource(m)
  const { data: candidates, isLoading: looking } = useTransferCandidates(source === 'transfer' ? m : null)
  const partner = source === 'transfer' ? findTransferPartner(m, candidates ?? []) : null
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cropName = (id: string | null) => (crops ?? []).find((c) => c.id === id)?.name ?? null
  const fieldName = (id: string | null) => (fields ?? []).find((f) => f.id === id)?.name ?? null
  const binName = (id: string | null) => (bins ?? []).find((b) => b.id === id)?.name ?? null
  const loadId = loadIdOf(m)

  const editFields: EditField[] =
    source === 'transfer'
      ? [
          { key: 'bushels', label: 'Bushels', kind: 'number', required: true },
          { key: 'moved_at', label: 'Date', kind: 'date', required: true },
          { key: 'notes', label: 'Note', kind: 'textarea' },
        ]
      : [
          {
            key: 'movement_type',
            label: 'Kind',
            kind: 'select',
            // Not into a transfer: one of those needs its other half in another bin.
            options: GRAIN_MOVEMENT_TYPES.filter((t) => !t.value.startsWith('transfer')).map((t) => ({ value: t.value, label: t.label })),
          },
          { key: 'bushels', label: 'Bushels', kind: 'number', required: true, hint: 'An adjustment takes a sign (−40 takes 40 bu off); every other kind is just the amount.' },
          { key: 'crop_id', label: 'Crop', kind: 'select', options: [{ value: '', label: 'Not recorded' }, ...binCropOptions(crops ?? [])] },
          {
            key: 'field_id',
            label: 'Field',
            kind: 'select',
            options: [{ value: '', label: 'No field' }, ...(fields ?? []).map((f) => ({ value: f.id, label: f.name }))],
          },
          { key: 'moved_at', label: 'Date', kind: 'date', required: true },
          { key: 'ticket_number', label: 'Ticket number', kind: 'text' },
          { key: 'notes', label: 'Note', kind: 'textarea' },
        ]

  const save = async (patch: Record<string, unknown>) => {
    setError(null)
    const kind = (patch.movement_type as string | undefined) ?? m.movement_type
    const amount = patch.bushels as number | null
    const problem = movementEditProblem({ movement_type: kind, bushels: amount, moved_at: (patch.moved_at as string | null) ?? null })
    if (problem) {
      setError(problem)
      throw new Error(problem)
    }
    try {
      await edit.update.mutateAsync({
        id: m.id,
        partnerId: partner?.id ?? null,
        patch: { ...patch, bushels: Math.round((amount as number) * 100) / 100 } as GrainMovementRow,
      })
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
  }

  const canChange = isManager && source !== 'load'

  return (
    <>
      <Modal title={`${label} · ${m.moved_at}`} onClose={onClose}>
        <div className="space-y-3 text-sm">
          <DetailList
            rows={[
              ['What', label],
              ['Bushels', bu(signed)],
              ['Balance after', `${Math.round(balance).toLocaleString('en-CA')} bu`],
              ['Crop', cropName(m.crop_id)],
              ['Field', fieldName(m.field_id)],
              ['Ticket', source === 'load' ? null : m.ticket_number],
              [m.movement_type === 'transfer_in' ? 'From' : 'To', partner ? binName(partner.bin_id) : null],
              ['Note', m.notes],
              ['Entered', new Date(m.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })],
            ]}
          />

          {source === 'load' && (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              This came from a weighed load, so it is changed at the load — the bin follows.
            </p>
          )}
          {source === 'transfer' && !looking && (
            <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {partner
                ? `Half of a move with ${binName(partner.bin_id) ?? 'another bin'}: a change or a delete is made to both bins.`
                : 'Half of a move whose other half was not found (it may have been changed on its own). A change here is made to this bin only.'}
            </p>
          )}
          {edit.remove.isError && <p className="text-xs text-red-700">{(edit.remove.error as Error).message}</p>}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {isManager && source === 'load' && loadId && onOpenLoad && (
              <button
                type="button"
                onClick={() => onOpenLoad(loadId)}
                className="flex items-center gap-1 rounded-md bg-brand-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-800"
              >
                <Scale className="h-3.5 w-3.5" /> Open the load
              </button>
            )}
            {canChange && (
              <>
                <DeleteButton
                  disabled={edit.remove.isPending || looking}
                  confirm={partner ? `Delete this move? Both halves go, in ${binName(m.bin_id) ?? 'this bin'} and ${binName(partner.bin_id) ?? 'the other bin'}.` : 'Delete this movement? The bin’s balance changes with it.'}
                  onDelete={() => edit.remove.mutate({ id: m.id, partnerId: partner?.id ?? null }, { onSuccess: onClose })}
                />
                <EditButton onClick={() => setEditing(true)} />
              </>
            )}
          </div>
        </div>
      </Modal>

      {editing && (
        <RecordEditModal
          title={source === 'transfer' ? 'Correct this move' : 'Correct this movement'}
          fields={editFields}
          row={{ ...m, bushels: Number(m.bushels) }}
          saving={edit.update.isPending}
          error={error}
          onClose={() => {
            setEditing(false)
            setError(null)
          }}
          onSave={save}
        />
      )}
    </>
  )
}
