import { ChevronRight, Plus } from 'lucide-react'
import { DeleteButton, EditButton, RecordEditModal, rowClick, type EditField } from '@/components/RecordEditor'
import { useCropVarietyMutations, type CropRow, type CropVarietyRow } from '@/lib/queries'
import type { PlanterProfile } from '@/lib/planter-profiles'
import {
  VARIETY_CROP_KEYS,
  VARIETY_LABELS,
  VARIETY_PLANTER_KEYS,
  figuresToStore,
  varietyFigures,
  varietyKey,
  varietyOverrides,
  varietyParts,
  varietySettingFor,
  type VarietyKey,
  type VarietySettingRow,
} from '@/lib/crop-variety-settings'
import { useCropVarietySettingMutations } from '@/lib/crop-variety-settings-data'
import { cn } from '@/lib/utils'

/** The chevron beside a crop's name that opens its variety rows. */
export function VarietyToggle({ open, count, name, onToggle }: { open: boolean; count: number; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${name} varieties`}
      title={count ? `${count} ${count === 1 ? 'variety' : 'varieties'}` : 'Varieties'}
      className="-ml-1 mr-1 inline-flex items-center rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
    >
      <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
      {count > 0 && <span className="text-[10px] font-semibold tabular-nums text-gray-500">{count}</span>}
    </button>
  )
}

/** The figure a range part stands for also covers its other end. */
const PARTNER: Partial<Record<VarietyKey, VarietyKey>> = { seeds_per_acre_min: 'seeds_per_acre_max', depth_in_min: 'depth_in_max' }

/**
 * A variety's figures in a line, all of them filled in. The ones it has of
 * its own read darker; the rest are the crop's (hover says so).
 */
export function VarietyFigures({ crop, planter, row, className }: { crop: CropRow; planter: PlanterProfile | null; row: VarietySettingRow | null; className?: string }) {
  const own = new Set(varietyOverrides(row))
  const parts = varietyParts(varietyFigures(crop, planter, row), crop.yield_unit)
  if (!parts.length) return <span className={cn('text-xs text-gray-400', className)}>No figures yet</span>
  return (
    <span className={cn('text-xs', className)}>
      {parts.map((p, i) => {
        const mine = own.has(p.key) || (PARTNER[p.key] != null && own.has(PARTNER[p.key]!))
        return (
          <span key={p.key}>
            {i > 0 && <span className="text-gray-300"> · </span>}
            <span className={mine ? 'font-medium text-gray-900' : 'text-gray-600'} title={mine ? undefined : `Same as ${crop.name}`}>
              {p.text}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** A crop's varieties, indented under it in the crop table: every one, with its figures. */
export function VarietySubRows({
  crop,
  planter,
  names,
  rows,
  colSpan,
  isManager,
  onOpen,
  onAdd,
}: {
  crop: CropRow
  planter: PlanterProfile | null
  /** Every variety the crop is known by (its list, plans, history, settings rows). */
  names: string[]
  /** The crop's variety settings rows. */
  rows: VarietySettingRow[]
  colSpan: number
  isManager: boolean
  onOpen: (variety: string) => void
  onAdd: () => void
}) {
  const { remove } = useCropVarietySettingMutations()
  return (
    <>
      {names.map((name) => {
        const v = varietySettingFor(rows, crop.id, name)
        return (
          <tr
            key={varietyKey(name)}
            onClick={isManager ? rowClick(() => onOpen(name)) : undefined}
            className={cn('border-b border-gray-100 bg-gray-50/70', isManager && 'cursor-pointer hover:bg-gray-100/70')}
          >
            <td colSpan={colSpan} className="py-1.5 pl-10 pr-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-gray-800">{name}</span>
                <VarietyFigures crop={crop} planter={planter} row={v} className="min-w-0 flex-1" />
                {isManager && (
                  <span className="flex items-center gap-1">
                    <EditButton onClick={() => onOpen(name)} />
                    {v && (
                      <DeleteButton
                        label="Back to crop"
                        disabled={remove.isPending}
                        confirm={`Set ${name}'s figures back to ${crop.name}'s?`}
                        onDelete={() => remove.mutate(v.id)}
                      />
                    )}
                  </span>
                )}
              </div>
              {v?.notes && <p className="mt-0.5 text-xs text-gray-500">{v.notes}</p>}
            </td>
          </tr>
        )
      })}
      {isManager && (
        <tr className="border-b border-gray-100 bg-gray-50/70">
          <td colSpan={colSpan} className="py-1.5 pl-10 pr-3">
            <button type="button" onClick={onAdd} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add a variety
            </button>
          </td>
        </tr>
      )}
      {remove.isError && (
        <tr>
          <td colSpan={colSpan} className="pl-10 text-xs text-red-600">
            {(remove.error as Error).message}
          </td>
        </tr>
      )}
    </>
  )
}

const INT_KEYS = new Set<VarietyKey>(['seeds_per_acre_min', 'seeds_per_acre_max', 'plate_holes', 'days_to_maturity'])
const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 }))

/**
 * One variety's figures, every box filled in: its own, else the crop's (what
 * the crop's other varieties share). A box left as it was stays the crop's;
 * a changed one becomes the variety's own; an emptied one goes back to the
 * crop's. Adding (variety null) names a new variety, which joins the crop's list.
 */
export function VarietySettingsEditor({
  crop,
  planter,
  variety,
  rows,
  listed,
  onClose,
}: {
  crop: CropRow
  planter: PlanterProfile | null
  /** null to add one. */
  variety: string | null
  /** Every variety settings row (the crop's are picked out by id). */
  rows: readonly VarietySettingRow[]
  /** The crop's own variety list, so a name only plans recorded joins it. */
  listed: CropVarietyRow[]
  onClose: () => void
}) {
  const { save, remove } = useCropVarietySettingMutations()
  const { add: addVariety } = useCropVarietyMutations()
  const row = variety ? varietySettingFor(rows, crop.id, variety) : null
  const base = varietyFigures(crop, planter, null)
  const figures = varietyFigures(crop, planter, row)

  const field = (k: VarietyKey): EditField => ({
    key: k,
    label: VARIETY_LABELS[k],
    kind: 'number',
    int: INT_KEYS.has(k),
    hint: `${crop.name}: ${fmt(base[k])}`,
  })
  const fields: EditField[] = [
    ...(variety ? [] : [{ key: 'variety', label: 'Variety', kind: 'text' as const, required: true }]),
    ...VARIETY_CROP_KEYS.map(field),
    ...VARIETY_PLANTER_KEYS.map(field),
    { key: 'notes', label: 'Notes', kind: 'textarea' },
  ]

  return (
    <RecordEditModal
      title={variety ? `${crop.name} — ${variety}` : `${crop.name} — add a variety`}
      fields={fields}
      row={{ ...figures, notes: row?.notes ?? null }}
      onClose={onClose}
      onSave={async (patch) => {
        const name = (variety ?? String(patch.variety ?? '')).trim()
        if (!name) throw new Error('Name the variety.')
        // A name typed when adding that already has figures edits those.
        const existing = row ?? varietySettingFor(rows, crop.id, name)
        const store = figuresToStore(base, existing, patch as Partial<Record<VarietyKey, number | null>>)
        const notes = (patch.notes as string | null) ?? null
        const anything = Object.values(store).some((v) => v != null) || notes != null
        if (existing || anything)
          await save.mutateAsync({ ...store, notes, id: existing?.id, crop_id: crop.id, variety: existing?.variety ?? name })
        // A name only a plan or past year recorded joins the crop's list, so the planner offers it.
        if (!listed.some((l) => l.crop_id === crop.id && varietyKey(l.name) === varietyKey(name)))
          await addVariety.mutateAsync({ crop_id: crop.id, name })
      }}
      onDelete={row ? () => remove.mutateAsync(row.id) : undefined}
      deleteConfirm={row ? `Set ${row.variety}'s figures back to ${crop.name}'s?` : undefined}
    />
  )
}
