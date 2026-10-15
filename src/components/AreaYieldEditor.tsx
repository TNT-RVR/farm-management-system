import { RecordEditModal } from '@/components/RecordEditor'
import { useSaveAreaYield, useUseAreaScale, type CropAreaYield } from '@/lib/cropAreaYields'

/**
 * One crop's yield on a split field, for one year: a typed figure stands
 * over the scale loads' until it is cleared. Opened from the field's crop
 * card and its yield history.
 */
export function AreaYieldEditor({
  fieldId,
  cropYear,
  cropId,
  cropName,
  unit,
  acres,
  row,
  onClose,
}: {
  fieldId: string
  cropYear: number
  cropId: string
  cropName: string
  unit: string | null
  /** The crop's area acres, for a row not yet made. */
  acres: number | null
  row: CropAreaYield | null
  onClose: () => void
}) {
  const save = useSaveAreaYield()
  const backToScale = useUseAreaScale()
  const failed = save.error ?? backToScale.error
  return (
    <RecordEditModal
      title={`${cropName} yield, ${cropYear}`}
      fields={[
        { key: 'yield_per_acre', label: `Yield per acre (${unit ?? 'bu'})`, kind: 'number', step: 'any', hint: 'Leave blank to use the scale loads.' },
        { key: 'notes', label: 'Note', kind: 'textarea' },
      ]}
      row={{ yield_per_acre: row?.yield_override ? row.yield_per_acre : null, notes: row?.notes ?? null }}
      onClose={onClose}
      saving={save.isPending || backToScale.isPending}
      error={failed ? (failed as Error).message : null}
      onSave={async (p) => {
        const typed = (p.yield_per_acre as number | null) ?? null
        if (typed == null && row) await backToScale.mutateAsync(row.id)
        else
          await save.mutateAsync({
            id: row?.id,
            field_id: fieldId,
            crop_year: cropYear,
            crop_id: cropId,
            acres: row?.acres ?? acres,
            yield_per_acre: typed,
            yield_unit: unit,
            notes: (p.notes as string | null) ?? null,
          })
        onClose()
      }}
    >
      {row?.scale_total != null && (
        <p className="text-xs text-gray-500">
          Scale: {row.scale_total} {row.yield_unit} from {row.scale_loads} loads over {row.acres} ac.
        </p>
      )}
    </RecordEditModal>
  )
}
