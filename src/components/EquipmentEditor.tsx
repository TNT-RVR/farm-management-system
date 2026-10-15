import { useNavigate } from 'react-router-dom'
import { RecordEditModal, type EditField } from '@/components/RecordEditor'
import { useAddEquipment, useDeleteEquipment, useSaveEquipment, type Equipment } from '@/lib/equipment'
import { manualEquipmentPatch } from '@/lib/equipment-edits'
import { keepOpenOnError } from '@/lib/record-actions'

/** The record of a machine added by hand: everything Deere would otherwise fill in. */
const MANUAL_FIELDS: EditField[] = [
  { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'e.g. 1066 shop tractor' },
  {
    key: 'category',
    label: 'Kind',
    kind: 'select',
    options: [
      { value: 'machine', label: 'Machine' },
      { value: 'implement', label: 'Implement' },
      { value: 'technology', label: 'Technology' },
      { value: 'other', label: 'Other' },
    ],
  },
  { key: 'make', label: 'Make', kind: 'text' },
  { key: 'model', label: 'Model', kind: 'text' },
  { key: 'equipment_type', label: 'Type', kind: 'text', placeholder: 'tractor, swather, auger…' },
  { key: 'serial_number', label: 'Serial number', kind: 'text' },
  { key: 'vin', label: 'VIN', kind: 'text' },
  { key: 'engine_hours', label: 'Engine hours (meter now)', kind: 'number', step: '1', hint: 'Dated today when changed.' },
  {
    key: 'archived',
    label: 'Still on the farm?',
    kind: 'select',
    options: [
      { value: 'false', label: 'Yes' },
      { value: 'true', label: 'No — sold / archived' },
    ],
  },
  { key: 'notes', label: 'Notes', kind: 'textarea' },
]

/**
 * Add a machine by hand, or edit one that was (Sam, 7 Oct 2026). Deere's own
 * machines are not edited here: the sync rewrites their name, make, model,
 * serial and category every run, so their page says to change those in
 * Operations Center, and keeps only the notes and warranty, which are ours.
 * Managers only (jd_equipment is manager-write).
 */
export function ManualEquipmentModal({ machine, onClose }: { machine: Equipment | null; onClose: () => void }) {
  const navigate = useNavigate()
  const add = useAddEquipment()
  const save = useSaveEquipment()
  const del = useDeleteEquipment()
  const err = add.error ?? save.error ?? del.error
  const row = machine
    ? ({ ...machine, archived: String(machine.archived) } as unknown as Record<string, unknown>)
    : { category: 'machine', archived: 'false' }
  return (
    <RecordEditModal
      title={machine ? `Edit ${machine.name ?? 'machine'}` : 'Add a machine by hand'}
      fields={MANUAL_FIELDS}
      row={row}
      onClose={onClose}
      onSave={async (patch) => {
        const clean = manualEquipmentPatch({ engine_hours: machine?.engine_hours ?? null }, patch)
        if (machine) return save.mutateAsync({ id: machine.id, ...clean })
        const id = await add.mutateAsync(clean as Parameters<typeof add.mutateAsync>[0])
        navigate(`/equipment/${id}`)
      }}
      onDelete={
        machine
          ? () =>
              keepOpenOnError(
                del.mutateAsync(machine.id).then(() => {
                  navigate('/equipment')
                }),
              )
          : undefined
      }
      deleteConfirm={`Delete ${machine?.name ?? 'this machine'} and its service schedule and history? To keep its history, set "Still on the farm?" to No instead.`}
      saving={add.isPending || save.isPending || del.isPending}
      error={err ? (err as Error).message : null}
    />
  )
}
