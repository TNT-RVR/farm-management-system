import { useState } from 'react'
import { Scale } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { DeleteButton, DetailList, EditButton, RecordEditModal, type EditField } from '@/components/RecordEditor'
import type { BinLoad } from '@/lib/bin-loads'
import type { ContractRow } from '@/lib/sales'
import { ticketEditPatch } from '@/lib/record-edits'
import { useScaleTicketMutations, type ScaleTicket } from '@/lib/scale-tickets'
import { TicketPhotoButton } from './TicketPhoto'

const n = (v: number | null | undefined, d = 0) => (v == null ? null : Number(v).toLocaleString('en-CA', { maximumFractionDigits: d }))
const pct = (v: number | null | undefined) => (v == null ? null : `${v}%`)

/**
 * One scale ticket, opened from the list (Sam, 7 Oct 2026): every figure on
 * it, its photo, the contract it counts against and the farm load it settles,
 * with Edit and Delete for whoever keeps the tickets.
 *
 * An edit is saved through ticketEditPatch, so a corrected gross or tare
 * carries through to the net and the figure against the contract; the
 * contract's delivered total then follows in the database.
 */
export function ScaleTicketDetail({
  ticket: t,
  contracts,
  contractLabel,
  crops,
  bins,
  load,
  loadField,
  photoId,
  canEdit,
  onOpenLoad,
  onClose,
}: {
  ticket: ScaleTicket
  contracts: ContractRow[]
  contractLabel: (c: ContractRow) => string
  crops: { id: string; name: string; yield_unit?: string | null }[]
  bins: { id: string; name: string }[]
  /** The farm load this ticket settles, when there is one. */
  load: BinLoad | null
  loadField: string | null
  photoId: string | undefined
  canEdit: boolean
  onOpenLoad: (l: BinLoad) => void
  onClose: () => void
}) {
  const { update, remove } = useScaleTicketMutations()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contract = contracts.find((c) => c.id === t.contract_id)
  const crop = crops.find((c) => c.id === t.crop_id)
  const unit = t.unit ?? 'bu'

  const fields: EditField[] = [
    { key: 'delivered_on', label: 'Date', kind: 'date', required: true },
    { key: 'ticket_no', label: 'Ticket number', kind: 'text' },
    { key: 'receipt_no', label: 'Receipt number', kind: 'text' },
    { key: 'buyer', label: 'Buyer', kind: 'text' },
    {
      key: 'contract_id',
      label: 'Contract',
      kind: 'select',
      options: [
        { value: '', label: 'No contract' },
        ...contracts.filter((c) => c.status !== 'cancelled' || c.id === t.contract_id).map((c) => ({ value: c.id, label: contractLabel(c) })),
      ],
    },
    { key: 'bin_id', label: 'Out of bin', kind: 'select', options: [{ value: '', label: '—' }, ...bins.map((b) => ({ value: b.id, label: b.name }))], hint: 'Where it came from. Changing it does not move grain between bins.' },
    { key: 'gross_lb', label: 'Gross lb', kind: 'number' },
    { key: 'tare_lb', label: 'Tare lb', kind: 'number' },
    { key: 'net_lb', label: 'Net lb', kind: 'number', hint: 'Left as it was, it is worked out from gross − tare.' },
    { key: 'net_units', label: `Against the contract (${unit})`, kind: 'number', hint: 'Left as it was, it is worked out from the net.' },
    { key: 'moisture_pct', label: 'Moisture %', kind: 'number', step: '0.1' },
    { key: 'dockage_pct', label: 'Dockage %', kind: 'number', step: '0.01' },
    { key: 'protein_pct', label: 'Protein %', kind: 'number', step: '0.1' },
    { key: 'grade', label: 'Grade', kind: 'text' },
    { key: 'driver', label: 'Driver', kind: 'text' },
    { key: 'truck', label: 'Truck', kind: 'text' },
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]

  const save = async (patch: Record<string, unknown>) => {
    setError(null)
    if (!patch.delivered_on) {
      setError('It needs a date.')
      throw new Error('no date')
    }
    const body = ticketEditPatch(t, patch, { contracts, crops })
    try {
      await update.mutateAsync({ id: t.id, patch: body })
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
  }

  return (
    <>
      <Modal title={`${['Ticket', t.ticket_no ?? t.receipt_no].filter(Boolean).join(' ')} · ${t.delivered_on}`} onClose={onClose} wide>
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <DetailList
              className="min-w-0 flex-1"
              rows={[
                ['Contract', contract ? contractLabel(contract) : 'None'],
                ['Crop', crop?.name ?? null],
                ['Buyer', t.buyer],
                ['Ticket', t.ticket_no],
                ['Receipt', t.receipt_no],
                ['Gross / tare', t.gross_lb != null || t.tare_lb != null ? `${n(t.gross_lb) ?? '—'} / ${n(t.tare_lb) ?? '—'} lb` : null],
                ['Net', t.net_lb != null ? `${n(t.net_lb)} lb` : null],
                ['Dockage', pct(t.dockage_pct) ?? 'waiting for the plant’s receipt'],
                ['Clean', t.clean_net_lb != null ? `${n(t.clean_net_lb)} lb` : null],
                ['Against the contract', t.net_units != null ? `${n(t.net_units, 2)} ${unit}` : null],
                ['Moisture', pct(t.moisture_pct)],
                ['Protein', pct(t.protein_pct)],
                ['Grade', t.grade],
                ['Out of bin', bins.find((b) => b.id === t.bin_id)?.name ?? null],
                ['Driver', [t.driver, t.truck].filter(Boolean).join(' · ') || null],
                ['Notes', t.notes],
              ]}
            />
            <TicketPhotoButton ticketId={t.id} photoId={photoId} label={`Ticket ${t.ticket_no ?? t.receipt_no ?? t.delivered_on}`} canEdit={canEdit} />
          </div>

          {load && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
              <span>
                Settles the farm load of {load.loaded_on}
                {loadField ? ` from ${loadField}` : ''}: {n(load.net_kg == null ? null : Number(load.net_kg))} kg,{' '}
                {n(load.bushels == null ? null : Number(load.bushels), 1)} bu on the farm scale.
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onOpenLoad(load)}
                  className="flex items-center gap-1 rounded-md border border-green-300 bg-white px-2 py-1 font-medium hover:bg-green-100"
                >
                  <Scale className="h-3.5 w-3.5" /> Open the load
                </button>
              )}
            </div>
          )}

          {remove.isError && <p className="text-xs text-red-700">{(remove.error as Error).message}</p>}
          {canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              <DeleteButton
                disabled={remove.isPending}
                confirm="Remove this ticket? The contract total goes back down. A bin drawn down by it is not filled back up."
                onDelete={() => remove.mutate(t.id, { onSuccess: onClose })}
              />
              <EditButton onClick={() => setEditing(true)} />
            </div>
          )}
        </div>
      </Modal>

      {editing && (
        <RecordEditModal
          title="Correct the ticket"
          fields={fields}
          row={t}
          saving={update.isPending}
          error={error}
          onClose={() => {
            setEditing(false)
            setError(null)
          }}
          onSave={save}
        >
          <p className="mt-2 text-[11px] text-gray-500">
            The contract’s delivered total follows the ticket. A bin it was drawn from is not redrawn — correct that under What is
            in the bins.
          </p>
        </RecordEditModal>
      )}
    </>
  )
}
